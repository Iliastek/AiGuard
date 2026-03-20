import OpenAI from "openai";
import { PromptBuilder } from "./PromptBuilder";

const MODEL = "gpt-4o-mini";
const MAX_CODE_CHARS = 12_000;

interface RawPatch {
  id?: string;
  startLine?: number;
  endLine?: number;
  patchType?: "insert" | "replace" | "delete";
  replacementCode?: string;
  targetSnippet?: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface RawIssue {
  line?: number;
  severity?: "info" | "warning" | "error";
  message?: string;
  codeSnippet?: string;
  patchId?: string;
  confidence?: number;
  target?: {
    strategy?: string;
    range?: { startLine?: number; endLine?: number };
    snippet?: string;
    contextBefore?: string;
    contextAfter?: string;
  };
  patch?: RawPatch;
}

interface RawAnalyzeResponse {
  issues?: RawIssue[];
  patches?: RawPatch[];
}

export interface NormalizedIssue {
  line: number;
  severity: "info" | "warning" | "error";
  message: string;
  codeSnippet?: string;
  confidence: number;
  patch?: RawPatch;
  target?: RawIssue["target"];
}

export class OpenAIService {
  private client: OpenAI | undefined;
  private promptBuilder = new PromptBuilder();

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is not set");
      }
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  async analyze(
    language: string,
    code: string,
  ): Promise<NormalizedIssue[]> {
    const truncated = code.slice(0, MAX_CODE_CHARS);
    const userPrompt = this.promptBuilder.buildAnalyzePrompt(language, truncated);

    const completion = await this.getClient().chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: PromptBuilder.SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    return this.parse(raw);
  }

  private parse(raw: string): NormalizedIssue[] {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as RawAnalyzeResponse;
    const patches = new Map<string, RawPatch>();

    for (const p of parsed.patches ?? []) {
      if (p.id) {
        patches.set(p.id, p);
      }
    }

    return (parsed.issues ?? []).map((issue) => {
      const resolvedPatch =
        (issue.patchId ? patches.get(issue.patchId) : undefined) ??
        issue.patch;

      return {
        line: issue.line ?? 0,
        severity: issue.severity ?? "warning",
        message: issue.message ?? "",
        codeSnippet: issue.codeSnippet,
        confidence: issue.confidence ?? 0,
        target: issue.target,
        patch: resolvedPatch,
      };
    });
  }
}
