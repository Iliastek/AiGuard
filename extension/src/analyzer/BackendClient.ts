import * as http from "http";
import * as https from "https";
import * as vscode from "vscode";
import { AIGUARD_CONFIG_SECTION } from "../config";

export class BackendClient {
  public hasLicenseKey(): boolean {
    return Boolean(this.getLicenseKey());
  }

  public async post(url: string, body: unknown, timeoutMs = 15_000): Promise<string> {
    const licenseKey = this.getLicenseKey();
    if (!licenseKey) {
      throw new Error("AiGuard license key is not configured");
    }

    return this.postJSON(url, licenseKey, JSON.stringify(body), timeoutMs);
  }

  private getLicenseKey(): string {
    const config = vscode.workspace.getConfiguration(AIGUARD_CONFIG_SECTION);
    return (
      process.env.AIGUARD_LICENSE_KEY?.trim() ||
      String(config.get("licenseKey", "")).trim()
    );
  }

  private postJSON(
    url: string,
    licenseKey: string,
    body: string,
    timeoutMs: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === "https:" ? https : http;
      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: `${parsed.pathname}${parsed.search}`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${licenseKey}`,
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
              reject(new Error(`Backend ${res.statusCode}: ${text}`));
              return;
            }
            resolve(text);
          });
        },
      );

      req.on("timeout", () =>
        req.destroy(new Error("Backend request timed out")),
      );
      req.on("error", (error) => reject(error));
      req.write(body);
      req.end();
    });
  }
}
