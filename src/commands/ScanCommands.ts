import * as vscode from "vscode";
import {
  StatusBarController,
  GuardState,
} from "../statusBar/StatusBarController";
import { CodeAnalyzer } from "../analyzer/CodeAnalyzer";
import { AICodeDetector } from "../analyzer/AICodeDetector";
import { AIAnalyzer } from "../analyzer/AIAnalyzer";
import { CodeFix, CodeIssue, ScanResult } from "../types";
import { GuardPanelProvider } from "../panel/GuardPanelProvider";

interface PendingAIScan {
  uri: string;
  version: number;
  queuedAt: number;
  languageId: string;
}

type GuardScanMode = "realtime" | "onDemand" | "preCommit";

export class ScanCommands {
  private analyzer: CodeAnalyzer;
  private aiDetector: AICodeDetector;
  private aiAnalyzer: AIAnalyzer;
  private documentChangeListener?: vscode.Disposable;
  private documentSaveListener?: vscode.Disposable;
  private pendingScanTimeouts = new Map<string, NodeJS.Timeout>();
  private pendingAIScans = new Map<string, PendingAIScan>();
  private lastScanResult?: ScanResult;
  private warningDecorationType: vscode.TextEditorDecorationType;
  private analysisRequestId = 0;
  private previewBaseline?: { uri: string; text: string };
  private lastRenderedPreviewText?: string;
  private suppressDocumentEvents = false;

  constructor(
    private statusBar: StatusBarController,
    private panelProvider: GuardPanelProvider,
  ) {
    this.analyzer = new CodeAnalyzer();
    this.aiDetector = new AICodeDetector();
    this.aiAnalyzer = new AIAnalyzer();
    this.warningDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(255, 200, 0, 0.25)",
      isWholeLine: true,
      overviewRulerColor: "rgba(255, 200, 0, 0.7)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }

  public startRealtimeMonitoring(): void {
    console.log("🛡️ AI Guard: Realtime monitoring started");

    const scanMode = this.getScanMode();
    if (scanMode !== "realtime") {
      this.stopRealtimeMonitoring();

      const modeMessage =
        scanMode === "onDemand"
          ? "🛡️ AI Guard is in On-Demand mode. Use 'Scan File Now' to run a scan."
          : "🛡️ AI Guard Pre-Commit mode is not automatic yet. Use 'Scan File Now' before committing.";

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

          console.log("🤖 High-confidence AI code detected:", {
            length: change.text.length,
            lines: change.text.split("\n").length,
          });

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

        console.log("🛡️ AI Guard scanning kept AI-generated code on save", {
          uri: pendingScan.uri,
          queuedVersion: pendingScan.version,
          savedVersion: document.version,
        });

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

    console.log("🛡️ AI Guard: Realtime monitoring stopped");
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

      console.log("🛡️ AI Guard queued AI-generated changes for later scan", {
        uri: documentUri,
        version: document.version,
      });
    }, 500);

    this.pendingScanTimeouts.set(documentUri, timeout);
  }

  private clearPendingAIScans(): void {
    for (const timeout of this.pendingScanTimeouts.values()) {
      clearTimeout(timeout);
    }

    this.pendingScanTimeouts.clear();
    this.pendingAIScans.clear();
  }

  private shouldAutoMonitorDocument(document: vscode.TextDocument): boolean {
    if (this.statusBar.getState() !== GuardState.Active) {
      return false;
    }

    if (this.getScanMode() !== "realtime") {
      return false;
    }

    if (document.uri.scheme !== "file") {
      return false;
    }

    return this.isSupportedLanguage(document.languageId);
  }

  private getScanMode(): GuardScanMode {
    const config = vscode.workspace.getConfiguration("aiCodeGuard");
    const scanMode = config.get<string>("scanMode", "realtime");

    if (
      scanMode === "realtime" ||
      scanMode === "onDemand" ||
      scanMode === "preCommit"
    ) {
      return scanMode;
    }

    return "realtime";
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
  }

