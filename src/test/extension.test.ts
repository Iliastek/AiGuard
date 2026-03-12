import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { CodeAnalyzer } from "../analyzer/CodeAnalyzer";
import { ScanCommands } from "../commands/ScanCommands";
import { ScanPipelineService } from "../commands/ScanPipelineService";
import { GuardState } from "../statusBar/StatusBarController";
import { CodeIssue, ScanResult } from "../types";

type TestStatusBar = {
  getState(): GuardState;
  setState(state: GuardState): void;
};

type TestPanelProvider = {
  updateFromScanResult(result: ScanResult): void;
};

suite("Extension Test Suite", () => {
  let originalScanMode: string | undefined;

  suiteSetup(async () => {
    originalScanMode = vscode.workspace
      .getConfiguration("aiCodeGuard")
      .get<string>("scanMode");
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration("aiCodeGuard")
      .update(
        "scanMode",
        originalScanMode ?? "realtime",
        vscode.ConfigurationTarget.Workspace,
      );
  });

  teardown(async () => {
    await vscode.workspace
      .getConfiguration("aiCodeGuard")
      .update("scanMode", "realtime", vscode.ConfigurationTarget.Workspace);
  });

  test("queues Copilot-like edits and scans on save in realtime mode", async () => {
    await setScanMode("realtime");

    const statusBar = createStatusBar();
    const panelProvider = createPanelProvider();
    const scanCommands = new ScanCommands(
      statusBar as never,
      panelProvider as never,
    );
    const document = await createWorkspaceDocument(
      "realtime-save-test.ts",
      "export const value = 1;\n",
    );

    const analyzeCalls: string[] = [];
    (
      scanCommands as unknown as {
        analyzeAICode: (doc: vscode.TextDocument) => Promise<void>;
      }
    ).analyzeAICode = async (doc: vscode.TextDocument) => {
      analyzeCalls.push(doc.uri.toString());
    };

    try {
      scanCommands.startRealtimeMonitoring();
      await applyLargeAIGeneratedEdit(
        document,
        "function loginUser() {\n  const token = createToken();\n  return token;\n}\n",
      );
      await delay(700);

      const pendingBeforeSave = getPendingScanCount(scanCommands);
      assert.strictEqual(pendingBeforeSave, 1);

      await document.save();
      await delay(300);

      assert.strictEqual(analyzeCalls.length, 1);
      assert.strictEqual(analyzeCalls[0], document.uri.toString());
      assert.strictEqual(getPendingScanCount(scanCommands), 0);
    } finally {
      scanCommands.stopRealtimeMonitoring();
    }
  });

  test("does not auto-monitor documents in onDemand mode", async () => {
    await setScanMode("onDemand");

    const statusBar = createStatusBar();
    const panelProvider = createPanelProvider();
    const scanCommands = new ScanCommands(
      statusBar as never,
      panelProvider as never,
    );
    const document = await createWorkspaceDocument(
      "ondemand-mode-test.ts",
      "export const mode = 'manual';\n",
    );

    const analyzeCalls: string[] = [];
    (
      scanCommands as unknown as {
        analyzeAICode: (doc: vscode.TextDocument) => Promise<void>;
      }
    ).analyzeAICode = async (doc: vscode.TextDocument) => {
      analyzeCalls.push(doc.uri.toString());
    };

    scanCommands.startRealtimeMonitoring();

    await applyLargeAIGeneratedEdit(
      document,
      "function loginUser() {\n  const token = createToken();\n  return token;\n}\n",
    );
    await delay(700);
    await document.save();
    await delay(300);

    assert.strictEqual(getPendingScanCount(scanCommands), 0);
    assert.strictEqual(analyzeCalls.length, 0);
  });

  test("manual scan clears pending queued scan for current file", async () => {
    await setScanMode("realtime");

    const statusBar = createStatusBar();
    const panelProvider = createPanelProvider();
    const scanCommands = new ScanCommands(
      statusBar as never,
      panelProvider as never,
    );
    const document = await createWorkspaceDocument(
      "manual-scan-test.ts",
      "export const manual = true;\n",
    );

    await vscode.window.showTextDocument(document);

    (
      scanCommands as unknown as {
        runAnalysis: (doc: vscode.TextDocument) => Promise<ScanResult>;
        initializePreviewMode: (
          result: ScanResult,
          doc: vscode.TextDocument,
        ) => Promise<void>;
        applyIssueDecorations: (
          doc: vscode.TextDocument,
          issues: unknown[],
        ) => void;
      }
    ).runAnalysis = async (doc: vscode.TextDocument) => ({
      fileUri: doc.uri.toString(),
      issues: [],
      timestamp: new Date(),
      scanDuration: 0,
    });
    (
      scanCommands as unknown as {
        initializePreviewMode: (
          result: ScanResult,
          doc: vscode.TextDocument,
        ) => Promise<void>;
      }
    ).initializePreviewMode = async () => {};
    (
      scanCommands as unknown as {
        applyIssueDecorations: (
          doc: vscode.TextDocument,
          issues: unknown[],
        ) => void;
      }
    ).applyIssueDecorations = () => {};

    getPendingScanMap(scanCommands).set(document.uri.toString(), {
      uri: document.uri.toString(),
      version: document.version,
      queuedAt: Date.now(),
      languageId: document.languageId,
    });

    await scanCommands.scanCurrentFile();

    assert.strictEqual(getPendingScanCount(scanCommands), 0);
  });

  test("detects hardcoded credentials as auto-fixable", async () => {
    const document = await createWorkspaceDocument(
      "hardcoded-credentials-test.js",
      [
        'const express = require("express");',
        "const app = express();",
        'app.post("/login", (req, res) => {',
        "  const { username, password } = req.body;",
        '  if (username === "admin" && password === "password123") {',
        "    return res.json({ ok: true });",
        "  }",
        "});",
        "",
      ].join("\n"),
    );

    const analyzer = new CodeAnalyzer();
    const result = await analyzer.analyzeDocument(document);
    const issue = result.issues.find((item) =>
      /hardcoded credentials/i.test(item.message),
    );

    assert.ok(issue, "Expected hardcoded credentials issue to be detected");
    assert.strictEqual(issue?.fixability, "auto");
    assert.strictEqual(issue?.ruleId, "hardcoded-credentials");
  });

  test("rule-based auto fix reaches FIX_READY for hardcoded credentials", async () => {
    const document = await createWorkspaceDocument(
      "hardcoded-fix-ready-test.js",
      [
        'const express = require("express");',
        "const app = express();",
        'app.post("/login", (req, res) => {',
        "  const { username, password } = req.body;",
        '  if (username === "admin" && password === "password123") {',
        "    return res.json({ ok: true });",
        "  }",
        "});",
        "",
      ].join("\n"),
    );

    const analyzer = new CodeAnalyzer();
    const pipeline = new ScanPipelineService();
    const result = await analyzer.analyzeDocument(document);
    const hardcodedIssue = result.issues.find(
      (item) => item.ruleId === "hardcoded-credentials",
    );
    assert.ok(
      hardcodedIssue,
      "Expected hardcoded credentials issue to be present",
    );

    const processed = await pipeline.processIssues(document, [hardcodedIssue!]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].uiStatus, "FIX_READY");
    assert.strictEqual(processed[0].fixability, "auto");
    assert.strictEqual(processed[0].review?.status, "approved");
    assert.strictEqual(processed[0].syntaxCheck?.isValid, true);
    assert.ok(processed[0].fix, "Expected deterministic fix to be available");
  });

  test("structured patch candidate carries AST match metadata", async () => {
    const document = await createWorkspaceDocument(
      "structured-patch-candidate-test.js",
      [
        'const express = require("express");',
        "const app = express();",
        'app.post("/login", (req, res) => {',
        "  const { username, password } = req.body;",
        '  if (username === "admin" && password === "password123") {',
        "    return res.json({ ok: true });",
        "  }",
        "});",
        "",
      ].join("\n"),
    );

    const analyzer = new CodeAnalyzer();
    const pipeline = new ScanPipelineService();
    const result = await analyzer.analyzeDocument(document);
    const hardcodedIssue = result.issues.find(
      (item) => item.ruleId === "hardcoded-credentials",
    );
    assert.ok(
      hardcodedIssue,
      "Expected hardcoded credentials issue to be present",
    );

    const processed = await pipeline.processIssues(document, [hardcodedIssue!]);
    assert.strictEqual(
      processed[0].fixCandidate?.target.strategy,
      "line-range",
    );
    assert.strictEqual(
      processed[0].fixCandidate?.replacement,
      "  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {",
    );
    assert.strictEqual(
      processed[0].fixCandidate?.target.snippet,
      '  if (username === "admin" && password === "password123") {',
    );
  });

  test("ai-generated suggested fix enters structured pipeline and becomes FIX_READY", async () => {
    const document = await createWorkspaceDocument(
      "ai-seeded-fix-ready-test.js",
      'const password = "secret";\n',
    );

    const pipeline = new ScanPipelineService();
    const issue: CodeIssue = {
      id: "ai-seeded-issue",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: document.lineAt(0).text.length,
      severity: "warning",
      message: "AI Guard: Replace hardcoded secret with environment variable",
      originalCode: document.lineAt(0).text,
      suggestedFix: "const password = process.env.ADMIN_PASS;",
      source: "ai-generated",
      status: "open",
    };

    const processed = await pipeline.processIssues(document, [issue]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].fixability, "auto");
    assert.strictEqual(processed[0].fixCandidate?.source, "analysis-seed");
    assert.strictEqual(processed[0].patchResult?.status, "resolved");
    assert.strictEqual(processed[0].syntaxCheck?.isValid, true);
    assert.strictEqual(processed[0].uiStatus, "FIX_READY");
  });

  test("critic rejection stays advisory when patch resolves and syntax is valid", async () => {
    const document = await createWorkspaceDocument(
      "critic-advisory-test.js",
      'const password = "secret";\n',
    );

    const pipeline = new ScanPipelineService();
    (
      pipeline as unknown as {
        critic: {
          review: () => Promise<{
            status: "approved" | "rejected";
            confidence: number;
            rationale: string;
            risks: string[];
          }>;
        };
      }
    ).critic = {
      review: async () => ({
        status: "rejected",
        confidence: 0.18,
        rationale: "Potential runtime behavior change",
        risks: ["requires review"],
      }),
    };

    const issue: CodeIssue = {
      id: "critic-advisory-issue",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: document.lineAt(0).text.length,
      severity: "warning",
      message: "AI Guard: Replace hardcoded secret with environment variable",
      originalCode: document.lineAt(0).text,
      source: "ai-generated",
      status: "open",
      fixCandidate: {
        source: "analysis-seed",
        patchType: "replace",
        replacement: "const password = process.env.ADMIN_PASS;",
        rationale: "Use environment variable instead of a hardcoded secret",
        target: {
          strategy: "line-range",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: document.lineAt(0).text.length,
          },
          snippet: document.lineAt(0).text,
        },
      },
    };

    const processed = await pipeline.processIssues(document, [issue]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].review?.status, "rejected");
    assert.strictEqual(processed[0].patchResult?.status, "resolved");
    assert.strictEqual(processed[0].syntaxCheck?.isValid, true);
    assert.strictEqual(processed[0].pipeline?.stage, "previewable");
    assert.strictEqual(processed[0].uiStatus, "FIX_READY");
  });

  test("line-range patch strategy resolves and becomes previewable", async () => {
    const document = await createWorkspaceDocument(
      "non-ast-strategy-blocked-test.js",
      'const password = "secret";\n',
    );

    const pipeline = new ScanPipelineService();
    const issue: CodeIssue = {
      id: "non-ast-strategy-issue",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: document.lineAt(0).text.length,
      severity: "warning",
      message: "AI Guard: Replace hardcoded secret with environment variable",
      originalCode: document.lineAt(0).text,
      source: "ai-generated",
      status: "open",
      fixCandidate: {
        source: "analysis-seed",
        patchType: "replace",
        replacement: "const password = process.env.ADMIN_PASS;",
        target: {
          strategy: "line-range",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: document.lineAt(0).text.length,
          },
          snippet: document.lineAt(0).text,
        },
      },
    };

    const processed = await pipeline.processIssues(document, [issue]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].patchResult?.status, "resolved");
    assert.strictEqual(processed[0].pipeline?.stage, "previewable");
    assert.strictEqual(processed[0].uiStatus, "FIX_READY");
  });

  test("snippet mismatch does not block line-range patch execution", async () => {
    const document = await createWorkspaceDocument(
      "line-range-snippet-mismatch-test.js",
      'const API_KEY = "12345SECRET"\n',
    );

    const pipeline = new ScanPipelineService();
    const issue: CodeIssue = {
      id: "line-range-snippet-mismatch-issue",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: document.lineAt(0).text.length,
      severity: "warning",
      message: "AI Guard: Replace hardcoded API key with environment variable",
      originalCode: document.lineAt(0).text,
      source: "ai-generated",
      status: "open",
      fixCandidate: {
        source: "analysis-seed",
        patchType: "replace",
        replacement: "const API_KEY = process.env.API_KEY;",
        target: {
          strategy: "line-range",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: document.lineAt(0).text.length,
          },
          snippet: 'const API_KEY = "12345SECRET";',
        },
      },
    };

    const processed = await pipeline.processIssues(document, [issue]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].patchResult?.status, "resolved");
    assert.strictEqual(processed[0].syntaxCheck?.isValid, true);
    assert.strictEqual(processed[0].pipeline?.stage, "previewable");
    assert.strictEqual(processed[0].uiStatus, "FIX_READY");
  });

  test("comment-style replacement is rejected before syntax preview", async () => {
    const document = await createWorkspaceDocument(
      "comment-replacement-blocked-test.js",
      'if (user === "admin" && password === defaultPassword) {\n',
    );

    const pipeline = new ScanPipelineService();
    const issue: CodeIssue = {
      id: "comment-replacement-blocked-issue",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: document.lineAt(0).text.length,
      severity: "warning",
      message: "AI Guard: Replace weak authentication check",
      originalCode: document.lineAt(0).text,
      source: "ai-generated",
      status: "open",
      fixCandidate: {
        source: "analysis-seed",
        patchType: "replace",
        replacement:
          'if (user === "admin" && password === defaultPassword) { // Consider using a more secure authentication method',
        target: {
          strategy: "line-range",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: document.lineAt(0).text.length,
          },
          snippet: document.lineAt(0).text,
        },
      },
    };

    const processed = await pipeline.processIssues(document, [issue]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].patchResult?.status, "rejected");
    assert.match(
      processed[0].patchResult?.reason || "",
      /must be executable code|must not include comments|must be executable code, not advice/i,
    );
    assert.strictEqual(processed[0].pipeline?.stage, "rejected");
    assert.strictEqual(processed[0].uiStatus, "BLOCKED");
  });

  test("partial expression replacement is rejected before syntax validation", async () => {
    const document = await createWorkspaceDocument(
      "partial-expression-replacement-blocked-test.js",
      'const API_KEY = "12345SECRET";\n',
    );

    const pipeline = new ScanPipelineService();
    const issue: CodeIssue = {
      id: "partial-expression-replacement-blocked-issue",
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: document.lineAt(0).text.length,
      severity: "warning",
      message: "AI Guard: Replace hardcoded API key",
      originalCode: document.lineAt(0).text,
      source: "ai-generated",
      status: "open",
      fixCandidate: {
        source: "analysis-seed",
        patchType: "replace",
        replacement: "process.env.API_KEY",
        target: {
          strategy: "line-range",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 0,
            endColumn: document.lineAt(0).text.length,
          },
          snippet: document.lineAt(0).text,
        },
      },
    };

    const processed = await pipeline.processIssues(document, [issue]);
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0].patchResult?.status, "rejected");
    assert.match(
      processed[0].patchResult?.reason || "",
      /complete valid statement|replace declarations and assignments with a complete statement/i,
    );
    assert.strictEqual(processed[0].pipeline?.stage, "rejected");
    assert.strictEqual(processed[0].uiStatus, "BLOCKED");
  });
});

