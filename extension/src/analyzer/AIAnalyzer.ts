import * as vscode from "vscode";
import { CodeIssue } from "../types";
import { BackendClient } from "./BackendClient";
import {
  AIGUARD_API_ANALYZE,
  AIGUARD_CONFIG_SECTION,
  DEFAULT_MAX_ANALYZED_CHARS,
} from "../config";

interface AnalyzeResponse {
  issues: CodeIssue[];
}

export class AIAnalyzer {
  private client = new BackendClient();

  public async analyzeWithAPI(
    document: vscode.TextDocument,
  ): Promise<CodeIssue[]> {
    if (!this.client.hasLicenseKey()) {
      return [];
    }

    const config = vscode.workspace.getConfiguration(AIGUARD_CONFIG_SECTION);
    const maxChars = Number(
      process.env.AIGUARD_MAX_ANALYZED_CHARS ||
        config.get("maxAnalyzedChars", DEFAULT_MAX_ANALYZED_CHARS),
    );

    const responseText = await this.client.post(AIGUARD_API_ANALYZE, {
      code: document.getText().slice(0, maxChars),
      language: document.languageId,
      filePath: document.uri.fsPath,
    });

    const response = JSON.parse(responseText) as AnalyzeResponse;
    return response.issues
      .filter((issue) => issue.line >= 0 && issue.line < document.lineCount)
      .map((issue) => {
        const lineText = document.lineAt(issue.line).text;
        return {
          ...issue,
          endColumn: lineText.length > 0 ? lineText.length : 1,
        };
      });
  }
}
