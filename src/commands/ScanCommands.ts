import * as vscode from "vscode";
import {
  StatusBarController,
  GuardState,
} from "../statusBar/StatusBarController";
import { CodeAnalyzer } from "../analyzer/CodeAnalyzer";
import { AICodeDetector } from "../analyzer/AICodeDetector";
import { AIAnalyzer } from "../analyzer/AIAnalyzer";
import { CodeIssue, ScanResult } from "../types";
import { GuardPanelProvider } from "../panel/GuardPanelProvider";
import { ScanPreviewService } from "./ScanPreviewService";
import { IssueDecorationController } from "./IssueDecorationController";

interface PendingAIScan {
  uri: string;
  version: number;
  queuedAt: number;
  languageId: string;
}

type GuardScanMode = "realtime" | "onDemand" | "preCommit";

const AI_GUARD_CONFIG_SECTION = "aiCodeGuard";
const DEFAULT_SCAN_MODE: GuardScanMode = "realtime";
const REALTIME_SCAN_MODE: GuardScanMode = "realtime";
const ON_DEMAND_SCAN_MODE: GuardScanMode = "onDemand";
const PRE_COMMIT_SCAN_MODE: GuardScanMode = "preCommit";
const AI_SCAN_DEBOUNCE_MS = 500;

const SUPPORTED_LANGUAGES = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "python",
  "java",
  "csharp",
  "cpp",
  "go",
  "rust",
];

type ScanNotificationMode = "automatic" | "manual";

interface ScanProcessingOptions {
  notificationMode: ScanNotificationMode;
  logScope: "Scan" | "Manual";
}

export class ScanCommands {
  private analyzer: CodeAnalyzer;
  private aiDetector: AICodeDetector;
  private aiAnalyzer: AIAnalyzer;
  private previewService: ScanPreviewService;
  private decorationController: IssueDecorationController;
  private documentChangeListener?: vscode.Disposable;
  private documentSaveListener?: vscode.Disposable;
  private pendingScanTimeouts = new Map<string, NodeJS.Timeout>();
  private pendingAIScans = new Map<string, PendingAIScan>();
  private lastScanResult?: ScanResult;
  private analysisRequestId = 0;
  private suppressDocumentEvents = false;

  constructor(
    private statusBar: StatusBarController,
    private panelProvider: GuardPanelProvider,
  ) {
    this.analyzer = new CodeAnalyzer();
    this.aiDetector = new AICodeDetector();
    this.aiAnalyzer = new AIAnalyzer();
    this.previewService = new ScanPreviewService((document, text) =>
      this.replaceDocumentText(document, text),
    );
    this.decorationController = new IssueDecorationController();
  }

  public startRealtimeMonitoring(): void {
    this.logInfo("Monitor", "Realtime monitoring started");

    const scanMode = this.getScanMode();
    if (scanMode !== REALTIME_SCAN_MODE) {
      this.stopRealtimeMonitoring();

      const modeMessage = this.getScanModeInformationMessage(scanMode);

      this.logInfo(
        "Mode",
        `Automatic Copilot-style monitoring skipped because scan mode is '${scanMode}'`,
      );

      void vscode.window.showInformationMessage(modeMessage);
      return;
    }

    if (this.documentChangeListener || this.documentSaveListener) {
      return;
    }

    // Überwache Text-Änderungen
    this.documentChangeListener = vscode.workspace.onDidChangeTextDocument(
      async (event) => {
        if (this.suppressDocumentEvents) {
          return;
        }

        if (!this.shouldAutoMonitorDocument(event.document)) {
          return;
        }

        // Nur aktiv wenn Guard läuft
        if (this.statusBar.getState() !== GuardState.Active) {
          return;
        }

        // Prüfe jede Änderung
        for (const change of event.contentChanges) {
          // Realtime only for high-confidence AI-generated inserts.
          const isHighConfidenceAI =
            this.aiDetector.isHighConfidenceAIGenerated(change);
          if (!isHighConfidenceAI) {
            continue;
          }

          this.logInfo(
            "Detect",
            `Copilot-like change detected in ${this.getDocumentLabel(event.document)} (${change.text.length} chars, ${change.text.split("\n").length} lines)`,
          );

          this.queuePendingAIScan(event.document);
        }
      },
    );

    this.documentSaveListener = vscode.workspace.onDidSaveTextDocument(
      async (document) => {
        if (this.suppressDocumentEvents) {
          return;
        }

        if (!this.shouldAutoMonitorDocument(document)) {
          return;
        }

        if (this.statusBar.getState() !== GuardState.Active) {
          return;
        }

        const pendingScan = this.consumePendingAIScan(document);
        if (!pendingScan) {
          return;
        }

        const waitedMs = Date.now() - pendingScan.queuedAt;
        this.logInfo(
          "Scan",
          `Saved file detected for ${this.getDocumentLabel(document)}. Running queued AI scan now (queued at version ${pendingScan.version}, saved as version ${document.version}, waited ${waitedMs}ms).`,
        );

        await this.analyzeAICode(document);
      },
    );

    vscode.window.showInformationMessage(
      "🛡️ AI Guard is watching Copilot-like edits and will scan them after save",
    );
  }