function createStatusBar(
  initialState: GuardState = GuardState.Active,
): TestStatusBar {
  let state = initialState;
  return {
    getState(): GuardState {
      return state;
    },
    setState(nextState: GuardState): void {
      state = nextState;
    },
  };
}

function createPanelProvider(): TestPanelProvider {
  return {
    updateFromScanResult(): void {},
  };
}

async function setScanMode(
  mode: "realtime" | "onDemand" | "preCommit",
): Promise<void> {
  await vscode.workspace
    .getConfiguration("aiCodeGuard")
    .update("scanMode", mode, vscode.ConfigurationTarget.Workspace);
}

async function createWorkspaceDocument(
  fileName: string,
  content: string,
): Promise<vscode.TextDocument> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(
    workspaceFolder,
    "Expected an open workspace folder for extension tests",
  );

  const testDir = vscode.Uri.joinPath(
    workspaceFolder.uri,
    ".tmp-aiguard-tests",
  );
  await vscode.workspace.fs.createDirectory(testDir);

  const uniqueName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`;
  const fileUri = vscode.Uri.file(path.join(testDir.fsPath, uniqueName));
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));

  return vscode.workspace.openTextDocument(fileUri);
}

async function applyLargeAIGeneratedEdit(
  document: vscode.TextDocument,
  insertedText: string,
): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const endPosition = document.positionAt(document.getText().length);
  edit.insert(document.uri, endPosition, insertedText);
  const applied = await vscode.workspace.applyEdit(edit);
  assert.strictEqual(applied, true);
}

function getPendingScanCount(scanCommands: ScanCommands): number {
  return getPendingScanMap(scanCommands).size;
}

function getPendingScanMap(
  scanCommands: ScanCommands,
): Map<
  string,
  { uri: string; version: number; queuedAt: number; languageId: string }
> {
  return (
    scanCommands as unknown as {
      pendingAIScans: Map<
        string,
        { uri: string; version: number; queuedAt: number; languageId: string }
      >;
    }
  ).pendingAIScans;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
