export type IssueStatus = "open" | "applied" | "ignored";

export interface FixRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CodeFix {
  type: "replace" | "delete";
  range: FixRange;
  replacement: string;
}

export interface CodeIssue {
  id: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "warning" | "error" | "info";
  message: string;
  originalCode: string;
  suggestedFix?: string;
  fix?: CodeFix;
  source: "ai-generated" | "analysis";
  status: IssueStatus;
  isPreviewed?: boolean;
}

export interface ScanResult {
  fileUri: string;
  issues: CodeIssue[];
  timestamp: Date;
  scanDuration: number;
}

export interface GuardConfig {
  apiKey: string;
  scanMode: "realtime" | "onDemand" | "preCommit";
  enabledLanguages: string[];
}
