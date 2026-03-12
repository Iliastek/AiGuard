import * as vscode from "vscode";
import { CodeIssue, ScanResult } from "../types";

type GuardPanelAction =
  | { type: "applyFix"; issueId: string }
  | { type: "viewRecommendation"; issueId: string }
  | { type: "ignoreIssue"; issueId: string }
  | { type: "applyAll" }
  | { type: "ignoreAll" };

export class GuardPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiguard.sidebarView";
  private view?: vscode.WebviewView;
  private lastResult?: ScanResult;
  private isWebviewReady = false;
  private actionHandler?: (action: GuardPanelAction) => void | Promise<void>;

  public setActionHandler(
    handler: (action: GuardPanelAction) => void | Promise<void>,
  ): void {
    this.actionHandler = handler;
  }

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
        return;
      }

      if (
        (message?.type === "applyFix" ||
          message?.type === "ignoreIssue" ||
          message?.type === "viewRecommendation") &&
        typeof message?.issueId === "string" &&
        this.actionHandler
      ) {
        void this.actionHandler({
          type: message.type,
          issueId: message.issueId,
        });
        return;
      }

      if (
        (message?.type === "applyAll" || message?.type === "ignoreAll") &&
        this.actionHandler
      ) {
        void this.actionHandler({ type: message.type });
      }
    });

    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  public updateFromScanResult(result: ScanResult): void {
    this.lastResult = result;
    this.pushCurrentState();
  }

  private serializeIssue(issue: CodeIssue): Record<string, unknown> {
    return {
      id: issue.id,
      line: issue.line,
      severity: issue.severity,
      message: issue.message,
      source: issue.source,
      status: issue.status,
      fixability: issue.fixability,
      uiStatus: issue.uiStatus,
      recommendation: issue.recommendation,
      pipelineStage: issue.pipeline?.stage,
      reviewStatus: issue.review?.status,
      reviewConfidence: issue.review?.confidence,
      syntaxValid: issue.syntaxCheck?.isValid,
      diffSummary: issue.diff?.summary,
      diffBefore: issue.diff?.before,
      diffAfter: issue.diff?.after,
      patchType:
        issue.fix?.type ||
        issue.patchResult?.fix?.type ||
        issue.fixCandidate?.patchType,
      hasFix: this.canApplyIssueFix(
        issue.fix,
        issue.fixability,
        issue.uiStatus,
      ),
      hasValidatedFix:
        issue.status === "open" &&
        issue.pipeline?.stage === "previewable" &&
        issue.patchResult?.status === "resolved" &&
        issue.syntaxCheck?.isValid === true &&
        Boolean(issue.fix),
      isPreviewed: Boolean(issue.isPreviewed),
    };
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
            issues: this.lastResult.issues.map((issue) =>
              this.serializeIssue(issue),
            ),
          }
        : null,
    });
  }

  private canApplyIssueFix(
    fix: unknown,
    fixability: unknown,
    uiStatus: unknown,
  ): boolean {
    return Boolean(fix && fixability === "auto" && uiStatus === "FIX_READY");
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
    .row {
      display: flex;
      gap: 8px;
    }
    .btn {
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
    }
    #issues-list,
    #fixes-list {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    #issues-list li,
    #fixes-list li {
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .issue-item {
      list-style: none;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 8px;
      margin-left: -18px;
    }
    .issue-item.previewed {
      border-color: var(--vscode-focusBorder);
      background: rgba(56, 189, 248, 0.08);
    }
    .issue-item.applied,
    .issue-item.ignored {
      opacity: 0.65;
    }
    .issue-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status-pill {
      font-size: 11px;
      border-radius: 999px;
      padding: 1px 8px;
      border: 1px solid var(--vscode-panel-border);
    }
    .status-open {
      background: rgba(250, 204, 21, 0.15);
      color: #d97706;
    }
    .status-preview {
      background: rgba(56, 189, 248, 0.15);
      color: #0284c7;
    }
    .status-applied {
      background: rgba(34, 197, 94, 0.15);
      color: #16a34a;
    }
    .status-ignored {
      background: rgba(148, 163, 184, 0.15);
      color: var(--vscode-descriptionForeground);
    }
    .issue-message {
      margin-top: 4px;
    }
    .issue-meta {
      margin-top: 6px;
      font-size: 11px;
      opacity: 0.8;
      line-height: 1.4;
    }
    .fixability-badge {
      font-size: 11px;
      border-radius: 999px;
      padding: 1px 8px;
      border: 1px solid var(--vscode-panel-border);
      background: rgba(148, 163, 184, 0.12);
    }
    .issue-actions {
      display: inline-flex;
      gap: 6px;
      margin-top: 8px;
    }
    .issue-actions button {
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 11px;
    }
    .diff-block {
      margin-top: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .diff-line {
      margin: 0;
      padding: 6px 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .diff-line.before {
      background: rgba(239, 68, 68, 0.08);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .diff-line.after {
      background: rgba(34, 197, 94, 0.08);
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
    <div class="row">
      <button class="btn" id="apply-all-btn">Apply All</button>
      <button class="btn" id="ignore-all-btn">Ignore All</button>
    </div>
    <ul id="issues-list"></ul>
  </section>

  <section id="fixes" class="section">
    <div class="title">Fixes</div>
    <div id="fixes-meta" class="muted">Validated patches will appear here after a scan.</div>
    <ul id="fixes-list"></ul>
  </section>

  <section id="history" class="section">
    <div class="title">History</div>
    <div class="muted">Recent scan summaries will appear here.</div>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const issuesMeta = document.getElementById("issues-meta");
    const issuesList = document.getElementById("issues-list");
    const fixesMeta = document.getElementById("fixes-meta");
    const fixesList = document.getElementById("fixes-list");
    const applyAllBtn = document.getElementById("apply-all-btn");
    const ignoreAllBtn = document.getElementById("ignore-all-btn");
    const tabs = document.querySelectorAll(".tab");
    const sections = document.querySelectorAll(".section");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        if (!target) {
          return;
        }
        tabs.forEach((item) => item.classList.remove("active"));
        sections.forEach((section) => section.classList.remove("active"));
        tab.classList.add("active");
        const targetSection = document.getElementById(target);
        if (targetSection) {
          targetSection.classList.add("active");
        }
      });
    });

    const normalizeStatus = (rawStatus) => {
      if (rawStatus === "applied" || rawStatus === "ignored" || rawStatus === "open") {
        return rawStatus;
      }
      return "open";
    };

    const resolvePrimaryAction = (issue, canApply) => {
      if (issue.fixability === "suggestion") {
        return {
          action: "viewRecommendation",
          label: "View Recommendation",
          disabled: false,
        };
      }

      if (issue.fixability === "manual") {
        return {
          action: "manualBlocked",
          label: "Manual fix required",
          disabled: true,
        };
      }

      return {
        action: "applyFix",
        label: canApply ? "Apply" : "Preview blocked",
        disabled: !canApply,
      };
    };

    const createIssueItem = (issue) => {
      const status = normalizeStatus(issue.status);
      const lineLabel = issue.line >= 0 ? "Line " + (issue.line + 1) : "Unknown line";
      const isPreviewed = Boolean(issue.isPreviewed && status === "open");
      const canApply = Boolean(status === "open" && isPreviewed);
      const canIgnore = Boolean(status === "open");
      const icon = status === "applied" ? "✔" : status === "ignored" ? "○" : isPreviewed ? "🔎" : "⚠";
      const pillClass = status === "applied" ? "status-applied" : status === "ignored" ? "status-ignored" : isPreviewed ? "status-preview" : "status-open";
      const itemClass = status === "applied" ? "issue-item applied" : status === "ignored" ? "issue-item ignored" : isPreviewed ? "issue-item previewed" : "issue-item";

      const li = document.createElement("li");
      li.className = itemClass;

      const head = document.createElement("div");
      head.className = "issue-head";

      const sev = document.createElement("strong");
      sev.textContent = icon + " [" + String(issue.severity || "warning") + "]";
      head.appendChild(sev);

      const line = document.createElement("span");
      line.textContent = lineLabel;
      head.appendChild(line);

      const pill = document.createElement("span");
      pill.className = "status-pill " + pillClass;
      pill.textContent = status === "open" && issue.uiStatus ? String(issue.uiStatus) : status.toUpperCase();
      head.appendChild(pill);

      if (issue.fixability) {
        const fixability = document.createElement("span");
        fixability.className = "fixability-badge";
        fixability.textContent = "fixability: " + String(issue.fixability);
        head.appendChild(fixability);
      }

      const source = document.createElement("em");
      source.textContent = "(" + String(issue.source || "analysis") + ")";
      head.appendChild(source);

      li.appendChild(head);

      const message = document.createElement("div");
      message.className = "issue-message";
      message.textContent = String(issue.message || "");
      li.appendChild(message);

      const meta = [];
      if (issue.pipelineStage) {
        meta.push("pipeline: " + String(issue.pipelineStage));
      }
      if (issue.uiStatus) {
        meta.push("status: " + String(issue.uiStatus));
      }
      if (issue.reviewStatus) {
        const confidence = typeof issue.reviewConfidence === "number"
          ? " @ " + Math.round(issue.reviewConfidence * 100) + "%"
          : "";
        meta.push("critic: " + String(issue.reviewStatus) + confidence);
      }
      if (typeof issue.syntaxValid === "boolean") {
        meta.push("syntax: " + (issue.syntaxValid ? "valid" : "invalid"));
      }
      if (issue.diffSummary) {
        meta.push(String(issue.diffSummary));
      }

      if (meta.length > 0) {
        const metaLine = document.createElement("div");
        metaLine.className = "issue-meta";
        metaLine.textContent = meta.join(" | ");
        li.appendChild(metaLine);
      }

      const actions = document.createElement("span");
      actions.className = "issue-actions";

      const primary = resolvePrimaryAction(issue, canApply);

      const primaryButton = document.createElement("button");
      if (primary.action !== "manualBlocked") {
        primaryButton.setAttribute("data-action", primary.action);
        primaryButton.setAttribute("data-issue-id", String(issue.id || ""));
      }
      primaryButton.textContent = primary.label;
      primaryButton.disabled = primary.disabled;
      actions.appendChild(primaryButton);

      const ignoreButton = document.createElement("button");
      ignoreButton.setAttribute("data-action", "ignoreIssue");
      ignoreButton.setAttribute("data-issue-id", String(issue.id || ""));
      ignoreButton.textContent = "Ignore";
      ignoreButton.disabled = !canIgnore;
      actions.appendChild(ignoreButton);

      li.appendChild(actions);
      return li;
    };

    const createFixItem = (issue) => {
      const li = document.createElement("li");
      li.className = issue.status === "open" && issue.isPreviewed ? "issue-item previewed" : "issue-item";

      const head = document.createElement("div");
      head.className = "issue-head";

      const sev = document.createElement("strong");
      sev.textContent = "✓ [" + String(issue.severity || "warning") + "]";
      head.appendChild(sev);

      const line = document.createElement("span");
      line.textContent = issue.line >= 0 ? "Line " + (issue.line + 1) : "Structured patch";
      head.appendChild(line);

      const patchType = document.createElement("span");
      patchType.className = "fixability-badge";
      patchType.textContent = "patch: " + String(issue.patchType || "replace");
      head.appendChild(patchType);

      li.appendChild(head);

      const message = document.createElement("div");
      message.className = "issue-message";
      message.textContent = String(issue.message || "");
      li.appendChild(message);

      const meta = [];
      if (issue.diffSummary) {
        meta.push(String(issue.diffSummary));
      }
      meta.push("syntax: valid");
      if (issue.reviewStatus) {
        const confidence = typeof issue.reviewConfidence === "number"
          ? " @ " + Math.round(issue.reviewConfidence * 100) + "%"
          : "";
        meta.push("critic: " + String(issue.reviewStatus) + confidence);
      }

      const metaLine = document.createElement("div");
      metaLine.className = "issue-meta";
      metaLine.textContent = meta.join(" | ");
      li.appendChild(metaLine);

      if (typeof issue.diffBefore === "string" || typeof issue.diffAfter === "string") {
        const diffBlock = document.createElement("div");
        diffBlock.className = "diff-block";

        const before = document.createElement("pre");
        before.className = "diff-line before";
        before.textContent = "- " + String(issue.diffBefore || "");
        diffBlock.appendChild(before);

        const after = document.createElement("pre");
        after.className = "diff-line after";
        after.textContent = "+ " + String(issue.diffAfter || "");
        diffBlock.appendChild(after);

        li.appendChild(diffBlock);
      }

      const actions = document.createElement("span");
      actions.className = "issue-actions";

      const applyButton = document.createElement("button");
      applyButton.setAttribute("data-action", "applyFix");
      applyButton.setAttribute("data-issue-id", String(issue.id || ""));
      applyButton.textContent = issue.status === "open" && issue.isPreviewed ? "Apply" : "Applied";
      applyButton.disabled = !(issue.status === "open" && issue.isPreviewed);
      actions.appendChild(applyButton);

      const ignoreButton = document.createElement("button");
      ignoreButton.setAttribute("data-action", "ignoreIssue");
      ignoreButton.setAttribute("data-issue-id", String(issue.id || ""));
      ignoreButton.textContent = "Ignore";
      ignoreButton.disabled = issue.status !== "open";
      actions.appendChild(ignoreButton);

      li.appendChild(actions);
      return li;
    };

    const renderIssues = (payload) => {
      if (!payload) {
        issuesMeta.textContent = 'No scan data yet. Run "AI Guard: Scan Current File".';
        issuesList.innerHTML = "";
        if (fixesMeta) {
          fixesMeta.textContent = "Validated patches will appear here after a scan.";
        }
        if (fixesList) {
          fixesList.innerHTML = "";
        }
        return;
      }

      const issueCount = payload.issues.length;
      const validatedFixes = payload.issues.filter((issue) => Boolean(issue.hasValidatedFix));
      issuesMeta.textContent = "Last scan: " + issueCount + " issue(s) in " + payload.scanDuration + "ms";
      if (fixesMeta) {
        fixesMeta.textContent = validatedFixes.length > 0
          ? validatedFixes.length + " validated patch(es) ready for preview/apply"
          : "No validated patches available for this scan.";
      }

      if (issueCount === 0) {
        issuesList.innerHTML = "<li>No issues found.</li>";
        if (fixesList) {
          fixesList.innerHTML = "<li>No validated patches.</li>";
        }
        return;
      }

      issuesList.innerHTML = "";
      payload.issues.forEach((issue) => {
        issuesList.appendChild(createIssueItem(issue));
      });

      if (fixesList) {
        fixesList.innerHTML = "";
        if (validatedFixes.length === 0) {
          fixesList.innerHTML = "<li>No validated patches.</li>";
        } else {
          validatedFixes.forEach((issue) => {
            fixesList.appendChild(createFixItem(issue));
          });
        }
      }
    };

    const handleActionClick = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const type = target.dataset.action;
      const issueId = target.dataset.issueId;
      if (!type || !issueId) {
        return;
      }

      vscode.postMessage({ type, issueId });
    };

    issuesList.addEventListener("click", handleActionClick);
    if (fixesList) {
      fixesList.addEventListener("click", handleActionClick);
    }

    if (applyAllBtn) {
      applyAllBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "applyAll" });
      });
    }

    if (ignoreAllBtn) {
      ignoreAllBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "ignoreAll" });
      });
    }

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