  public stopRealtimeMonitoring(): void {
    if (this.documentChangeListener) {
      this.documentChangeListener.dispose();
      this.documentChangeListener = undefined;
    }

    if (this.documentSaveListener) {
      this.documentSaveListener.dispose();
      this.documentSaveListener = undefined;
    }

    this.clearPendingAIScans();

    this.logInfo(
      "Monitor",
      "Realtime monitoring stopped and queued scans cleared",
    );
    vscode.window.showInformationMessage("AI Guard monitoring paused");
  }

  private queuePendingAIScan(document: vscode.TextDocument): void {
    const documentUri = document.uri.toString();
    const existingTimeout = this.pendingScanTimeouts.get(documentUri);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      this.pendingScanTimeouts.delete(documentUri);
      this.pendingAIScans.set(documentUri, {
        uri: documentUri,
        version: document.version,
        queuedAt: Date.now(),
        languageId: document.languageId,
      });

      this.logInfo(
        "Queue",
        `Queued ${this.getDocumentLabel(document)} for scan after save (current version ${document.version})`,
      );
    }, AI_SCAN_DEBOUNCE_MS);

    this.pendingScanTimeouts.set(documentUri, timeout);
  }

  private clearPendingAIScans(): void {
    for (const timeout of this.pendingScanTimeouts.values()) {
      clearTimeout(timeout);
    }

    if (this.pendingAIScans.size > 0 || this.pendingScanTimeouts.size > 0) {
      this.logInfo(
        "Queue",
        `Cleared ${this.pendingAIScans.size} queued scan(s) and ${this.pendingScanTimeouts.size} pending debounce timer(s)`,
      );
    }

    this.pendingScanTimeouts.clear();
    this.pendingAIScans.clear();
  }

  private shouldAutoMonitorDocument(document: vscode.TextDocument): boolean {
    if (this.statusBar.getState() !== GuardState.Active) {
      return false;
    }

    if (this.getScanMode() !== REALTIME_SCAN_MODE) {
      return false;
    }

    if (document.uri.scheme !== "file") {
      return false;
    }

    return this.isSupportedLanguage(document.languageId);
  }

  private getScanMode(): GuardScanMode {
    const config = vscode.workspace.getConfiguration(AI_GUARD_CONFIG_SECTION);
    const scanMode = config.get<string>("scanMode", DEFAULT_SCAN_MODE);

    if (this.isGuardScanMode(scanMode)) {
      return scanMode;
    }

    return DEFAULT_SCAN_MODE;
  }

  private consumePendingAIScan(
    document: vscode.TextDocument,
  ): PendingAIScan | undefined {
    const documentUri = document.uri.toString();
    const pendingScan = this.pendingAIScans.get(documentUri);
    if (!pendingScan) {
      return undefined;
    }

    this.pendingAIScans.delete(documentUri);
    return pendingScan;
  }

  private clearPendingAIScan(document: vscode.TextDocument): void {
    const documentUri = document.uri.toString();
    const pendingTimeout = this.pendingScanTimeouts.get(documentUri);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.pendingScanTimeouts.delete(documentUri);
    }

    this.pendingAIScans.delete(documentUri);
    this.logInfo(
      "Queue",
      `Removed queued scan for ${this.getDocumentLabel(document)} because a manual scan was started`,
    );
  }

  private async analyzeAICode(document: vscode.TextDocument): Promise<void> {
    const requestId = ++this.analysisRequestId;
    this.logInfo(
      "Scan",
      `Starting AI Guard analysis for ${this.getDocumentLabel(document)} (request ${requestId})`,
    );

    try {
      const result = await this.runAnalysis(document);

      if (requestId !== this.analysisRequestId) {
        this.logInfo(
          "Scan",
          `Discarded outdated analysis result for ${this.getDocumentLabel(document)} (request ${requestId})`,
        );
        return;
      }

      await this.processScanResult(document, result, {
        notificationMode: "automatic",
        logScope: "Scan",
      });
      this.logInfo(
        "Scan",
        `Analysis finished for ${this.getDocumentLabel(document)} with ${result.issues.length} issue(s) in ${result.scanDuration}ms`,
      );
    } catch (error) {
      this.logError(
        "Scan",
        `Error analyzing ${this.getDocumentLabel(document)}: ${String(error)}`,
      );
    }
  }

  private showIssuesQuickPick(issues: CodeIssue[]): void {
    const items = issues.map((issue) => ({
      label:
        issue.line >= 0
          ? `$(warning) Line ${issue.line + 1}`
          : "$(warning) Unknown line",
      description: issue.message,
      detail: issue.originalCode,
    }));

    vscode.window.showQuickPick(items, {
      placeHolder: "Select an issue to view",
    });
  }

  public async scanCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage("AI Guard: No active file to scan");
      return;
    }

    try {
      this.clearPendingAIScan(editor.document);
      this.logInfo(
        "Manual",
        `Manual scan started for ${this.getDocumentLabel(editor.document)}`,
      );

      const result = await this.runAnalysis(editor.document);
      await this.processScanResult(editor.document, result, {
        notificationMode: "manual",
        logScope: "Manual",
      });
      this.logInfo(
        "Manual",
        `Manual scan finished for ${this.getDocumentLabel(editor.document)} with ${result.issues.length} issue(s)`,
      );
    } catch (error) {
      this.statusBar.setState(GuardState.Error);
      this.clearIssueDecorations();
      vscode.window.showErrorMessage("AI Guard: Failed to scan current file");
      this.logError(
        "Manual",
        `Manual scan failed for ${this.getDocumentLabel(editor.document)}: ${String(error)}`,
      );
    }
  }

  private getDocumentLabel(document: vscode.TextDocument): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      return vscode.workspace.asRelativePath(document.uri, false);
    }

    return document.uri.fsPath || document.uri.toString();
  }

  private logInfo(scope: string, message: string): void {
    console.log(`${this.getTimestamp()} [AI Guard][${scope}] ${message}`);
  }

  private logError(scope: string, message: string): void {
    console.error(
      `${this.getTimestamp()} [AI Guard][${scope}] ERROR: ${message}`,
    );
  }

  private getTimestamp(): string {
    return new Date().toLocaleTimeString();
  }

  private isGuardScanMode(value: string): value is GuardScanMode {
    return (
      value === REALTIME_SCAN_MODE ||
      value === ON_DEMAND_SCAN_MODE ||
      value === PRE_COMMIT_SCAN_MODE
    );
  }

  private getScanModeInformationMessage(scanMode: GuardScanMode): string {
    if (scanMode === ON_DEMAND_SCAN_MODE) {
      return "🛡️ AI Guard is in On-Demand mode. Use 'Scan File Now' to run a scan.";
    }

    return "🛡️ AI Guard Pre-Commit mode is not automatic yet. Use 'Scan File Now' before committing.";
  }

  private async processScanResult(
    document: vscode.TextDocument,
    result: ScanResult,
    options: ScanProcessingOptions,
  ): Promise<void> {
    this.lastScanResult = result;
    await this.initializePreviewMode(result, document);
    this.applyIssueDecorations(document, result.issues);
    this.panelProvider.updateFromScanResult(result);
    await this.notifyScanResult(document, result, options);
  }

  private async notifyScanResult(
    document: vscode.TextDocument,
    result: ScanResult,
    options: ScanProcessingOptions,
  ): Promise<void> {
    if (options.notificationMode === "manual") {
      await this.notifyManualScanResult(result);
      return;
    }

    await this.notifyAutomaticScanResult(document, result, options.logScope);
  }

  private async notifyAutomaticScanResult(
    document: vscode.TextDocument,
    result: ScanResult,
    logScope: "Scan" | "Manual",
  ): Promise<void> {
    if (result.issues.length === 0) {
      this.logInfo(
        "Result",
        `No issues found in ${this.getDocumentLabel(document)}`,
      );
      return;
    }

    const message = `🛡️ AI Guard found ${result.issues.length} issue(s) in AI-generated code`;
    const action = await vscode.window.showWarningMessage(
      message,
      "View Issues",
      "Ignore",
    );

    if (action === "View Issues") {
      this.showIssuesQuickPick(result.issues);
      return;
    }

    this.logInfo(
      logScope,
      `Issue dialog dismissed for ${this.getDocumentLabel(document)}`,
    );
  }

  private async notifyManualScanResult(result: ScanResult): Promise<void> {
    if (result.issues.length === 0) {
      await vscode.window.showInformationMessage(
        "AI Guard: No issues found in current file",
      );
      return;
    }

    await vscode.window.showWarningMessage(
      `AI Guard: Found ${result.issues.length} issue(s) in current file`,
    );
    this.showIssuesQuickPick(result.issues);
  }

  private async runAnalysis(
    document: vscode.TextDocument,
  ): Promise<ScanResult> {
    const localResult = await this.analyzer.analyzeDocument(document);

    try {
      const aiIssues = await this.aiAnalyzer.analyzeWithAPI(document);
      return {
        ...localResult,
        issues: [...localResult.issues, ...aiIssues],
      };
    } catch (error) {
      console.warn("AI API analysis failed, using local analysis only:", error);
      return localResult;
    }
  }

  public async viewLastReport(): Promise<void> {
    if (!this.lastScanResult) {
      vscode.window.showInformationMessage(
        "AI Guard: No report available yet. Run a scan first.",
      );
      return;
    }

    const { issues, scanDuration, timestamp } = this.lastScanResult;
    const summary = `Issues: ${issues.length} | Duration: ${scanDuration}ms | Time: ${timestamp.toLocaleTimeString()}`;

    const details = issues
      .slice(0, 5)
      .map((issue) => `Line ${issue.line + 1}: ${issue.message}`)
      .join("\n");

    await vscode.window.showInformationMessage(
      details ? `${summary}\n${details}` : summary,
    );
  }

  public async applyFix(issueId: string): Promise<void> {
    if (!this.lastScanResult) {
      return;
    }

    const issue = this.lastScanResult.issues.find(
      (item) => item.id === issueId,
    );
    if (!issue || issue.status !== "open" || !issue.isPreviewed) {
      return;
    }

    const document = await this.openPreviewDocument();
    if (!document || !this.ensurePreviewSync(document)) {
      return;
    }

    issue.isPreviewed = false;
    issue.status = "applied";
    await this.rebuildPreviewDocument(document);
  }

  public async ignoreIssue(issueId: string): Promise<void> {
    if (!this.lastScanResult) {
      return;
    }

    const issue = this.lastScanResult.issues.find(
      (item) => item.id === issueId,
    );
    if (!issue || issue.status !== "open") {
      return;
    }

    const document = await this.openPreviewDocument();
    if (!document || !this.ensurePreviewSync(document)) {
      return;
    }

    issue.isPreviewed = false;
    issue.status = "ignored";
    await this.rebuildPreviewDocument(document);
  }

  public async applyAll(): Promise<void> {
    if (!this.lastScanResult) {
      return;
    }

    const document = await this.openPreviewDocument();
    if (!document || !this.ensurePreviewSync(document)) {
      return;
    }

    let appliedCount = 0;
    for (const issue of this.lastScanResult.issues) {
      if (issue.status === "open" && issue.isPreviewed) {
        issue.isPreviewed = false;
        issue.status = "applied";
        appliedCount += 1;
      }
    }

    await this.rebuildPreviewDocument(document);
    if (appliedCount > 0) {
      vscode.window.showInformationMessage(
        `AI Guard: Apply All finished (${appliedCount} applied)`,
      );
    }
  }

  public async ignoreAll(): Promise<void> {
    if (!this.lastScanResult) {
      return;
    }

    const document = await this.openPreviewDocument();
    if (!document || !this.ensurePreviewSync(document)) {
      return;
    }

    for (const issue of this.lastScanResult.issues) {
      if (issue.status === "open") {
        issue.isPreviewed = false;
        issue.status = "ignored";
      }
    }

    await this.rebuildPreviewDocument(document);
  }

  private async initializePreviewMode(
    result: ScanResult,
    document: vscode.TextDocument,
  ): Promise<void> {
    await this.previewService.initializePreviewMode(result, document);
  }

  private async rebuildPreviewDocument(
    document: vscode.TextDocument,
  ): Promise<void> {
    if (!this.lastScanResult) {
      return;
    }

    const rebuildResult = await this.previewService.rebuildPreviewDocument(
      document,
      this.lastScanResult.issues,
    );

    if (rebuildResult === "invalid-fix-ranges") {
      vscode.window.showWarningMessage(
        "AI Guard: Could not rebuild preview due to invalid fix ranges",
      );
      return;
    }

    if (rebuildResult === "apply-failed") {
      vscode.window.showErrorMessage(
        "AI Guard: Failed to update preview state",
      );
      return;
    }

    await this.refreshFileDecorations();
    this.panelProvider.updateFromScanResult(this.lastScanResult);
  }

  private ensurePreviewSync(document: vscode.TextDocument): boolean {
    return this.previewService.ensurePreviewSync(document);
  }

  private async openPreviewDocument(): Promise<
    vscode.TextDocument | undefined
  > {
    return this.previewService.openPreviewDocument(
      this.lastScanResult?.fileUri,
    );
  }

  private async replaceDocumentText(
    document: vscode.TextDocument,
    text: string,
  ): Promise<boolean> {
    if (document.getText() === text) {
      return true;
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, text);
    this.suppressDocumentEvents = true;
    try {
      return await vscode.workspace.applyEdit(edit);
    } finally {
      this.suppressDocumentEvents = false;
    }
  }

  private async refreshFileDecorations(): Promise<void> {
    await this.decorationController.refreshFileDecorations(this.lastScanResult);
  }

  private applyIssueDecorations(
    document: vscode.TextDocument,
    issues: CodeIssue[],
  ): void {
    this.decorationController.applyIssueDecorations(document, issues);
  }

  private clearIssueDecorations(): void {
    this.decorationController.clearIssueDecorations();
  }

  private isSupportedLanguage(languageId: string): boolean {
    return SUPPORTED_LANGUAGES.includes(languageId);
  }

  public dispose(): void {
    this.stopRealtimeMonitoring();
    this.clearIssueDecorations();
    this.decorationController.dispose();
  }
}
