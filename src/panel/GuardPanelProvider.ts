import * as vscode from "vscode";
import { ScanResult } from "../types";

export class GuardPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiguard.sidebarView";
  private view?: vscode.WebviewView;
  private lastResult?: ScanResult;
  private isWebviewReady = false;

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.isWebviewReady = false;
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message?.type === "ready") {
        this.isWebviewReady = true;
        this.pushCurrentState();
      }
    });

    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  public updateFromScanResult(result: ScanResult): void {
    this.lastResult = result;
    this.pushCurrentState();
  }

  private pushCurrentState(): void {
    if (!this.view || !this.isWebviewReady) {
      return;
    }

    this.view.webview.postMessage({
      type: "setIssues",
      payload: this.lastResult
        ? {
            fileUri: this.lastResult.fileUri,
            scanDuration: this.lastResult.scanDuration,
            timestamp: this.lastResult.timestamp.toISOString(),
            issues: this.lastResult.issues.map((issue) => ({
              line: issue.line,
              severity: issue.severity,
              message: issue.message,
              source: issue.source,
            })),
          }
        : null,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = this.createNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Guard</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
    }
    .tab {
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }
    .section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 10px;
      display: none;
    }
    .section.active {
      display: block;
    }
    .title {
      font-weight: 600;
      margin-bottom: 8px;
    }
    .muted {
      opacity: 0.8;
      line-height: 1.4;
    }
    #issues-list {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    #issues-list li {
      margin-bottom: 8px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab active" data-tab="issues">Issues</button>
    <button class="tab" data-tab="fixes">Fixes</button>
    <button class="tab" data-tab="history">History</button>
  </div>

  <section id="issues" class="section active">
    <div class="title">Issues</div>
    <div id="issues-meta" class="muted">No scan data yet. Run "AI Guard: Scan Current File".</div>
    <ul id="issues-list"></ul>
  </section>

  <section id="fixes" class="section">
    <div class="title">Fixes</div>
    <div class="muted">Apply/Ignore actions will appear here in the next step.</div>
  </section>

  <section id="history" class="section">
    <div class="title">History</div>
    <div class="muted">Recent scan summaries will appear here.</div>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const issuesMeta = document.getElementById("issues-meta");
    const issuesList = document.getElementById("issues-list");
    const tabs = document.querySelectorAll(".tab");
    const sections = document.querySelectorAll(".section");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach((item) => item.classList.remove("active"));
        sections.forEach((section) => section.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(target).classList.add("active");
      });
    });

    const renderIssues = (payload) => {
      if (!payload) {
        issuesMeta.textContent = 'No scan data yet. Run "AI Guard: Scan Current File".';
        issuesList.innerHTML = "";
        return;
      }

      const issueCount = payload.issues.length;
      issuesMeta.textContent = "Last scan: " + issueCount + " issue(s) in " + payload.scanDuration + "ms";

      if (issueCount === 0) {
        issuesList.innerHTML = "<li>No issues found.</li>";
        return;
      }

      const rows = payload.issues.map((issue) => {
        const lineLabel = issue.line >= 0 ? "Line " + (issue.line + 1) : "Unknown line";
        return "<li><strong>[" + issue.severity + "]</strong> " + lineLabel + " - " + issue.message + " <em>(" + issue.source + ")</em></li>";
      });

      issuesList.innerHTML = rows.join("");
    };

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message?.type === "setIssues") {
        renderIssues(message.payload);
      }
    });

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }

  private createNonce(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let i = 0; i < 32; i += 1) {
      value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
  }
}
