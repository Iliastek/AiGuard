import * as vscode from "vscode";
import { CodeIssue, FixCandidate } from "../types";
import { AIChatClient } from "./AIChatClient";

interface GeneratorResponse {
  replacement?: string;
  rationale?: string;
  patchType?: "insert" | "replace" | "delete";
  confidence?: number;
  target?: {
    strategy?: "line-range";
    range?: {
      startLine?: number;
      endLine?: number;
    };
    snippet?: string;
    contextBefore?: string;
    contextAfter?: string;
  };
}

export class FixGeneratorService {
  private client = new AIChatClient();

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
    if (!this.client.hasApiConfiguration()) {
      return undefined;
    }

    try {
      const response = await this.client.requestJson({
        systemPrompt:
          "You generate minimal secure code fixes. Return JSON only and output executable replacement code, never comments or advice.",
        userPrompt: this.buildPrompt(document, issue),
      });
      const parsed = JSON.parse(
        this.client.cleanJsonResponse(response),
      ) as GeneratorResponse;
      const replacement = parsed.replacement?.trim();
      if (!replacement) {
        return undefined;
      }

      return {
        source: "generator",
        patchType: parsed.patchType || "replace",
        replacement,
        rationale: parsed.rationale?.trim(),
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : undefined,
        target: {
          strategy: parsed.target?.strategy || "line-range",
          range:
            parsed.target?.range &&
            typeof parsed.target.range.startLine === "number"
              ? this.createFullLineRange(
                  document,
                  Math.max(0, parsed.target.range.startLine - 1),
                  Math.max(
                    0,
                    (parsed.target.range.endLine ??
                      parsed.target.range.startLine) - 1,
                  ),
                )
              : this.createFullLineRange(
                  document,
                  issue.line,
                  issue.endLine >= issue.line ? issue.endLine : issue.line,
                ),
          snippet: parsed.target?.snippet?.trim() || issue.originalCode,
          contextBefore:
            parsed.target?.contextBefore?.trim() ||
            (issue.line > 0
              ? document.lineAt(issue.line - 1).text.trim()
              : undefined),
          contextAfter:
            parsed.target?.contextAfter?.trim() ||
            (issue.endLine + 1 < document.lineCount
              ? document.lineAt(issue.endLine + 1).text.trim()
              : undefined),
        },
      };
    } catch {
      return undefined;
    }
  }

  private buildPrompt(document: vscode.TextDocument, issue: CodeIssue): string {
    const startLine = Math.max(0, issue.line - 2);
    const endLine = Math.min(document.lineCount - 1, issue.endLine + 2);
    const context: string[] = [];
    for (let line = startLine; line <= endLine; line += 1) {
      context.push(`L${line + 1}: ${document.lineAt(line).text}`);
    }

    return [
      "Generate the smallest safe code fix for this issue.",
      "You must return a real executable code replacement, not a comment, explanation, or advice.",
      "The replacement must be a complete valid JavaScript or TypeScript statement.",
      "Never return partial expressions.",
      "The replacement must compile on its own when replacing the original line or range.",
      "Do not use column ranges. Replace complete lines using only startLine and endLine.",
      'Return JSON only in this format: {"replacement":"string","rationale":"string","confidence":0.0,"patchType":"insert|replace|delete","target":{"strategy":"line-range","range":{"startLine":number,"endLine":number},"snippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"}}',
      "replacement must be the exact executable replacement code for the specified range.",
      "Do not return comments, TODOs, FIXMEs, NOTE text, or advice like 'consider using'.",
      "For declarations or assignments, return the full replacement line including the declaration or assignment, for example 'const API_KEY = process.env.API_KEY;'.",
      "replacement must contain exactly the lines that replace the range, with no unrelated lines.",
      "target.strategy must be line-range.",
      `Language: ${document.languageId}`,
      `Issue: ${issue.message}`,
      `Original: ${issue.originalCode || "<empty>"}`,
      "Context:",
      context.join("\n"),
    ].join("\n");
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
