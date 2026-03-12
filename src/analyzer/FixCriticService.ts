import * as vscode from "vscode";
import { CodeIssue, FixCandidate, FixReview } from "../types";
import { AIChatClient } from "./AIChatClient";
import { GuardLogger } from "../logging/GuardLogger";

interface CriticResponse {
  decision?: "approved" | "rejected";
  confidence?: number;
  rationale?: string;
  risks?: string[];
}

export class FixCriticService {
  private client = new AIChatClient();

  public async review(
    document: vscode.TextDocument,
    issue: CodeIssue,
    candidate: FixCandidate,
  ): Promise<FixReview> {
    const aiReview = await this.reviewWithAI(document, issue, candidate);
    if (aiReview) {
      this.logReview(issue, aiReview, "ai");
      return aiReview;
    }

    const isSafeEnough =
      candidate.replacement.trim().length > 0 &&
      candidate.replacement.trim() !== issue.originalCode.trim();

    const fallbackReview: FixReview = {
      status: isSafeEnough ? "approved" : "rejected",
      confidence: isSafeEnough ? 0.55 : 0.2,
      rationale: isSafeEnough
        ? "Local critic accepted a non-empty targeted replacement"
        : "Local critic rejected an empty or unchanged replacement",
      risks: isSafeEnough ? [] : ["Replacement was empty or unchanged"],
    };
    this.logReview(issue, fallbackReview, "local");
    return fallbackReview;
  }

  private async reviewWithAI(
    document: vscode.TextDocument,
    issue: CodeIssue,
    candidate: FixCandidate,
  ): Promise<FixReview | undefined> {
    if (!this.client.hasApiConfiguration()) {
      return undefined;
    }

    try {
      const response = await this.client.requestJson({
        systemPrompt:
          "You are a critical code reviewer. Review a proposed code fix and return JSON only.",
        userPrompt: this.buildPrompt(document, issue, candidate),
      });
      const parsed = JSON.parse(
        this.client.cleanJsonResponse(response),
      ) as CriticResponse;
      if (parsed.decision !== "approved" && parsed.decision !== "rejected") {
        return undefined;
      }

      return {
        status: parsed.decision,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
        rationale:
          parsed.rationale?.trim() || "AI critic returned no rationale",
        risks: Array.isArray(parsed.risks)
          ? parsed.risks.filter(
              (risk): risk is string => typeof risk === "string",
            )
          : [],
      };
    } catch (error) {
      GuardLogger.verbose(
        "Critic",
        `AI critic unavailable at line ${issue.line + 1}; falling back to local critic: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private logReview(
    issue: CodeIssue,
    review: FixReview,
    source: "ai" | "local",
  ): void {
    const message =
      `FixCritic ${review.status} patch at line ${issue.line + 1}, ` +
      `confidence=${review.confidence.toFixed(2)}, source=${source}`;
    if (review.status === "rejected") {
      GuardLogger.info("Critic", message);
      return;
    }

    GuardLogger.verbose("Critic", message);
  }

  private buildPrompt(
    document: vscode.TextDocument,
    issue: CodeIssue,
    candidate: FixCandidate,
  ): string {
    const range = candidate.target.range;
    const startLine = range?.startLine ?? issue.line;
    const endLine = range?.endLine ?? issue.endLine;
    const currentBlock =
      startLine >= 0 && endLine >= startLine && endLine < document.lineCount
        ? document.getText(
            new vscode.Range(
              startLine,
              0,
              endLine,
              document.lineAt(endLine).text.length,
            ),
          )
        : issue.originalCode;
    return [
      "Review the proposed structured patch for correctness and risk.",
      "Reject patches that add comments, prose, or advice instead of executable code.",
      "Reject patches that replace a full statement with a partial expression fragment.",
      'Return JSON only in this format: {"decision":"approved|rejected","confidence":0.0,"rationale":"string","risks":["string"]}',
      `Language: ${document.languageId}`,
      `Issue: ${issue.message}`,
      `Patch strategy: ${candidate.target.strategy || "line-range"}`,
      `Patch range: L${startLine + 1}-L${endLine + 1}`,
      `Original: ${currentBlock}`,
      `Replacement: ${candidate.replacement}`,
      `Generator rationale: ${candidate.rationale || "n/a"}`,
    ].join("\n");
  }
}
