import * as vscode from "vscode";
import { DiffGeneratorService } from "../analyzer/DiffGeneratorService";
import { FixRuleEngine } from "../analyzer/FixRuleEngine";
import { FixCriticService } from "../analyzer/FixCriticService";
import { FixGeneratorService } from "../analyzer/FixGeneratorService";
import { LineRangePatchService } from "../analyzer/LineRangePatchService";
import { SyntaxValidator } from "../analyzer/SyntaxValidator";
import { GuardLogger } from "../logging/GuardLogger";
import { CodeIssue } from "../types";

export class ScanPipelineService {
  private ruleEngine = new FixRuleEngine();
  private generator = new FixGeneratorService();
  private critic = new FixCriticService();
  private patcher = new LineRangePatchService();
  private validator = new SyntaxValidator();
  private diffGenerator = new DiffGeneratorService();

  public async processIssues(
    document: vscode.TextDocument,
    issues: CodeIssue[],
  ): Promise<CodeIssue[]> {
    const processed: CodeIssue[] = [];

    for (const issue of issues) {
      const classification = this.ruleEngine.classifyIssue(document, issue);
      const nextIssue: CodeIssue = {
        ...issue,
        ruleId: issue.ruleId || classification.rule?.id,
        fixability: issue.fixability || classification.fixability,
        recommendation: issue.recommendation || classification.recommendation,
        analysis: {
          summary: issue.message,
          source:
            issue.source === "ai-generated" ? "ai-analysis" : "local-analysis",
        },
        pipeline: {
          stage: "analysis",
        },
      };
      GuardLogger.verbose(
        "Pipeline",
        `Issue entered pipeline: line=${nextIssue.line + 1}, rule=${nextIssue.ruleId || "none"}, fixability=${nextIssue.fixability || "unknown"}`,
      );

      if (nextIssue.fixability !== "auto") {
        nextIssue.uiStatus = this.ruleEngine.computeUIStatus(nextIssue);
        GuardLogger.verbose(
          "Pipeline",
          `Issue left pipeline without auto-fix: line=${nextIssue.line + 1}, fixability=${nextIssue.fixability}, uiStatus=${nextIssue.uiStatus}`,
        );
        processed.push(nextIssue);
        continue;
      }

      if (nextIssue.fix) {
        const syntaxCheck = this.validator.validatePatchedDocument(
          document,
          nextIssue.fix,
          nextIssue,
        );
        nextIssue.syntaxCheck = syntaxCheck;
        nextIssue.patchResult = syntaxCheck.isValid
          ? {
              status: "resolved",
              strategy: "line-range",
              fix: nextIssue.fix,
            }
          : {
              status: "rejected",
              strategy: "none",
              reason: syntaxCheck.diagnostics.join(" | "),
            };
        nextIssue.review = {
          status: syntaxCheck.isValid ? "approved" : "rejected",
          confidence: syntaxCheck.isValid ? 0.9 : 0.2,
          rationale: syntaxCheck.isValid
            ? "Existing deterministic fix validated locally"
            : "Existing deterministic fix failed local syntax validation",
          risks: syntaxCheck.isValid ? [] : syntaxCheck.diagnostics,
        };
        nextIssue.pipeline = {
          stage: syntaxCheck.isValid ? "previewable" : "rejected",
          lastError: syntaxCheck.isValid
            ? undefined
            : syntaxCheck.diagnostics.join(" | "),
        };
        if (syntaxCheck.isValid) {
          nextIssue.diff = this.diffGenerator.generate(
            document,
            nextIssue,
            nextIssue.fix,
          );
        } else {
          nextIssue.fix = undefined;
        }
        nextIssue.uiStatus = this.ruleEngine.computeUIStatus(nextIssue);
        GuardLogger.verbose(
          "Pipeline",
          `Existing fix ${nextIssue.uiStatus === "FIX_READY" ? "ready" : "blocked"} at line ${nextIssue.line + 1}`,
        );
        processed.push(nextIssue);
        continue;
      }

      const candidate =
        nextIssue.fixCandidate ||
        this.ruleEngine.generateFixCandidate(document, nextIssue) ||
        (await this.generator.generate(document, nextIssue));
      if (!candidate) {
        nextIssue.uiStatus = this.ruleEngine.computeUIStatus(nextIssue);
        GuardLogger.verbose(
          "Pipeline",
          `No fix candidate generated at line ${nextIssue.line + 1}; uiStatus=${nextIssue.uiStatus}`,
        );
        processed.push(nextIssue);
        continue;
      }

      nextIssue.fixCandidate = candidate;
      nextIssue.pipeline = {
        stage: "generated",
      };

      const review = await this.critic.review(document, nextIssue, candidate);
      nextIssue.review = review;
      nextIssue.pipeline = {
        stage: "reviewed",
        lastError: undefined,
      };

      if (review.status !== "approved") {
        GuardLogger.info(
          "Pipeline",
          `FixCritic rejected patch at line ${nextIssue.line + 1}, confidence=${review.confidence.toFixed(2)}. Continuing with local validation because critic is advisory.`,
        );
      } else {
        GuardLogger.verbose(
          "Pipeline",
          `FixCritic approved patch at line ${nextIssue.line + 1}, confidence=${review.confidence.toFixed(2)}`,
        );
      }

      const patchResult = this.patcher.resolvePatch(
        document,
        nextIssue,
        candidate,
      );
      nextIssue.patchResult = patchResult;
      nextIssue.pipeline = {
        stage: patchResult.status === "resolved" ? "patched" : "rejected",
        lastError:
          patchResult.status === "resolved" ? undefined : patchResult.reason,
      };

      if (patchResult.status !== "resolved" || !patchResult.fix) {
        nextIssue.uiStatus = this.ruleEngine.computeUIStatus(nextIssue);
        GuardLogger.warn(
          "Pipeline",
          `Patch blocked at line ${nextIssue.line + 1}: ${patchResult.reason || "unknown patch failure"}`,
        );
        processed.push(nextIssue);
        continue;
      }

      const syntaxCheck = this.validator.validatePatchedDocument(
        document,
        patchResult.fix,
        nextIssue,
        candidate,
      );
      nextIssue.syntaxCheck = syntaxCheck;
      nextIssue.fix = syntaxCheck.isValid ? patchResult.fix : undefined;
      nextIssue.pipeline = {
        stage: syntaxCheck.isValid ? "validated" : "rejected",
        lastError: syntaxCheck.isValid
          ? undefined
          : syntaxCheck.diagnostics.join(" | "),
      };

      if (!syntaxCheck.isValid) {
        nextIssue.uiStatus = this.ruleEngine.computeUIStatus(nextIssue);
        GuardLogger.warn(
          "Pipeline",
          `Preview blocked by syntax check at line ${nextIssue.line + 1}: ${syntaxCheck.diagnostics.join(" | ")}`,
        );
        processed.push(nextIssue);
        continue;
      }

      nextIssue.diff = this.diffGenerator.generate(
        document,
        nextIssue,
        patchResult.fix,
      );
      nextIssue.pipeline = {
        stage: "previewable",
      };
      nextIssue.uiStatus = this.ruleEngine.computeUIStatus(nextIssue);
      GuardLogger.verbose(
        "Pipeline",
        `Issue became previewable at line ${nextIssue.line + 1} with uiStatus=${nextIssue.uiStatus}`,
      );
      processed.push(nextIssue);
    }

    return processed;
  }
}
