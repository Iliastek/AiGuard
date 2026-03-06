import * as vscode from "vscode";
import { CodeIssue, ScanResult } from "../types";

export class CodeAnalyzer {
  public async analyzeDocument(
    document: vscode.TextDocument,
  ): Promise<ScanResult> {
    const startTime = Date.now();
    const issues: CodeIssue[] = [];

    const text = document.getText();
    const lines = text.split("\n");

    // Einfache Demo-Analyse: Suche nach console.log
    lines.forEach((line, index) => {
      const consoleMatch = line.match(/console\.(log|warn|error)/);
      if (consoleMatch) {
        issues.push({
          id: `issue-${Date.now()}-${index}`,
          line: index,
          column: consoleMatch.index || 0,
          endLine: index,
          endColumn: line.length,
          severity: "warning",
          message: "AI Guard: Consider removing console statement",
          originalCode: line.trim(),
          suggestedFix: line.replace(
            /console\.(log|warn|error)\(.*?\);?/,
            "// Removed console",
          ),
          source: "analysis",
          status: "pending",
        });
      }

      // Suche nach TODO/FIXME
      const todoMatch = line.match(/(TODO|FIXME|XXX):(.*)/i);
      if (todoMatch) {
        issues.push({
          id: `issue-${Date.now()}-${index}-todo`,
          line: index,
          column: todoMatch.index || 0,
          endLine: index,
          endColumn: line.length,
          severity: "info",
          message: `AI Guard: ${todoMatch[1]} found - ${todoMatch[2].trim()}`,
          originalCode: line.trim(),
          source: "analysis",
          status: "pending",
        });
      }
    });

    const scanDuration = Date.now() - startTime;

    return {
      fileUri: document.uri.toString(),
      issues,
      timestamp: new Date(),
      scanDuration,
    };
  }
}
