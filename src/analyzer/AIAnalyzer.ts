import * as vscode from "vscode";
import { CodeIssue, FixCandidate } from "../types";
import { AIChatClient } from "./AIChatClient";

interface AIAnalyzerPatchRange {
  startLine?: number;
  endLine?: number;
}

interface AIAnalyzerPatch {
  id?: string;
  startLine?: number;
  endLine?: number;
  replacementCode?: string;
  patchType?: "insert" | "replace" | "delete";
  targetSnippet?: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface AIAnalyzerIssueTarget {
  strategy?: "line-range";
  range?: AIAnalyzerPatchRange;
  snippet?: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface AIAnalyzerIssue {
  patchId?: string;
  line?: number;
  severity?: "info" | "warning" | "error";
  message?: string;
  suggestedFix?: string;
  codeSnippet?: string;
  patchType?: "insert" | "replace" | "delete";
  replacement?: string;
  confidence?: number;
  target?: AIAnalyzerIssueTarget;
  patch?: AIAnalyzerPatch;
}

interface AIAnalyzerResponse {
  issues?: AIAnalyzerIssue[];
  patches?: AIAnalyzerPatch[];
}

export class AIAnalyzer {
  private client = new AIChatClient();

  public async analyzeWithAPI(
    document: vscode.TextDocument,
  ): Promise<CodeIssue[]> {
    if (!this.client.hasApiConfiguration()) {
      return [];
    }

    const config = vscode.workspace.getConfiguration("aiCodeGuard");
    const maxChars = Number(
      process.env.AIGUARD_MAX_ANALYZED_CHARS ||
        config.get("maxAnalyzedChars", 12000),
    );

    const prompt = this.buildPrompt(
      document.languageId,
      document.getText().slice(0, maxChars),
    );

    const responseText = await this.client.requestJson({
      systemPrompt:
        "You are a secure code refactoring engine. Return only compact JSON containing real executable code patches.",
      userPrompt: prompt,
    });
    const parsed = this.client.cleanJsonResponse(responseText);
    const aiIssues = this.parseIssuesJson(parsed);

    return this.mapIssues(document, aiIssues);
  }

  private buildPrompt(languageId: string, code: string): string {
    const numberedCode = this.withLineNumbers(code);

    return [
      "Analyze this code for bugs, security risks, maintainability issues, and suspicious AI-generated mistakes.",
      "When an issue is fixable, you MUST provide a real code replacement that changes behavior or configuration safely.",
      "The replacement must be a complete valid JavaScript or TypeScript statement.",
      "Never return partial expressions such as identifiers, literals, or member access fragments.",
      "The replacement must compile on its own when replacing the original line or range.",
      "Do not use column ranges.",
      "All patches must replace complete lines using only startLine and endLine.",
      "Columns must not be used.",
      "Return JSON only in this format:",
      '{"issues":[{"line":number,"severity":"info|warning|error","message":"string","codeSnippet":"string optional","patchId":"string optional","confidence":0.0,"target":{"strategy":"line-range optional","range":{"startLine":number,"endLine":number},"snippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"},"patch":{"id":"string optional","startLine":number,"endLine":number,"patchType":"insert|replace|delete","replacementCode":"string","targetSnippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"}}],"patches":[{"id":"string","startLine":number,"endLine":number,"patchType":"insert|replace|delete","replacementCode":"string","targetSnippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"}]}',
      "If you can propose a concrete safe fix, include a structured patch. The Guard will only execute deterministic patches and will not invent fixes.",
      "replacementCode must contain valid executable code only, with no explanation, prose, markdown, or comments.",
      "Do not provide advice. Do not provide TODO, FIXME, NOTE, or Consider-using comments.",
      "Never insert comments such as //, /* */, or narrative text in replacementCode.",
      "For single-line replacements, prefer complete statements such as 'const API_KEY = process.env.API_KEY;' instead of fragments like 'process.env.API_KEY'.",
      "replacementCode must contain exactly the lines that replace the specified range.",
      "Do not include extra indentation changes or unrelated lines.",
      "Prefer top-level patches[] with patchId references from issues[]. If that is not possible, include patch inline under issue.patch.",
      "Patch ranges must be 1-based and refer to exact lines in the numbered code.",
      "Use the line numbers from the code block below (they are prefixed as L<line>:).",
      "line must be 1-based and refer to the exact line number in that numbered code.",
      "If uncertain, set line to 0 and provide codeSnippet.",
      "target.strategy should be line-range whenever a patch is provided.",
      `Language: ${languageId}`,
      "Code:",
      numberedCode,
    ].join("\n");
  }

  private parseIssuesJson(content: string): AIAnalyzerResponse {
    const parsed = JSON.parse(content) as AIAnalyzerResponse;
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      patches: Array.isArray(parsed.patches) ? parsed.patches : [],
    };
  }

  private mapIssues(
    document: vscode.TextDocument,
    response: AIAnalyzerResponse,
  ): CodeIssue[] {
    const patchesById = new Map<string, AIAnalyzerPatch>();
    for (const patch of response.patches || []) {
      if (typeof patch.id === "string" && patch.id.trim()) {
        patchesById.set(patch.id.trim(), patch);
      }
    }

    const issues = response.issues || [];
    return issues
      .filter(
        (issue) =>
          typeof issue.message === "string" && issue.message.trim().length > 0,
      )
      .map((issue, index) => {
        const resolvedPatch = this.resolvePatch(issue, patchesById);
        const line = this.resolveLine(document, issue);
        const lineText = line >= 0 ? document.lineAt(line).text : "";
        const suggestedFix = issue.suggestedFix?.trim() || undefined;
        const fixCandidate = this.createFixCandidate(
          document,
          issue,
          resolvedPatch,
          line,
          lineText,
        );

        return {
          id: `ai-issue-${Date.now()}-${index}`,
          line,
          column: 0,
          endLine: line,
          endColumn: lineText.length > 0 ? lineText.length : 1,
          severity: issue.severity ?? "warning",
          message: `AI Guard: ${issue.message!.trim()}`,
          originalCode:
            resolvedPatch?.targetSnippet?.trim() ||
            lineText.trim() ||
            issue.target?.snippet?.trim() ||
            issue.codeSnippet?.trim() ||
            "",
          suggestedFix,
          patchId: resolvedPatch?.id?.trim() || issue.patchId?.trim(),
          fixCandidate,
          source: "ai-generated" as const,
          status: "open" as const,
        };
      })
      .filter((issue) => issue.line >= 0); // Filter out issues with unknown line position
  }

  private resolveLine(
    document: vscode.TextDocument,
    issue: AIAnalyzerIssue,
  ): number {
    if (typeof issue.line === "number" && Number.isInteger(issue.line)) {
      if (issue.line >= 1 && issue.line <= document.lineCount) {
        return issue.line - 1;
      }
    }

    const snippet = this.stripLinePrefix(issue.codeSnippet?.trim() ?? "");
    if (snippet) {
      const foundIndex = this.findLineBySnippet(document, snippet);
      if (foundIndex >= 0) {
        return foundIndex;
      }
    }

    // Unknown position: keep issue, but skip inline highlight.
    return -1;
  }

  private findLineBySnippet(
    document: vscode.TextDocument,
    snippet: string,
  ): number {
    const normalizedSnippet = this.normalizeForMatch(snippet);

    if (!normalizedSnippet) {
      return -1;
    }

    for (let i = 0; i < document.lineCount; i += 1) {
      const line = this.normalizeForMatch(document.lineAt(i).text);
      if (line.includes(normalizedSnippet)) {
        return i;
      }
    }
    return -1;
  }

  private withLineNumbers(code: string): string {
    return code
      .split("\n")
      .map((line, index) => `L${index + 1}: ${line}`)
      .join("\n");
  }

  private stripLinePrefix(text: string): string {
    return text.replace(/^L\d+:\s*/i, "").trim();
  }

  private normalizeForMatch(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private createFixCandidate(
    document: vscode.TextDocument,
    issue: AIAnalyzerIssue,
    patch: AIAnalyzerPatch | undefined,
    line: number,
    lineText: string,
  ): FixCandidate | undefined {
    const replacement =
      patch?.replacementCode?.trim() ||
      issue.replacement?.trim() ||
      issue.suggestedFix?.trim();
    if (!replacement || line < 0) {
      return undefined;
    }

    const targetRange = patch ? this.toTargetRange(patch) : issue.target?.range;
    const fallbackEndLine =
      typeof patch?.endLine === "number" && patch.endLine >= 1
        ? patch.endLine - 1
        : line;
    const startLine =
      typeof patch?.startLine === "number" && patch.startLine >= 1
        ? patch.startLine - 1
        : line;
    const normalizedEndLine = Math.max(startLine, fallbackEndLine);

    return {
      source: "analysis-seed",
      patchType: patch?.patchType || issue.patchType || "replace",
      replacement,
      rationale: "Seeded directly from AI analysis output",
      confidence:
        typeof issue.confidence === "number" ? issue.confidence : undefined,
      target: {
        strategy: "line-range",
        range:
          targetRange && typeof targetRange.startLine === "number"
            ? this.createFullLineRange(
                document,
                Math.max(0, targetRange.startLine - 1),
                Math.max(0, (targetRange.endLine ?? targetRange.startLine) - 1),
              )
            : this.createFullLineRange(document, startLine, normalizedEndLine),
        snippet:
          this.stripLinePrefixesFromBlock(patch?.targetSnippet?.trim() || "") ||
          this.stripLinePrefixesFromBlock(
            issue.target?.snippet?.trim() || "",
          ) ||
          this.stripLinePrefixesFromBlock(issue.codeSnippet?.trim() || "") ||
          lineText.trim(),
        contextBefore:
          patch?.contextBefore?.trim() ||
          issue.target?.contextBefore?.trim() ||
          (line > 0 ? document.lineAt(line - 1).text.trim() : undefined),
        contextAfter:
          patch?.contextAfter?.trim() ||
          issue.target?.contextAfter?.trim() ||
          (line + 1 < document.lineCount
            ? document.lineAt(line + 1).text.trim()
            : undefined),
      },
    };
  }

  private resolvePatch(
    issue: AIAnalyzerIssue,
    patchesById: Map<string, AIAnalyzerPatch>,
  ): AIAnalyzerPatch | undefined {
    if (issue.patch) {
      return issue.patch;
    }

    const patchId = issue.patchId?.trim();
    if (!patchId) {
      return undefined;
    }

    return patchesById.get(patchId);
  }

  private toTargetRange(
    patch: AIAnalyzerPatch,
  ): AIAnalyzerPatchRange | undefined {
    if (typeof patch.startLine !== "number" || patch.startLine < 1) {
      return undefined;
    }

    return {
      startLine: patch.startLine,
      endLine: patch.endLine ?? patch.startLine,
    };
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

  private stripLinePrefixesFromBlock(text: string): string {
    if (!text) {
      return text;
    }

    return text
      .split("\n")
      .map((line) => line.replace(/^L\d+:\s*/i, ""))
      .join("\n")
      .trim();
  }
}
