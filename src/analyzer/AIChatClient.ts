import * as https from "https";
import * as vscode from "vscode";

export interface AIChatRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class AIChatClient {
  public hasApiConfiguration(): boolean {
    return Boolean(this.getApiKey());
  }

  public async requestJson(request: AIChatRequest): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("AI API key is not configured");
    }

    const config = vscode.workspace.getConfiguration("aiCodeGuard");
    const endpoint =
      process.env.AIGUARD_API_ENDPOINT?.trim() ||
      String(
        config.get("apiEndpoint", "https://api.openai.com/v1/chat/completions"),
      );
    const payload = JSON.stringify({
      model:
        request.model ||
        process.env.AIGUARD_AI_MODEL?.trim() ||
        String(config.get("aiModel", "GPT-5.4")),
      temperature: request.temperature ?? 0,
      messages: [
        {
          role: "system",
          content: request.systemPrompt,
        },
        {
          role: "user",
          content: request.userPrompt,
        },
      ],
    });

    const responseText = await this.postJSON(
      endpoint,
      apiKey,
      payload,
      request.timeoutMs ?? this.getTimeoutMs(config),
    );
    const parsed = JSON.parse(responseText) as ChatCompletionResponse;
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI API returned empty content");
    }

    return content;
  }

  public cleanJsonResponse(content: string): string {
    return content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }

  private getApiKey(): string {
    const config = vscode.workspace.getConfiguration("aiCodeGuard");
    return (
      process.env.AIGUARD_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      String(config.get("apiKey", "")).trim()
    );
  }

  private getTimeoutMs(config: vscode.WorkspaceConfiguration): number {
    return Number(
      process.env.AIGUARD_API_TIMEOUT_MS || config.get("apiTimeoutMs", 12000),
    );
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

      req.on("timeout", () =>
        req.destroy(new Error("AI API request timed out")),
      );
      req.on("error", (error) => reject(error));
      req.write(body);
      req.end();
    });
  }
}
