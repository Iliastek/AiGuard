import * as vscode from "vscode";
import { CodeFix, CodeIssue, DiffHunk } from "../types";

export class DiffGeneratorService {
  public generate(
    document: vscode.TextDocument,
    issue: CodeIssue,
    fix: CodeFix,
  ): DiffHunk {
    const before = this.readOriginalBlock(document, issue, fix);
    const after = fix.type === "delete" ? "" : fix.replacement;
    const beforeLines = before ? before.split("\n").length : 0;
    const afterLines = after ? after.split("\n").length : 0;
    return {
      startLine: fix.range.startLine,
      endLine: fix.range.endLine,
      before,
      after,
      summary: `L${fix.range.startLine + 1}-L${fix.range.endLine + 1}: -${beforeLines} line(s), +${afterLines} line(s) via ${fix.type}`,
    };
  }

  private readOriginalBlock(
    document: vscode.TextDocument,
    issue: CodeIssue,
    fix: CodeFix,
  ): string {
    if (
      fix.range.startLine < 0 ||
      fix.range.endLine < fix.range.startLine ||
      fix.range.endLine >= document.lineCount
    ) {
      return issue.originalCode || "";
    }

    const start = new vscode.Position(
      fix.range.startLine,
      Math.max(0, fix.range.startColumn),
    );
    const end = new vscode.Position(
      fix.range.endLine,
      Math.max(0, fix.range.endColumn),
    );
    return document.getText(new vscode.Range(start, end));
  }
}
