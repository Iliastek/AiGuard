import * as vscode from "vscode";

export enum GuardState {
  Active = "active",
  Paused = "paused",
  Error = "error",
  Inactive = "inactive",
}

export class StatusBarController {
  private statusBarItem: vscode.StatusBarItem;
  private currentState: GuardState = GuardState.Paused;

  constructor() {
    // Erstelle StatusBar Item (unten links)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000,
    );
    this.statusBarItem.name = "AI Guard";

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
        this.statusBarItem.text = "$(shield) AI Guard";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = "#16a34a";
        this.statusBarItem.tooltip = "AI Guard is active - Click for options";
        break;

      case GuardState.Paused:
        // Gelb/Pausiert
        this.statusBarItem.text = "$(shield) AI Guard";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = "#d97706";
        this.statusBarItem.tooltip = "AI Guard is paused - Click to resume";
        break;

      case GuardState.Error:
        // Rot/Fehler
        this.statusBarItem.text = "$(shield) AI Guard";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = "#dc2626";
        this.statusBarItem.tooltip = "AI Guard error - Click for details";
        break;

      default:
        // Inaktiv
        this.statusBarItem.text = "$(shield) AI Guard";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = undefined;
        this.statusBarItem.tooltip = "AI Guard inactive - Click to start";
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
