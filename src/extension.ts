// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {
  StatusBarController,
  GuardState,
} from "./statusBar/StatusBarController";
import { MenuCommands } from "./commands/MenuCommands";
import { ScanCommands } from "./commands/ScanCommands";

let statusBarController: StatusBarController;
let menuCommands: MenuCommands;
let scanCommands: ScanCommands;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("AI Code Guard is now active! 🛡️");

  // Initialize StatusBar
  statusBarController = new StatusBarController();
  context.subscriptions.push(statusBarController);

  // Initialize Command Handlers
  menuCommands = new MenuCommands(statusBarController);
  scanCommands = new ScanCommands(statusBarController);

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("aiguard.showMenu", () => {
      menuCommands.showMenu();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiguard.startGuard", () => {
      statusBarController.setState(GuardState.Active);
      scanCommands.startRealtimeMonitoring();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aiguard.pauseGuard", () => {
      statusBarController.setState(GuardState.Paused);
      scanCommands.stopRealtimeMonitoring();
    }),
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("AI Code Guard deactivated");
}