  private async analyzeAICode(document: vscode.TextDocument): Promise<void> {
    const requestId = ++this.analysisRequestId;

    try {
      const result = await this.runAnalysis(document);

      if (requestId !== this.analysisRequestId) {
        return;
      }

      this.lastScanResult = result;
      await this.initializePreviewMode(result, document);
      this.applyIssueDecorations(document, result.issues);
      this.panelProvider.updateFromScanResult(result);

      if (result.issues.length > 0) {
        const message = `🛡️ AI Guard found ${result.issues.length} issue(s) in AI-generated code`;

        const action = await vscode.window.showWarningMessage(
          message,
          "View Issues",
          "Ignore",
        );

        if (action === "View Issues") {
          this.showIssuesQuickPick(result.issues);
        }
      } else {
        console.log("✅ AI-generated code looks good!");
      }
    } catch (error) {
      console.error("Error analyzing AI code:", error);
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

      const result = await this.runAnalysis(editor.document);
      this.lastScanResult = result;
      await this.initializePreviewMode(result, editor.document);
      this.applyIssueDecorations(editor.document, result.issues);
      this.panelProvider.updateFromScanResult(result);

      if (result.issues.length === 0) {
        vscode.window.showInformationMessage(
          "AI Guard: No issues found in current file",
        );
        return;
      }

      vscode.window.showWarningMessage(
        `AI Guard: Found ${result.issues.length} issue(s) in current file`,
      );
      this.showIssuesQuickPick(result.issues);
    } catch (error) {
      this.statusBar.setState(GuardState.Error);
      this.clearIssueDecorations();
      vscode.window.showErrorMessage("AI Guard: Failed to scan current file");
      console.error("Error scanning current file:", error);
    }
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
    this.previewBaseline = {
      uri: result.fileUri,
      text: document.getText(),
    };

    for (const issue of result.issues) {
      issue.fix = this.resolveFixForIssue(issue);
      // Errors and warnings get previewed in the editor; info is webview-only
      issue.isPreviewed =
        issue.status === "open" &&
        (issue.severity === "error" || issue.severity === "warning");
    }

    const previewText = this.buildPreviewText(result.issues);
    if (previewText === undefined) {
      return;
    }

    const applied = await this.replaceDocumentText(document, previewText);
    if (applied) {
      this.lastRenderedPreviewText = previewText;
    }
  }

  private async rebuildPreviewDocument(
    document: vscode.TextDocument,
  ): Promise<void> {
    if (!this.lastScanResult || !this.previewBaseline) {
      return;
    }

    const text = this.buildPreviewText(this.lastScanResult.issues);
    if (text === undefined) {
      vscode.window.showWarningMessage(
        "AI Guard: Could not rebuild preview due to invalid fix ranges",
      );
      return;
    }

    const applied = await this.replaceDocumentText(document, text);
    if (!applied) {
      vscode.window.showErrorMessage(
        "AI Guard: Failed to update preview state",
      );
      return;
    }

    this.lastRenderedPreviewText = text;
    await this.refreshFileDecorations();
    this.panelProvider.updateFromScanResult(this.lastScanResult);
  }

  private buildPreviewText(issues: CodeIssue[]): string | undefined {
    if (!this.previewBaseline) {
      return undefined;
    }

    const baseText = this.previewBaseline.text;
    const workingIssues = issues.filter(
      (issue) =>
        (issue.status === "open" && issue.isPreviewed) ||
        issue.status === "applied",
    );

    const replacements: Array<{ start: number; end: number; text: string }> =
      [];

    for (const issue of workingIssues) {
      issue.fix = this.resolveFixForIssue(issue);
      if (!issue.fix) {
        continue;
      }

      const offsets = this.getOffsetsForFix(this.previewBaseline.text, issue);
      if (!offsets) {
        return undefined;
      }

      replacements.push({
        start: offsets.start,
        end: offsets.end,
        text: issue.fix.type === "delete" ? "" : issue.fix.replacement,
      });
    }

    replacements.sort((a, b) => b.start - a.start);

    let nextStart = Number.POSITIVE_INFINITY;
    let output = baseText;
    for (const replacement of replacements) {
      if (replacement.end > nextStart) {
        continue;
      }
      output =
        output.slice(0, replacement.start) +
        replacement.text +
        output.slice(replacement.end);
      nextStart = replacement.start;
    }

    return output;
  }

  private ensurePreviewSync(document: vscode.TextDocument): boolean {
    if (!this.lastRenderedPreviewText) {
      return true;
    }

    if (document.getText() !== this.lastRenderedPreviewText) {
      vscode.window.showWarningMessage(
        "AI Guard: File changed after preview. Please run a new scan.",
      );
      return false;
    }

    return true;
  }

  private async openPreviewDocument(): Promise<
    vscode.TextDocument | undefined
  > {
    if (!this.lastScanResult) {
      return undefined;
    }

    try {
      return await vscode.workspace.openTextDocument(
        vscode.Uri.parse(this.lastScanResult.fileUri),
      );
    } catch {
      vscode.window.showErrorMessage(
        "AI Guard: Could not open file for preview updates",
      );
      return undefined;
    }
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

  private getOffsetsForFix(
    baseText: string,
    issue: CodeIssue,
  ): { start: number; end: number } | undefined {
    if (!issue.fix) {
      return undefined;
    }

    const lines = baseText.split("\n");
    const lineStarts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + 1;
    }

    const { startLine, startColumn, endLine, endColumn } = issue.fix.range;
    if (
      startLine < 0 ||
      endLine < startLine ||
      startLine >= lines.length ||
      endLine >= lines.length
    ) {
      return undefined;
    }

    if (
      startColumn < 0 ||
      endColumn < 0 ||
      startColumn > lines[startLine].length ||
      endColumn > lines[endLine].length
    ) {
      return undefined;
    }

    if (issue.fix.type === "delete" && startLine === endLine) {
      const start = lineStarts[startLine];
      const end =
        startLine + 1 < lines.length
          ? lineStarts[startLine + 1]
          : lineStarts[startLine] + lines[startLine].length;
      return { start, end };
    }

    const start = lineStarts[startLine] + startColumn;
    const end = lineStarts[endLine] + endColumn;
    if (end < start) {
      return undefined;
    }
    return { start, end };
  }

