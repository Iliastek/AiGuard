import * as vscode from "vscode";
import { CodeFix, CodeIssue, FixCandidate, PatchResult } from "../types";
import { GuardLogger } from "../logging/GuardLogger";

export class LineRangePatchService {
  public resolvePatch(
    document: vscode.TextDocument,
    issue: CodeIssue,
    candidate: FixCandidate,
  ): PatchResult {
    const range = candidate.target.range;
    if (!range) {
      return {
        status: "rejected",
        strategy: "none",
        reason: "Structured patch is missing a target range",
      };
    }

    const normalizedRange = {
      startLine: range.startLine,
      startColumn: Math.max(0, range.startColumn),
      endLine: Math.max(range.startLine, range.endLine),
      endColumn: Math.max(0, range.endColumn),
    };

    const effectiveRange = this.resolveEffectiveRange(
      document,
      normalizedRange,
      candidate,
    );

    if (!this.isRangeValid(document, effectiveRange)) {
      return {
        status: "rejected",
        strategy: "none",
        reason: "Structured patch range is outside the current document",
      };
    }

    const currentText = document.getText(
      new vscode.Range(
        new vscode.Position(
          effectiveRange.startLine,
          effectiveRange.startColumn,
        ),
        new vscode.Position(effectiveRange.endLine, effectiveRange.endColumn),
      ),
    );

    const expectedSnippet = candidate.target.snippet?.trim();
    if (
      expectedSnippet &&
      this.normalize(currentText) !== this.normalize(expectedSnippet)
    ) {
      GuardLogger.warn(
        "Patch",
        `Structured patch target mismatch at line ${effectiveRange.startLine + 1}; continuing with line-range apply`,
      );
    }

    const replacement =
      candidate.patchType === "delete" ? "" : candidate.replacement;
    const invalidReplacementReason = this.getInvalidReplacementReason(
      document,
      effectiveRange,
      currentText,
      replacement,
      candidate.patchType,
    );
    if (invalidReplacementReason) {
      return {
        status: "rejected",
        strategy: "none",
        reason: invalidReplacementReason,
      };
    }

    if (candidate.patchType !== "delete" && currentText === replacement) {
      return {
        status: "rejected",
        strategy: "none",
        reason: "Structured patch does not change the source code",
      };
    }

    const fix: CodeFix = {
      type: candidate.patchType,
      range: effectiveRange,
      replacement,
    };

    return {
      status: "resolved",
      strategy: candidate.target.strategy || "line-range",
      fix,
    };
  }

  private isRangeValid(
    document: vscode.TextDocument,
    range: CodeFix["range"],
  ): boolean {
    if (
      range.startLine < 0 ||
      range.endLine < range.startLine ||
      range.startLine >= document.lineCount ||
      range.endLine >= document.lineCount
    ) {
      return false;
    }

    const startLineText = document.lineAt(range.startLine).text;
    const endLineText = document.lineAt(range.endLine).text;
    return (
      range.startColumn <= startLineText.length &&
      range.endColumn <= endLineText.length
    );
  }

  private resolveEffectiveRange(
    document: vscode.TextDocument,
    range: CodeFix["range"],
    _candidate: FixCandidate,
  ): CodeFix["range"] {
    const safeEndLine = Math.min(range.endLine, document.lineCount - 1);
    return {
      startLine: range.startLine,
      startColumn: 0,
      endLine: safeEndLine,
      endColumn: document.lineAt(safeEndLine).text.length,
    };
  }

  private normalize(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  }

  private getInvalidReplacementReason(
    document: vscode.TextDocument,
    range: CodeFix["range"],
    currentText: string,
    replacement: string,
    patchType: FixCandidate["patchType"],
  ): string | undefined {
    if (patchType === "delete") {
      return undefined;
    }

    const trimmed = replacement.trim();
    if (trimmed.length === 0) {
      return "Structured patch replacement is empty";
    }

    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      return "Structured patch replacement must be executable code, not comments or advice";
    }

    if (
      /(^|\s)\/\//.test(trimmed) ||
      /\/\*/.test(trimmed) ||
      /\*\//.test(trimmed)
    ) {
      return "Structured patch replacement must not include comments";
    }

    if (
      /consider using|more secure authentication method|should use|recommended fix|replace this with|advice:/i.test(
        trimmed,
      )
    ) {
      return "Structured patch replacement must be executable code, not advice";
    }

    if (/^(todo|fixme|note)\b/i.test(trimmed)) {
      return "Structured patch replacement must be executable code, not notes";
    }

    const fragmentReason = this.getPartialExpressionReason(
      document,
      range,
      currentText,
      trimmed,
    );
    if (fragmentReason) {
      return fragmentReason;
    }

    return undefined;
  }

  private getPartialExpressionReason(
    document: vscode.TextDocument,
    range: CodeFix["range"],
    currentText: string,
    replacement: string,
  ): string | undefined {
    if (
      range.startLine !== range.endLine ||
      replacement.includes("\n") ||
      replacement.includes("\r")
    ) {
      return undefined;
    }

    const lineText = document.lineAt(range.startLine).text;
    const isWholeLineReplacement =
      range.startColumn === 0 && range.endColumn === lineText.length;
    if (!isWholeLineReplacement) {
      return undefined;
    }

    const original = currentText.trim();
    const trimmed = replacement.trim();
    if (!original || !trimmed) {
      return undefined;
    }

    if (this.isStatementLikeReplacement(trimmed)) {
      return undefined;
    }

    if (this.isSuspiciousExpressionFragment(trimmed)) {
      return "Structured patch replacement must be a complete valid statement, not a partial expression";
    }

    if (
      this.originalLooksLikeDeclarationOrAssignment(original) &&
      !this.replacementLooksLikeDeclarationOrAssignment(trimmed)
    ) {
      return "Structured patch replacement must replace declarations and assignments with a complete statement";
    }

    return undefined;
  }

  private isStatementLikeReplacement(text: string): boolean {
    if (/[;{}]\s*$/.test(text)) {
      return true;
    }

    return /^(if|for|while|switch|try|catch|finally|do|function|async function|class|interface|type|enum|import|export|return|throw|break|continue)\b/.test(
      text,
    );
  }

  private isSuspiciousExpressionFragment(text: string): boolean {
    return (
      /^[a-zA-Z_$][\w$.]*$/.test(text) ||
      /^[a-zA-Z_$][\w$.]*\([^;]*\)$/.test(text) ||
      /^['"`].*['"`]$/.test(text) ||
      /^\d+(\.\d+)?$/.test(text) ||
      /^(true|false|null|undefined)$/i.test(text)
    );
  }

  private originalLooksLikeDeclarationOrAssignment(text: string): boolean {
    return /^(const|let|var)\b/.test(text) || /^[^=]+=[^=]/.test(text);
  }

  private replacementLooksLikeDeclarationOrAssignment(text: string): boolean {
    return /^(const|let|var)\b/.test(text) || /^[^=]+=[^=]/.test(text);
  }
}
