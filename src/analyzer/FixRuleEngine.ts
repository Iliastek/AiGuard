import * as vscode from "vscode";
import {
  CodeIssue,
  FixCandidate,
  FixRange,
  IssueFixability,
  IssueUIStatus,
} from "../types";

type FixRuleContext = {
  document: vscode.TextDocument;
  lines: string[];
  text: string;
};

type IssueSeed = Pick<
  CodeIssue,
  | "line"
  | "column"
  | "endLine"
  | "endColumn"
  | "severity"
  | "message"
  | "originalCode"
  | "recommendation"
>;

interface FixRule {
  id: string;
  title: string;
  fixability: IssueFixability;
  detectIssues(context: FixRuleContext): CodeIssue[];
  matchesIssue(context: FixRuleContext, issue: CodeIssue): boolean;
  generateFixCandidate(
    context: FixRuleContext,
    issue: CodeIssue,
  ): FixCandidate | undefined;
  getRecommendation(issue: CodeIssue): string | undefined;
}

export class FixRuleEngine {
  private rules: FixRule[] = [
    new HardcodedCredentialRule(),
    new MissingHelmetRule(),
    new MissingRateLimitRule(),
    new MissingBcryptRule(),
    new MissingInputValidationRule(),
    new ProxyIpSuggestionRule(),
    new SecurityTodoRule(),
  ];

  public detectIssues(document: vscode.TextDocument): CodeIssue[] {
    const context = this.createContext(document);
    const issues = this.rules.flatMap((rule) => rule.detectIssues(context));
    return this.dedupeIssues(issues);
  }

  public classifyIssue(
    document: vscode.TextDocument,
    issue: CodeIssue,
  ): {
    rule?: FixRule;
    fixability: IssueFixability;
    recommendation?: string;
  } {
    const context = this.createContext(document);
    const rule = this.rules.find((item) => item.matchesIssue(context, issue));
    if (rule) {
      return {
        rule,
        fixability: rule.fixability,
        recommendation: issue.recommendation || rule.getRecommendation(issue),
      };
    }

    if (
      /(behind proxy|req\.ip|x-forwarded-for|proxy trust)/i.test(issue.message)
    ) {
      return {
        fixability: "suggestion",
        recommendation:
          "Configure trust proxy and derive client IP from trusted proxy headers instead of relying on req.ip alone.",
      };
    }

    if (
      /(architecture|reset logic|session rotation|authorization model)/i.test(
        issue.message,
      )
    ) {
      return {
        fixability: "manual",
        recommendation:
          "This issue affects architecture or control flow and should be fixed manually.",
      };
    }

    return {
      fixability:
        issue.fix ||
        issue.fixCandidate ||
        issue.source === "ai-generated" ||
        Boolean(issue.suggestedFix)
          ? "auto"
          : "suggestion",
      recommendation:
        issue.recommendation ||
        (issue.fix ||
        issue.fixCandidate ||
        issue.source === "ai-generated" ||
        issue.suggestedFix
          ? "A structured patch candidate can be validated locally."
          : "Review the recommendation and update the code manually if appropriate."),
    };
  }

  public generateFixCandidate(
    document: vscode.TextDocument,
    issue: CodeIssue,
  ): FixCandidate | undefined {
    const context = this.createContext(document);
    const rule = this.rules.find((item) => item.matchesIssue(context, issue));
    return rule?.generateFixCandidate(context, issue);
  }

  public computeUIStatus(issue: CodeIssue): IssueUIStatus {
    if (issue.status !== "open") {
      return issue.uiStatus ?? "OPEN";
    }

    if (
      issue.fixability === "auto" &&
      issue.patchResult?.status === "resolved" &&
      Boolean(issue.fix) &&
      issue.syntaxCheck?.isValid === true &&
      issue.pipeline?.stage === "previewable"
    ) {
      return "FIX_READY";
    }

    if (
      issue.fixability === "manual" ||
      (issue.fixability === "auto" && issue.pipeline?.stage === "rejected")
    ) {
      return "BLOCKED";
    }

    return "OPEN";
  }

