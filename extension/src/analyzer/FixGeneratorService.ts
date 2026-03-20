import * as vscode from "vscode";
import { CodeIssue, FixCandidate } from "../types";
import { BackendClient } from "./BackendClient";
import { AIGUARD_API_FIX_GENERATE } from "../config";

interface FixResponse {
  issue: CodeIssue;
}

export class FixGeneratorService {
  private client = new BackendClient();

  public async generate(
    document: vscode.TextDocument,
    issue: CodeIssue,
  ): Promise<FixCandidate | undefined> {
    if (issue.line < 0) {
      return undefined;
    }

    const aiCandidate = await this.generateWithAI(document, issue);
    if (aiCandidate) {
      return aiCandidate;
    }

    const seededReplacement = issue.suggestedFix?.trim();
    if (!seededReplacement) {
      return undefined;
    }

    return {
      source: "analysis-seed",
      patchType: "replace",
      replacement: seededReplacement,
      rationale: "Seeded from analyzer suggestion",
      target: {
        strategy: "line-range",
        range: this.createFullLineRange(
          document,
          issue.line,
          issue.endLine >= issue.line ? issue.endLine : issue.line,
        ),
        snippet: issue.originalCode,
        contextBefore:
          issue.line > 0
            ? document.lineAt(issue.line - 1).text.trim()
            : undefined,
        contextAfter:
          issue.endLine + 1 < document.lineCount
            ? document.lineAt(issue.endLine + 1).text.trim()
            : undefined,
      },
    };
  }

  private async generateWithAI(
    document: vscode.TextDocument,
    issue: CodeIssue,
  ): Promise<FixCandidate | undefined> {
    if (!this.client.hasLicenseKey()) {
      return undefined;
    }

    try {
      const startLine = Math.max(0, issue.line - 2);
      const endLine = Math.min(document.lineCount - 1, issue.endLine + 2);
      const codeContext = Array.from(
        { length: endLine - startLine + 1 },
        (_, i) => document.lineAt(startLine + i).text,
      ).join("\n");

      const responseText = await this.client.post(AIGUARD_API_FIX_GENERATE, {
        issue,
        codeContext,
        language: document.languageId,
      });
      const response = JSON.parse(responseText) as FixResponse;
      return (response.issue.fixCandidate as FixCandidate | undefined) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private createFullLineRange(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
  ): FixCandidate["target"]["range"] {
    const normalizedStartLine = Math.max(0, startLine);
    const normalizedEndLine = Math.max(normalizedStartLine, endLine);
    const safeEndLine = Math.min(normalizedEndLine, document.lineCount - 1);

    return {
      startLine: normalizedStartLine,
      startColumn: 0,
      endLine: safeEndLine,
      endColumn: document.lineAt(safeEndLine).text.length,
    };
  }
}
