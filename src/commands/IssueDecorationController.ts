import * as vscode from "vscode";
import { CodeIssue, ScanResult } from "../types";

export class IssueDecorationController {
  private warningDecorationType: vscode.TextEditorDecorationType;

  constructor() {
    this.warningDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(255, 200, 0, 0.25)",
      isWholeLine: true,
      overviewRulerColor: "rgba(255, 200, 0, 0.7)",
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }

  public async refreshFileDecorations(result?: ScanResult): Promise<void> {
    if (!result) {
      return;
    }

    const openEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === result.fileUri,
    );

    if (openEditor) {
      this.applyIssueDecorations(
        openEditor.document,
        result.issues.filter((issue) => issue.status === "open"),
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(result.fileUri),
    );
    this.applyIssueDecorations(
      document,
      result.issues.filter((issue) => issue.status === "open"),
    );
  }

  public applyIssueDecorations(
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

      if (issue.severity === "info") {
        continue;
      }

      const lineRange = document.lineAt(issue.line).range;
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

  public clearIssueDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.warningDecorationType, []);
    }
  }

  public dispose(): void {
    this.warningDecorationType.dispose();
  }
}
