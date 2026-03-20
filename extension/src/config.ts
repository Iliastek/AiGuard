// Central config constants for the AiGuard extension.
// Never hardcode these values elsewhere — always import from here.

export const AIGUARD_API_BASE_URL =
  process.env.AIGUARD_API_BASE_URL ?? "https://api.aiguard.dev";

export const AIGUARD_API_ANALYZE = `${AIGUARD_API_BASE_URL}/v1/analyze`;
export const AIGUARD_API_FIX_GENERATE = `${AIGUARD_API_BASE_URL}/v1/fix/generate`;

export const AIGUARD_CONFIG_SECTION = "aiCodeGuard";

export const SUPPORTED_LANGUAGES = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "python",
  "java",
  "csharp",
  "cpp",
  "go",
  "rust",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const AI_SCAN_DEBOUNCE_MS = 500;
export const DEFAULT_MAX_ANALYZED_CHARS = 12000;
export const DEFAULT_SCAN_MODE = "realtime" as const;
