import OpenAI from "openai";
import type { CodeIssue } from "@aiguard/shared";
import { PromptBuilder } from "./PromptBuilder";

const MODEL = "gpt-4o-mini";
const MAX_CODE_CHARS = 12_000;

type IssueType = "SECURITY" | "RELIABILITY" | "INJECTION" | "DATA_LEAKAGE";
type RawSeverity = "high" | "medium" | "low";

interface RawIssue {
  line?: number;
  type?: IssueType;
  severity?: RawSeverity;
  title?: string;
  explanation?: string;
  fix_code?: string;
  fix_explanation?: string;
}

interface RawAnalyzeResponse {
  issues?: RawIssue[];
}

interface NormalizedPatch {
  startLine: number;
  endLine: number;
  patchType: "replace";
  replacementCode: string;
}

export interface NormalizedIssue {
  line: number;
  type: IssueType;
  severity: "info" | "warning" | "error";
  message: string;
  codeSnippet?: string;
  confidence: number;
  patch?: NormalizedPatch;
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

  async generateFix(
    language: string,
    issue: CodeIssue,
    codeContext: string,
  ): Promise<string | undefined> {
    const userPrompt = this.promptBuilder.buildFixPrompt(language, issue, codeContext);

    const completion = await this.getClient().chat.completions.create({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: PromptBuilder.FIX_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as { replacement?: unknown };
    const replacement = parsed.replacement;
    return typeof replacement === "string" && replacement.trim()
      ? replacement.trim()
      : undefined;
  }

  private parse(raw: string): NormalizedIssue[] {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as RawAnalyzeResponse;

    return (parsed.issues ?? [])
      .filter((issue) => typeof issue.line === "number" && issue.line > 0)
      .map((issue) => {
        const line = issue.line as number;
        const patch: NormalizedPatch | undefined = issue.fix_code
          ? {
              startLine: line,
              endLine: line,
              patchType: "replace",
              replacementCode: issue.fix_code,
            }
          : undefined;

        return {
          line,
          type: issue.type ?? "SECURITY",
          severity: this.mapSeverity(issue.severity),
          message: issue.title ?? "",
          codeSnippet: issue.explanation,
          confidence: issue.severity === "high" ? 0.9 : issue.severity === "medium" ? 0.7 : 0.5,
          patch,
        };
      });
  }

  private mapSeverity(raw: RawSeverity | undefined): "info" | "warning" | "error" {
    if (raw === "high") return "error";
    if (raw === "medium") return "warning";
    return "info";
  }
}
