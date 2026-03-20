import * as vscode from "vscode";
import { CodeIssue, FixCandidate, FixReview } from "../types";
import { GuardLogger } from "../logging/GuardLogger";

export class FixCriticService {
  public async review(
    _document: vscode.TextDocument,
    issue: CodeIssue,
    candidate: FixCandidate,
  ): Promise<FixReview> {
    const isSafeEnough =
      candidate.replacement.trim().length > 0 &&
      candidate.replacement.trim() !== issue.originalCode.trim();

    const review: FixReview = {
      status: isSafeEnough ? "approved" : "rejected",
      confidence: isSafeEnough ? 0.55 : 0.2,
      rationale: isSafeEnough
        ? "Local critic accepted a non-empty targeted replacement"
        : "Local critic rejected an empty or unchanged replacement",
      risks: isSafeEnough ? [] : ["Replacement was empty or unchanged"],
    };

    const message =
      `FixCritic ${review.status} patch at line ${issue.line + 1}, ` +
      `confidence=${review.confidence.toFixed(2)}, source=local`;
    if (review.status === "rejected") {
      GuardLogger.info("Critic", message);
    } else {
      GuardLogger.verbose("Critic", message);
    }

    return review;
  }
}