  private resolveFixForIssue(issue: CodeIssue): CodeFix | undefined {
    // Info issues should not have fixes
    if (issue.severity === "info") {
      return undefined;
    }

    if (issue.fix) {
      return issue.fix;
    }

    const fallbackReplacement = this.deriveReplacementFromSuggestion(
      issue.suggestedFix,
      issue.originalCode,
    );
    if (!fallbackReplacement || issue.line < 0) {
      return undefined;
    }

    return {
      type: "replace",
      range: {
        startLine: issue.line,
        startColumn: 0,
        endLine: issue.endLine >= issue.line ? issue.endLine : issue.line,
        endColumn: Math.max(issue.endColumn, issue.column + 1),
      },
      replacement: fallbackReplacement,
    };
  }

  private deriveReplacementFromSuggestion(
    suggestion: string | undefined,
    originalCode: string,
  ): string | undefined {
    const raw = suggestion?.trim();
    if (!raw) {
      return undefined;
    }

    if (!this.looksLikeInstruction(raw)) {
      return raw;
    }

    // Pattern: "Change 'old' to 'new'."
    const changeMatch = raw.match(
      /change\s+['"`](.+?)['"`]\s+to\s+['"`](.+?)['"`]/i,
    );
    if (changeMatch) {
      const from = changeMatch[1];
      const to = changeMatch[2];
      if (originalCode.includes(from)) {
        return originalCode.replace(from, to);
      }
      return originalCode.replace(new RegExp(this.escapeRegExp(from), "g"), to);
    }

    // Pattern: "...: actual code"
    const colonIndex = raw.indexOf(":");
    if (colonIndex >= 0 && colonIndex < raw.length - 1) {
      const tail = raw.slice(colonIndex + 1).trim();
      if (tail && !this.looksLikeInstruction(tail)) {
        return tail;
      }
    }

    return undefined;
  }

  private looksLikeInstruction(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) {
      return true;
    }

    if (
      /^(initialize|use|change|consider|replace|set|add|remove|update)\b/i.test(
        normalized,
      )
    ) {
      return true;
    }

    if (/\b(instead of|such as|for example)\b/i.test(normalized)) {
      return true;
    }

    // Natural language sentence ending with period and spaces is likely prose.
    if (normalized.endsWith(".") && /\s/.test(normalized)) {
      return true;
    }

    return false;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async refreshFileDecorations(): Promise<void> {
    if (!this.lastScanResult) {
      return;
    }

    const openEditor = vscode.window.visibleTextEditors.find(
      (editor) =>
        editor.document.uri.toString() === this.lastScanResult?.fileUri,
    );

    if (openEditor) {
      this.applyIssueDecorations(
        openEditor.document,
        this.lastScanResult.issues.filter((issue) => issue.status === "open"),
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(this.lastScanResult.fileUri),
    );
    this.applyIssueDecorations(
      document,
      this.lastScanResult.issues.filter((issue) => issue.status === "open"),
    );
  }

  private applyIssueDecorations(
    document: vscode.TextDocument,
    issues: CodeIssue[],
  ): void {
    const editor = vscode.window.visibleTextEditors.find(
      (candidate) =>
        candidate.document.uri.toString() === document.uri.toString(),
    );

    if (!editor) {
      return;
    }

    if (issues.length === 0) {
      editor.setDecorations(this.warningDecorationType, []);
      return;
    }

    const decorations: vscode.DecorationOptions[] = [];

    for (const issue of issues) {
      if (issue.line < 0 || issue.line >= document.lineCount) {
        continue;
      }

      // Mark errors and warnings in the editor; info is shown in the webview panel only
      if (issue.severity === "info") {
        continue;
      }

      const lineRange = document.lineAt(issue.line).range;

      // Build hover content: show original code when issue is previewed
      const hoverParts: vscode.MarkdownString[] = [];

      const messageMd = new vscode.MarkdownString(
        `**\u26a0\ufe0f Guard:** ${issue.message}`,
      );
      messageMd.isTrusted = true;
      hoverParts.push(messageMd);

      if (issue.isPreviewed && issue.originalCode) {
        const originalMd = new vscode.MarkdownString();
        originalMd.isTrusted = true;
        originalMd.appendMarkdown("**Original Code:**\n");
        originalMd.appendCodeblock(issue.originalCode, document.languageId);
        hoverParts.push(originalMd);
      }

      decorations.push({
        range: lineRange,
        hoverMessage: hoverParts,
      });
    }

    editor.setDecorations(this.warningDecorationType, decorations);
  }

  private clearIssueDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.warningDecorationType, []);
    }
  }

  private isSupportedLanguage(languageId: string): boolean {
    const supported = [
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
    return supported.includes(languageId);
  }

  public dispose(): void {
    this.stopRealtimeMonitoring();
    this.clearIssueDecorations();
    this.warningDecorationType.dispose();
  }
}
