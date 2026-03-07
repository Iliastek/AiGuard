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

export class ScanCommands {
  private analyzer: CodeAnalyzer;
  private aiDetector: AICodeDetector;
  private aiAnalyzer: AIAnalyzer;
  private documentChangeListener?: vscode.Disposable;
  private analysisTimeout?: NodeJS.Timeout;
  private lastScanResult?: ScanResult;
  private warningDecorationType: vscode.TextEditorDecorationType;
  private analysisRequestId = 0;

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

    if (this.documentChangeListener) {
      return;
    }

    // Überwache Text-Änderungen
    this.documentChangeListener = vscode.workspace.onDidChangeTextDocument(
      async (event) => {
        // Nur aktiv wenn Guard läuft
        if (this.statusBar.getState() !== GuardState.Active) {
          return;
        }

        // Nur für unterstützte Sprachen
        const languageId = event.document.languageId;
        if (!this.isSupportedLanguage(languageId)) {
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

          // Debounce: Warte 500ms bevor Analyse startet
          if (this.analysisTimeout) {
            clearTimeout(this.analysisTimeout);
          }

          this.analysisTimeout = setTimeout(async () => {
            await this.analyzeAICode(event.document);
          }, 500);
        }
      },
    );

    vscode.window.showInformationMessage(
      "🛡️ AI Guard is now monitoring AI-generated code",
    );
  }

  public stopRealtimeMonitoring(): void {
    if (this.documentChangeListener) {
      this.documentChangeListener.dispose();
      this.documentChangeListener = undefined;
    }

    if (this.analysisTimeout) {
      clearTimeout(this.analysisTimeout);
    }

    console.log("🛡️ AI Guard: Realtime monitoring stopped");
    vscode.window.showInformationMessage("AI Guard monitoring paused");
  }

  private async analyzeAICode(
    document: vscode.TextDocument,
  ): Promise<void> {
    const requestId = ++this.analysisRequestId;

    try {
      const result = await this.runAnalysis(document);

      if (requestId !== this.analysisRequestId) {
        return;
      }

      this.lastScanResult = result;
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
      const result = await this.runAnalysis(editor.document);
      this.lastScanResult = result;
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

  private applyIssueDecorations(
    document: vscode.TextDocument,
    issues: CodeIssue[],
  ): void {
    const editor = vscode.window.visibleTextEditors.find(
      (candidate) => candidate.document.uri.toString() === document.uri.toString(),
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

      const lineRange = document.lineAt(issue.line).range;
      decorations.push({
        range: lineRange,
        hoverMessage: `Guard Suggestion: ${issue.message}`,
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
