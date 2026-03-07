import * as vscode from "vscode";
import {
  StatusBarController,
  GuardState,
} from "../statusBar/StatusBarController";

export class MenuCommands {
  constructor(private statusBar: StatusBarController) {}

  public async showMenu(): Promise<void> {
    const currentState = this.statusBar.getState();

    const items: vscode.QuickPickItem[] = [];

    if (currentState === GuardState.Active) {
      items.push({
        label: "$(debug-pause) Pause Guard",
        description: "Stop monitoring AI-generated code",
      });
    } else {
      items.push({
        label: "$(play) Start Guard",
        description: "Monitor AI-generated code (Copilot, etc.)",
      });
    }

    items.push(
      {
        label: "$(search) Scan File Now",
        description: "Analyze the currently open file",
      },
      {
        label: "$(report) View Report",
        description: "Show latest scan summary",
      },
      {
        label: "$(settings-gear) Settings",
        description: "Open AI Guard settings",
      },
    );

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "AI Code Guard - Copilot Monitor",
    });

    if (!selection) {
      return;
    }

    if (selection.label.includes("Start Guard")) {
      await vscode.commands.executeCommand("aiguard.startGuard");
    } else if (selection.label.includes("Pause Guard")) {
      await vscode.commands.executeCommand("aiguard.pauseGuard");
    } else if (selection.label.includes("Scan File Now")) {
      await vscode.commands.executeCommand("aiguard.scanFile");
    } else if (selection.label.includes("View Report")) {
      await vscode.commands.executeCommand("aiguard.viewReport");
    } else if (selection.label.includes("Settings")) {
      await vscode.commands.executeCommand("aiguard.openSettings");
    }
  }
}
