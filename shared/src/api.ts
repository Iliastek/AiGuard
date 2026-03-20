import type { CodeIssue } from "./types";

// POST /v1/analyze
// Extension sends code → backend returns issues with fix candidates
export interface AnalyzeRequest {
  code: string;
  language: string;
  filePath: string;
}

export interface AnalyzeResponse {
  issues: CodeIssue[];
  scanDurationMs: number;
}

// POST /v1/fix/generate
// Backend generates a fix candidate for a specific issue
export interface FixRequest {
  issue: CodeIssue;
  codeContext: string;
  language: string;
}

export interface FixResponse {
  issue: CodeIssue;
}
