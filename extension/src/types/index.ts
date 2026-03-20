export type IssueStatus = "open" | "applied" | "ignored";
export type IssueFixability = "auto" | "suggestion" | "manual";
export type IssueUIStatus = "OPEN" | "FIX_READY" | "BLOCKED";

export interface FixRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CodeFix {
  type: "insert" | "replace" | "delete";
  range: FixRange;
  replacement: string;
}

export type IssuePipelineStage =
  | "analysis"
  | "generated"
  | "reviewed"
  | "patched"
  | "validated"
  | "previewable"
  | "rejected";

export interface IssueAnalysis {
  summary: string;
  source: "ai-analysis" | "local-analysis";
}

export interface FixCandidateTarget {
  strategy?: "line-range" | "block-range" | "exact-range";
  range?: FixRange;
  snippet?: string;
  nodeKind?: string;
  parentKind?: string;
  contextBefore?: string;
  contextAfter?: string;
  expectedOccurrence?: number;
}

export interface FixCandidate {
  source: "rule" | "generator" | "analysis-seed";
  patchType: CodeFix["type"];
  replacement: string;
  rationale?: string;
  confidence?: number;
  target: FixCandidateTarget;
}

export interface FixReview {
  status: "approved" | "rejected";
  confidence: number;
  rationale: string;
  risks: string[];
}

export interface PatchResult {
  status: "resolved" | "rejected";
  strategy: "line-range" | "block-range" | "exact-range" | "snippet" | "none";
  fix?: CodeFix;
  reason?: string;
}

export interface SyntaxValidationResult {
  isValid: boolean;
  diagnostics: string[];
}

export interface DiffHunk {
  startLine: number;
  endLine: number;
  before: string;
  after: string;
  summary: string;
}

export interface IssuePipelineState {
  stage: IssuePipelineStage;
  lastError?: string;
}

export interface CodeIssue {
  id: string;
  ruleId?: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "warning" | "error" | "info";
  message: string;
  originalCode: string;
  recommendation?: string;
  fixability?: IssueFixability;
  uiStatus?: IssueUIStatus;
  suggestedFix?: string;
  fix?: CodeFix;
  patchId?: string;
  analysis?: IssueAnalysis;
  fixCandidate?: FixCandidate;
  review?: FixReview;
  patchResult?: PatchResult;
  syntaxCheck?: SyntaxValidationResult;
  diff?: DiffHunk;
  pipeline?: IssuePipelineState;
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
  licenseKey: string;
  scanMode: "realtime" | "onDemand" | "preCommit";
  enabledLanguages: string[];
}
