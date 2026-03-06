import * as vscode from "vscode";

export enum GuardState {
  Active = "active",
  Paused = "paused",
  Error = "error",
  Inactive = "inactive",
}

export class StatusBarController {
  private statusBarItem: vscode.StatusBarItem;
  private currentState: GuardState = GuardState.Inactive;

  constructor() {
    // Erstelle StatusBar Item (unten links)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );

    // Command beim Klick (kommt später)
    this.statusBarItem.command = "aiguard.showMenu";

    // Initiales Update und Anzeigen
    this.updateStatusBar();
    this.statusBarItem.show();
  }

  public setState(state: GuardState): void {
    this.currentState = state;
    this.updateStatusBar();
  }

  public getState(): GuardState {
    return this.currentState;
  }

  private updateStatusBar(): void {
    switch (this.currentState) {
      case GuardState.Active:
        // Grün/Aktiv
        this.statusBarItem.text = "$(shield-check) AI Guard";
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        this.statusBarItem.tooltip = "AI Guard is active - Click for options";
        break;

      case GuardState.Paused:
        // Gelb/Pausiert
        this.statusBarItem.text = "$(shield) AI Guard";
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.prominentBackground",
        );
        this.statusBarItem.tooltip = "AI Guard is paused - Click to resume";
        break;

      case GuardState.Error:
        // Rot/Fehler
        this.statusBarItem.text = "$(shield-x) AI Guard";
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground",
        );
        this.statusBarItem.tooltip = "AI Guard error - Click for details";
        break;

      default:
        // Inaktiv
        this.statusBarItem.text = "$(shield) AI Guard";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = "AI Guard inactive - Click to start";
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