  private createContext(document: vscode.TextDocument): FixRuleContext {
    const text = document.getText();
    return {
      document,
      text,
      lines: text.split("\n"),
    };
  }

  private dedupeIssues(issues: CodeIssue[]): CodeIssue[] {
    const seen = new Set<string>();
    return issues.filter((issue) => {
      const key = `${issue.ruleId || "no-rule"}:${issue.line}:${issue.message}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

abstract class BaseFixRule implements FixRule {
  public abstract id: string;
  public abstract title: string;
  public abstract fixability: IssueFixability;

  public abstract detectIssues(context: FixRuleContext): CodeIssue[];

  public abstract matchesIssue(
    context: FixRuleContext,
    issue: CodeIssue,
  ): boolean;

  public abstract generateFixCandidate(
    context: FixRuleContext,
    issue: CodeIssue,
  ): FixCandidate | undefined;

  public getRecommendation(issue: CodeIssue): string | undefined {
    return issue.recommendation;
  }

  protected createIssue(
    seed: IssueSeed,
    overrides: Partial<CodeIssue> = {},
  ): CodeIssue {
    const suffix = Math.random().toString(16).slice(2, 8);
    return {
      id: `${this.id}-${Date.now()}-${suffix}`,
      ruleId: this.id,
      fixability: this.fixability,
      uiStatus: this.fixability === "manual" ? "BLOCKED" : "OPEN",
      source: "analysis",
      status: "open",
      ...seed,
      ...overrides,
    };
  }

  protected createRange(
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
  ): FixRange {
    return {
      startLine,
      startColumn,
      endLine,
      endColumn,
    };
  }

  protected getExpressRequireInsertion(
    lines: string[],
  ): { line: number; isModule: boolean } | undefined {
    const importLine = lines.findIndex((line) =>
      /require\(["']express["']\)|from\s+["']express["']/.test(line),
    );
    if (importLine < 0) {
      return undefined;
    }

    return {
      line: importLine,
      isModule: /\bimport\b/.test(lines[importLine]),
    };
  }

  protected findAppLine(lines: string[]): number {
    return lines.findIndex((line) =>
      /const\s+app\s*=\s*express\s*\(/.test(line),
    );
  }

  protected createBlockReplacement(
    lines: string[],
    startLine: number,
    endLine: number,
    nextLines: string[],
  ): FixCandidate {
    return {
      source: "rule",
      patchType: "replace",
      replacement: nextLines.join("\n"),
      rationale: "Generated by deterministic fix rule",
      target: {
        strategy: "line-range",
        range: {
          startLine,
          startColumn: 0,
          endLine,
          endColumn: lines[endLine].length,
        },
        snippet: lines.slice(startLine, endLine + 1).join("\n"),
        contextBefore: startLine > 0 ? lines[startLine - 1].trim() : undefined,
        contextAfter:
          endLine + 1 < lines.length ? lines[endLine + 1].trim() : undefined,
      },
    };
  }
}

class HardcodedCredentialRule extends BaseFixRule {
  public id = "hardcoded-credentials";
  public title = "Hardcoded credentials";
  public fixability: IssueFixability = "auto";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    return context.lines.flatMap((line, index) => {
      if (!this.containsHardcodedCredentialComparison(line)) {
        return [];
      }

      return [
        this.createIssue({
          line: index,
          column: 0,
          endLine: index,
          endColumn: line.length,
          severity: "warning",
          message: "AI Guard: Hardcoded credentials are a security risk",
          originalCode: line.trim(),
          recommendation:
            "Move credentials to environment variables such as process.env.ADMIN_USER and process.env.ADMIN_PASS.",
        }),
      ];
    });
  }

  public matchesIssue(_: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id ||
      /hardcoded credentials|hardcoded password|hardcoded username/i.test(
        issue.message,
      ) ||
      this.containsHardcodedCredentialComparison(issue.originalCode)
    );
  }

  public generateFixCandidate(
    context: FixRuleContext,
    issue: CodeIssue,
  ): FixCandidate | undefined {
    if (issue.line < 0 || issue.line >= context.lines.length) {
      return undefined;
    }

    const originalLine = context.lines[issue.line];
    const expressionMatch = originalLine.match(/if\s*\((.+)\)\s*\{/);
    const originalExpression = expressionMatch?.[1]?.trim();
    if (!originalExpression) {
      return undefined;
    }

    let replacementExpression = originalExpression;
    replacementExpression = replacementExpression.replace(
      /(\busername\b\s*===\s*)(["'`]).+?\2/gi,
      "$1process.env.ADMIN_USER",
    );
    replacementExpression = replacementExpression.replace(
      /(\bpassword\b\s*===\s*)(["'`]).+?\2/gi,
      "$1process.env.ADMIN_PASS",
    );
    replacementExpression = replacementExpression.replace(
      /(["'`])admin\1\s*===\s*\busername\b/gi,
      "process.env.ADMIN_USER === username",
    );
    replacementExpression = replacementExpression.replace(
      /(["'`]).+?\1\s*===\s*\bpassword\b/gi,
      "process.env.ADMIN_PASS === password",
    );

    if (replacementExpression === originalExpression) {
      return undefined;
    }

    return {
      source: "rule",
      patchType: "replace",
      replacement: originalLine.replace(
        originalExpression,
        replacementExpression,
      ),
      rationale:
        "Replace hardcoded credential literals with environment variables",
      target: {
        strategy: "line-range",
        range: this.createRange(issue.line, 0, issue.line, originalLine.length),
        snippet: originalLine,
        nodeKind: "LogicalExpression",
        parentKind: "IfStatement",
        contextBefore:
          issue.line > 0 ? context.lines[issue.line - 1].trim() : undefined,
        contextAfter:
          issue.line + 1 < context.lines.length
            ? context.lines[issue.line + 1].trim()
            : undefined,
      },
    };
  }

  public override getRecommendation(): string {
    return "Replace hardcoded credentials with environment variables and consider returning 500 when they are not configured.";
  }

  private containsHardcodedCredentialComparison(line: string): boolean {
    return (
      /(\busername\b\s*===\s*["'`].+?["'`].*\bpassword\b\s*===\s*["'`].+?["'`])|((admin|root)\s*[/=:]\s*(admin|password123))/i.test(
        line,
      ) ||
      /(\bpassword\b\s*===\s*["'`](password|password123|admin)["'`])|(\busername\b\s*===\s*["'`](admin|root)["'`])/i.test(
        line,
      )
    );
  }
}

class MissingHelmetRule extends BaseFixRule {
  public id = "missing-helmet";
  public title = "Missing helmet";
  public fixability: IssueFixability = "auto";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    if (!/express/.test(context.text) || /helmet\s*\(/.test(context.text)) {
      return [];
    }

    const appLine = this.findAppLine(context.lines);
    if (appLine < 0) {
      return [];
    }

    return [
      this.createIssue({
        line: appLine,
        column: 0,
        endLine: appLine,
        endColumn: context.lines[appLine].length,
        severity: "warning",
        message: "AI Guard: Missing helmet middleware weakens security headers",
        originalCode: context.lines[appLine].trim(),
        recommendation:
          "Import helmet and register app.use(helmet()) before your routes and body middleware.",
      }),
    ];
  }

  public matchesIssue(context: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id ||
      (/helmet/i.test(issue.message) &&
        /express/.test(context.text) &&
        !/helmet\s*\(/.test(context.text))
    );
  }

  public generateFixCandidate(
    context: FixRuleContext,
    _: CodeIssue,
  ): FixCandidate | undefined {
    const importInfo = this.getExpressRequireInsertion(context.lines);
    const appLine = this.findAppLine(context.lines);
    if (!importInfo || appLine < 0) {
      return undefined;
    }

    const middlewareLine = context.lines.findIndex(
      (line, index) => index > appLine && /app\.use\(/.test(line),
    );
    const routeLine = context.lines.findIndex(
      (line, index) =>
        index > appLine && /app\.(get|post|put|patch|delete)\(/.test(line),
    );
    const anchorLine = middlewareLine >= 0 ? middlewareLine : routeLine;
    if (anchorLine < 0) {
      return undefined;
    }

    const block = context.lines.slice(importInfo.line, anchorLine + 1);
    const nextBlock = [...block];
    if (!/helmet/.test(context.text)) {
      nextBlock.splice(
        1,
        0,
        importInfo.isModule
          ? 'import helmet from "helmet";'
          : 'const helmet = require("helmet");',
      );
    }

    const insertIndex = nextBlock.findIndex((line) => /app\.use\(/.test(line));
    const middlewareInsertIndex =
      insertIndex >= 0 ? insertIndex : nextBlock.length;
    nextBlock.splice(middlewareInsertIndex, 0, "app.use(helmet());");
    return this.createBlockReplacement(
      context.lines,
      importInfo.line,
      anchorLine,
      nextBlock,
    );
  }
}

class MissingRateLimitRule extends BaseFixRule {
  public id = "missing-rate-limit";
  public title = "Missing rate limit";
  public fixability: IssueFixability = "auto";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    const loginRouteLine = context.lines.findIndex((line) =>
      /app\.post\(\s*["']\/login["']/.test(line),
    );
    if (loginRouteLine < 0 || /rateLimit|loginRateLimiter/.test(context.text)) {
      return [];
    }

    return [
      this.createIssue({
        line: loginRouteLine,
        column: 0,
        endLine: loginRouteLine,
        endColumn: context.lines[loginRouteLine].length,
        severity: "warning",
        message:
          "AI Guard: Missing rate limiting on login route enables brute force attacks",
        originalCode: context.lines[loginRouteLine].trim(),
        recommendation:
          "Protect the login route with express-rate-limit before processing credentials.",
      }),
    ];
  }

  public matchesIssue(context: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id ||
      (/rate limit|brute force/i.test(issue.message) &&
        /\/login/.test(context.text))
    );
  }

  public generateFixCandidate(
    context: FixRuleContext,
    issue: CodeIssue,
  ): FixCandidate | undefined {
    const importInfo = this.getExpressRequireInsertion(context.lines);
    const loginRouteLine = context.lines.findIndex((line) =>
      /app\.post\(\s*["']\/login["']/.test(line),
    );
    if (!importInfo || loginRouteLine < 0) {
      return undefined;
    }

    const block = context.lines.slice(importInfo.line, loginRouteLine + 1);
    const nextBlock = [...block];
    if (!/rateLimit|express-rate-limit/.test(context.text)) {
      nextBlock.splice(
        1,
        0,
        importInfo.isModule
          ? 'import rateLimit from "express-rate-limit";'
          : 'const rateLimit = require("express-rate-limit");',
      );
    }

    const appLine = nextBlock.findIndex((line) =>
      /const\s+app\s*=\s*express\s*\(/.test(line),
    );
    const limiterDeclaration = [
      "const loginRateLimiter = rateLimit({",
      "  windowMs: 15 * 60 * 1000,",
      "  max: 5,",
      "});",
      "",
    ];
    if (
      appLine >= 0 &&
      !nextBlock.some((line) => /loginRateLimiter/.test(line))
    ) {
      nextBlock.splice(appLine + 1, 0, ...limiterDeclaration);
    }

    const routeIndex = nextBlock.findIndex((line) =>
      /app\.post\(\s*["']\/login["']/.test(line),
    );
    if (routeIndex < 0) {
      return undefined;
    }

    nextBlock[routeIndex] = nextBlock[routeIndex].replace(
      /app\.post\((\s*["']\/login["']\s*,)\s*/,
      "app.post($1 loginRateLimiter, ",
    );

    return this.createBlockReplacement(
      context.lines,
      importInfo.line,
      loginRouteLine,
      nextBlock,
    );
  }

  public override getRecommendation(): string {
    return "Add express-rate-limit to the login route to reduce credential stuffing and brute force attempts.";
  }
}

class MissingBcryptRule extends BaseFixRule {
  public id = "missing-bcrypt";
  public title = "Missing bcrypt hashing";
  public fixability: IssueFixability = "auto";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    return context.lines.flatMap((line, index) => {
      if (
        !this.isPlainPasswordComparison(line) ||
        /bcrypt\.compare/.test(context.text)
      ) {
        return [];
      }

      return [
        this.createIssue({
          line: index,
          column: 0,
          endLine: index,
          endColumn: line.length,
          severity: "warning",
          message:
            "AI Guard: Plain password comparison should use bcrypt.compare",
          originalCode: line.trim(),
          recommendation:
            "Import bcrypt, make the handler async, and compare submitted passwords using bcrypt.compare.",
        }),
      ];
    });
  }

  public matchesIssue(_: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id ||
      /bcrypt|plain password comparison|password comparison/i.test(
        issue.message,
      )
    );
  }

  public generateFixCandidate(
    context: FixRuleContext,
    issue: CodeIssue,
  ): FixCandidate | undefined {
    if (issue.line < 0 || issue.line >= context.lines.length) {
      return undefined;
    }

    const importInfo = this.getExpressRequireInsertion(context.lines);
    const routeLine = this.findContainingRouteLine(context.lines, issue.line);
    if (!importInfo || routeLine < 0) {
      return undefined;
    }

    const block = context.lines.slice(importInfo.line, issue.line + 1);
    const nextBlock = [...block];
    if (!/bcrypt/.test(context.text)) {
      nextBlock.splice(
        1,
        0,
        importInfo.isModule
          ? 'import bcrypt from "bcryptjs";'
          : 'const bcrypt = require("bcryptjs");',
      );
    }

    const routeIndex =
      routeLine - importInfo.line + (nextBlock.length - block.length);
    const compareIndex =
      issue.line - importInfo.line + (nextBlock.length - block.length);
    if (nextBlock[routeIndex] && !/async/.test(nextBlock[routeIndex])) {
      nextBlock[routeIndex] = nextBlock[routeIndex].replace(
        /(app\.(get|post|put|patch|delete)\([^,]+,\s*)(\()/,
        "$1async $3",
      );
    }

    const comparisonLine = nextBlock[compareIndex];
    const rewritten = this.rewriteComparisonLine(comparisonLine);
    if (!rewritten) {
      return undefined;
    }
    nextBlock[compareIndex] = rewritten;

    return this.createBlockReplacement(
      context.lines,
      importInfo.line,
      issue.line,
      nextBlock,
    );
  }

  public override getRecommendation(): string {
    return "Use bcrypt.compare for submitted passwords and ensure the surrounding request handler is async.";
  }

  private isPlainPasswordComparison(line: string): boolean {
    return (
      /\bpassword\b\s*===\s*[a-zA-Z_$][\w$.]*/.test(line) &&
      !/["'`]|process\.env|bcrypt\.compare/.test(line)
    );
  }

  private findContainingRouteLine(
    lines: string[],
    compareLine: number,
  ): number {
    for (let line = compareLine; line >= 0; line -= 1) {
      if (/app\.(get|post|put|patch|delete)\(/.test(lines[line])) {
        return line;
      }
    }
    return -1;
  }

  private rewriteComparisonLine(line: string): string | undefined {
    const match = line.match(
      /if\s*\(\s*password\s*===\s*([a-zA-Z_$][\w$.]*)\s*\)/,
    );
    if (!match) {
      return undefined;
    }

    return line.replace(
      /password\s*===\s*[a-zA-Z_$][\w$.]*/,
      `await bcrypt.compare(password, ${match[1]})`,
    );
  }
}

class MissingInputValidationRule extends BaseFixRule {
  public id = "missing-input-validation";
  public title = "Missing input validation";
  public fixability: IssueFixability = "auto";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    return context.lines.flatMap((line, index) => {
      if (
        !/const\s*\{\s*username\s*,\s*password\s*\}\s*=\s*req\.body/.test(line)
      ) {
        return [];
      }

      const nearbyWindow = context.lines.slice(index + 1, index + 6).join("\n");
      if (/!username\s*\|\|\s*!password/.test(nearbyWindow)) {
        return [];
      }

      return [
        this.createIssue({
          line: index,
          column: 0,
          endLine: index,
          endColumn: line.length,
          severity: "warning",
          message: "AI Guard: Missing input validation for login payload",
          originalCode: line.trim(),
          recommendation:
            "Validate required login fields immediately after reading req.body.",
        }),
      ];
    });
  }

  public matchesIssue(_: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id ||
      /missing input validation|missing validation/i.test(issue.message)
    );
  }

  public generateFixCandidate(
    context: FixRuleContext,
    issue: CodeIssue,
  ): FixCandidate | undefined {
    if (issue.line < 0 || issue.line >= context.lines.length) {
      return undefined;
    }

    const originalLine = context.lines[issue.line];
    const indent = originalLine.match(/^\s*/)?.[0] ?? "";
    const block = [
      originalLine,
      "",
      `${indent}if (!username || !password) {`,
      `${indent}  return res.status(400).json({`,
      `${indent}    error: "username and password are required",`,
      `${indent}  });`,
      `${indent}}`,
    ];

    return {
      source: "rule",
      patchType: "replace",
      replacement: block.join("\n"),
      rationale:
        "Insert deterministic validation block after reading login payload",
      target: {
        strategy: "block-range",
        range: this.createRange(issue.line, 0, issue.line, originalLine.length),
        snippet: originalLine,
        nodeKind: "VariableStatement",
        contextAfter:
          issue.line + 1 < context.lines.length
            ? context.lines[issue.line + 1].trim()
            : undefined,
      },
    };
  }
}

class ProxyIpSuggestionRule extends BaseFixRule {
  public id = "proxy-ip-suggestion";
  public title = "Req.ip behind proxy";
  public fixability: IssueFixability = "suggestion";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    return context.lines.flatMap((line, index) => {
      if (!/req\.ip/.test(line)) {
        return [];
      }

      return [
        this.createIssue({
          line: index,
          column: 0,
          endLine: index,
          endColumn: line.length,
          severity: "info",
          message: "AI Guard: req.ip may be unreliable behind a proxy",
          originalCode: line.trim(),
          recommendation:
            "Configure trust proxy and evaluate forwarded headers before relying on req.ip for security decisions.",
        }),
      ];
    });
  }

  public matchesIssue(_: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id || /req\.ip|behind proxy/i.test(issue.message)
    );
  }

  public generateFixCandidate(): FixCandidate | undefined {
    return undefined;
  }
}

class SecurityTodoRule extends BaseFixRule {
  public id = "security-todo";
  public title = "Security TODO";
  public fixability: IssueFixability = "manual";

  public detectIssues(context: FixRuleContext): CodeIssue[] {
    return context.lines.flatMap((line, index) => {
      if (!/TODO\s+security|FIXME\s+security/i.test(line)) {
        return [];
      }

      return [
        this.createIssue({
          line: index,
          column: 0,
          endLine: index,
          endColumn: line.length,
          severity: "info",
          message: "AI Guard: Security TODO requires a manual implementation",
          originalCode: line.trim(),
          recommendation:
            "Resolve the security TODO manually. The required change likely spans architecture or product-specific behavior.",
        }),
      ];
    });
  }

  public matchesIssue(_: FixRuleContext, issue: CodeIssue): boolean {
    return (
      issue.ruleId === this.id ||
      /security todo|manual implementation/i.test(issue.message)
    );
  }

  public generateFixCandidate(): FixCandidate | undefined {
    return undefined;
  }
}
