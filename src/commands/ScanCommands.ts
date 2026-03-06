import * as vscode from "vscode";
import {
  StatusBarController,
  GuardState,
} from "../statusBar/StatusBarController";
import { CodeAnalyzer } from "../analyzer/CodeAnalyzer";
import { AICodeDetector } from "../analyzer/AICodeDetector";
import { CodeIssue } from "../types";

export class ScanCommands {
  private analyzer: CodeAnalyzer;
  private aiDetector: AICodeDetector;
  private documentChangeListener?: vscode.Disposable;
  private analysisTimeout?: NodeJS.Timeout;

  constructor(private statusBar: StatusBarController) {
    this.analyzer = new CodeAnalyzer();
    this.aiDetector = new AICodeDetector();
  }

  public startRealtimeMonitoring(): void {
    console.log("🛡️ AI Guard: Realtime monitoring started");

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
          // Ist das wahrscheinlich AI-generierter Code?
          const isAIGenerated = this.aiDetector.isLikelyAIGenerated(change);
          const hasCopilotPattern = this.aiDetector.detectCopilotPatterns(
            change.text,
          );

          if (isAIGenerated || hasCopilotPattern) {
            console.log("🤖 AI-generated code detected:", {
              length: change.text.length,
              lines: change.text.split("\n").length,
              isAIGenerated,
              hasCopilotPattern,
            });

            // Zeige notification
            vscode.window.showInformationMessage(
              `🛡️ AI Guard: Analyzing AI-generated code...`,
            );

            // Debounce: Warte 500ms bevor Analyse startet
            if (this.analysisTimeout) {
              clearTimeout(this.analysisTimeout);
            }

            this.analysisTimeout = setTimeout(async () => {
              await this.analyzeAICode(event.document, change);
            }, 500);
          }
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
    change: vscode.TextDocumentContentChangeEvent,
  ): Promise<void> {
    try {
      // Scanne das gesamte Dokument
      const result = await this.analyzer.analyzeDocument(document);

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
      label: `$(warning) Line ${issue.line + 1}`,
      description: issue.message,
      detail: issue.originalCode,
    }));

    vscode.window.showQuickPick(items, {
      placeHolder: "Select an issue to view",
    });
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
  }
}
