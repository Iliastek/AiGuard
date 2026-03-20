// Shared types between extension and backend
// Import everything from @aiguard/shared in both packages

export type { CodeIssue, ScanResult, GuardConfig } from "./types";
export type {
  CodeFix,
  FixRange,
  FixCandidate,
  FixCandidateTarget,
  FixReview,
  PatchResult,
  SyntaxValidationResult,
  DiffHunk,
  IssueAnalysis,
  IssuePipelineState,
} from "./types";
export type {
  IssueStatus,
  IssueFixability,
  IssueUIStatus,
  IssuePipelineStage,
} from "./types";

// API contract between extension and backend
export type { AnalyzeRequest, AnalyzeResponse, FixRequest, FixResponse } from "./api";
