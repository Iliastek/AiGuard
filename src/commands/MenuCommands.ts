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

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "AI Code Guard - Copilot Monitor",
    });

    if (!selection) {
      return;
    }

    if (selection.label.includes("Start Guard")) {
      vscode.commands.executeCommand("aiguard.startGuard");
    } else if (selection.label.includes("Pause Guard")) {
      vscode.commands.executeCommand("aiguard.pauseGuard");
    }
  }
}
