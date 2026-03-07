import * as vscode from "vscode";
import * as https from "https";
import { CodeIssue } from "../types";

interface AIAnalyzerIssue {
  line?: number;
  severity?: "info" | "warning" | "error";
  message?: string;
  suggestedFix?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class AIAnalyzer {
  public async analyzeWithAPI(
    document: vscode.TextDocument,
  ): Promise<CodeIssue[]> {
    const config = vscode.workspace.getConfiguration("aiCodeGuard");
    const apiKey =
      process.env.AIGUARD_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      String(config.get("apiKey", "")).trim();

    if (!apiKey) {
      return [];
    }

    const model =
      process.env.AIGUARD_AI_MODEL?.trim() ||
      String(config.get("aiModel", "gpt-4o-mini"));
    const endpoint =
      process.env.AIGUARD_API_ENDPOINT?.trim() ||
      String(config.get("apiEndpoint", "https://api.openai.com/v1/chat/completions"));
    const maxChars = Number(
      process.env.AIGUARD_MAX_ANALYZED_CHARS || config.get("maxAnalyzedChars", 12000),
    );
    const timeoutMs = Number(
      process.env.AIGUARD_API_TIMEOUT_MS || config.get("apiTimeoutMs", 12000),
    );

    const prompt = this.buildPrompt(
      document.languageId,
      document.getText().slice(0, maxChars),
    );

    const payload = JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a strict static code reviewer. Return only compact JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const responseText = await this.postJSON(endpoint, apiKey, payload, timeoutMs);
    const parsed = this.extractAIResponseContent(responseText);
    const aiIssues = this.parseIssuesJson(parsed);

    return this.mapIssues(document, aiIssues);
  }

  private buildPrompt(languageId: string, code: string): string {
    return [
      "Analyze this code for bugs, security risks, maintainability issues, and suspicious AI-generated mistakes.",
      "Return JSON only in this format:",
      '{"issues":[{"line":number,"severity":"info|warning|error","message":"string","suggestedFix":"string optional"}]}',
      `Language: ${languageId}`,
      "Code:",
      code,
    ].join("\n");
  }

  private extractAIResponseContent(raw: string): string {
    const parsed = JSON.parse(raw) as ChatCompletionResponse;
    const content = parsed.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("AI API returned empty content");
    }

    return content;
  }

  private parseIssuesJson(content: string): AIAnalyzerIssue[] {
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as { issues?: AIAnalyzerIssue[] };
    if (!Array.isArray(parsed.issues)) {
      return [];
    }
    return parsed.issues;
  }

  private mapIssues(
    document: vscode.TextDocument,
    issues: AIAnalyzerIssue[],
  ): CodeIssue[] {
    return issues
      .filter((issue) => typeof issue.message === "string" && issue.message.trim().length > 0)
      .map((issue, index) => {
        const line = Math.max(0, Math.min((issue.line ?? 1) - 1, document.lineCount - 1));
        const lineText = document.lineAt(line).text;

        return {
          id: `ai-issue-${Date.now()}-${index}`,
          line,
          column: 0,
          endLine: line,
          endColumn: lineText.length,
          severity: issue.severity ?? "warning",
          message: `AI Guard: ${issue.message!.trim()}`,
          originalCode: lineText.trim(),
          suggestedFix: issue.suggestedFix?.trim() || undefined,
          source: "ai-generated",
          status: "pending",
        };
      });
  }

  private postJSON(
    endpoint: string,
    apiKey: string,
    body: string,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint);
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];

          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`AI API ${res.statusCode}: ${text}`));
              return;
            }
            resolve(text);
          });
        },
      );

      req.on("timeout", () => req.destroy(new Error("AI API request timed out")));
      req.on("error", (error) => reject(error));
      req.write(body);
      req.end();
    });
  }
}
