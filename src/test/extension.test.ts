import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { ScanCommands } from "../commands/ScanCommands";
import { GuardState } from "../statusBar/StatusBarController";
import { ScanResult } from "../types";

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
