import { parse } from "@babel/parser";
import * as vscode from "vscode";
import {
  CodeFix,
  CodeIssue,
  FixCandidate,
  SyntaxValidationResult,
} from "../types";
import { GuardLogger } from "../logging/GuardLogger";

export class SyntaxValidator {
  public validatePatchedDocument(
    document: vscode.TextDocument,
    fix: CodeFix,
    issue?: CodeIssue,
    candidate?: FixCandidate,
  ): SyntaxValidationResult {
    if (!this.isSupportedLanguage(document.languageId)) {
      GuardLogger.verbose(
        "Syntax",
        `Syntax validation skipped for unsupported language ${document.languageId}`,
      );
      return {
        isValid: true,
        diagnostics: [],
      };
    }

    const patchedText = this.applyFix(document, fix);
    const diagnostics = this.validateSyntax(patchedText, document.languageId);

    if (diagnostics.length === 0) {
      GuardLogger.verbose(
        "Syntax",
        `Syntax valid for patch at line ${fix.range.startLine + 1}${issue ? ` (rule=${issue.ruleId || "none"})` : ""}`,
      );
    } else {
      GuardLogger.error(
        "Syntax",
        `Syntax invalid after applying patch at line ${fix.range.startLine + 1}${issue ? ` (rule=${issue.ruleId || "none"})` : ""}: ${diagnostics.join(" | ")}${candidate?.target.nodeKind ? ` | nodeKind=${candidate.target.nodeKind}` : ""}`,
      );
    }

    return {
      isValid: diagnostics.length === 0,
      diagnostics,
    };
  }

  private applyFix(document: vscode.TextDocument, fix: CodeFix): string {
    const start = document.offsetAt(
      new vscode.Position(fix.range.startLine, fix.range.startColumn),
    );
    const end = document.offsetAt(
      new vscode.Position(fix.range.endLine, fix.range.endColumn),
    );
    const replacement = fix.type === "delete" ? "" : fix.replacement;
    const text = document.getText();
    return text.slice(0, start) + replacement + text.slice(end);
  }

  private validateSyntax(code: string, languageId: string): string[] {
    try {
      parse(code, {
        sourceType: "module",
        plugins: this.getParserPlugins(languageId),
      });
      return [];
    } catch (error: unknown) {
      const parseError = error as {
        message?: string;
        loc?: {
          line?: number;
          column?: number;
        };
      };
      const message = parseError.message || "Unknown syntax error";
      const line = parseError.loc?.line;
      const column = parseError.loc?.column;
      return [
        typeof line === "number" && typeof column === "number"
          ? `L${line}:C${column + 1} ${message}`
          : message,
      ];
    }
  }

  private isSupportedLanguage(languageId: string): boolean {
    return [
      "javascript",
      "javascriptreact",
      "typescript",
      "typescriptreact",
    ].includes(languageId);
  }

  private getParserPlugins(languageId: string): Array<"typescript" | "jsx"> {
    return languageId === "javascriptreact" || languageId === "typescriptreact"
      ? ["typescript", "jsx"]
      : ["typescript"];
  }
}
