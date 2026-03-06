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
  source: "ai-generated" | "analysis";
  status: "pending" | "applied" | "ignored";
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
