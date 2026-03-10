import * as vscode from "vscode";
import { CodeFix, CodeIssue, ScanResult } from "../types";

type PreviewRebuildResult =
  | "updated"
  | "unchanged"
  | "invalid-fix-ranges"
  | "apply-failed";

type ReplaceDocumentText = (
  document: vscode.TextDocument,
  text: string,
) => Promise<boolean>;

const PREVIEWABLE_SEVERITIES = new Set<CodeIssue["severity"]>([
  "error",
  "warning",
]);

export class ScanPreviewService {
  private previewBaseline?: { uri: string; text: string };
  private lastRenderedPreviewText?: string;

  constructor(private replaceDocumentText: ReplaceDocumentText) {}

  public async initializePreviewMode(
    result: ScanResult,
    document: vscode.TextDocument,
  ): Promise<void> {
    this.previewBaseline = {
      uri: result.fileUri,
      text: document.getText(),
    };

    for (const issue of result.issues) {
      issue.fix = this.resolveFixForIssue(issue);
      issue.isPreviewed =
        issue.status === "open" && PREVIEWABLE_SEVERITIES.has(issue.severity);
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

  public async rebuildPreviewDocument(
    document: vscode.TextDocument,
    issues: CodeIssue[],
  ): Promise<PreviewRebuildResult> {
    if (!this.previewBaseline) {
      return "unchanged";
    }

    const text = this.buildPreviewText(issues);
    if (text === undefined) {
      return "invalid-fix-ranges";
    }

    const applied = await this.replaceDocumentText(document, text);
    if (!applied) {
      return "apply-failed";
    }

    this.lastRenderedPreviewText = text;
    return "updated";
  }

  public ensurePreviewSync(document: vscode.TextDocument): boolean {
    if (!this.lastRenderedPreviewText) {
      return true;
    }

    if (document.getText() !== this.lastRenderedPreviewText) {
      void vscode.window.showWarningMessage(
        "AI Guard: File changed after preview. Please run a new scan.",
      );
      return false;
    }

    return true;
  }

  public async openPreviewDocument(
    fileUri: string | undefined,
  ): Promise<vscode.TextDocument | undefined> {
    if (!fileUri) {
      return undefined;
    }

    try {
      return await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri));
    } catch {
      void vscode.window.showErrorMessage(
        "AI Guard: Could not open file for preview updates",
      );
      return undefined;
    }
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

    if (normalized.endsWith(".") && /\s/.test(normalized)) {
      return true;
    }

    return false;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
