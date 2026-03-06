import * as vscode from "vscode";

export class AICodeDetector {
  private lastChangeTimestamp: number = 0;
  private changeThreshold: number = 100; // ms zwischen Änderungen

  /**
   * Erkennt ob Code wahrscheinlich von AI generiert wurde
   * basierend auf:
   * - Große Textmengen auf einmal
   * - Mehrere Zeilen gleichzeitig
   * - Schnelle Änderungen
   */
  public isLikelyAIGenerated(
    change: vscode.TextDocumentContentChangeEvent,
  ): boolean {
    const now = Date.now();
    const timeSinceLastChange = now - this.lastChangeTimestamp;
    this.lastChangeTimestamp = now;

    // Mehr als 50 Zeichen auf einmal = wahrscheinlich AI
    if (change.text.length > 50) {
      return true;
    }

    // Mehrere Zeilen auf einmal = wahrscheinlich AI
    if (change.text.includes("\n") && change.text.split("\n").length > 2) {
      return true;
    }

    // Sehr schnelle aufeinanderfolgende Änderungen = wahrscheinlich AI
    if (timeSinceLastChange < this.changeThreshold && change.text.length > 20) {
      return true;
    }

    return false;
  }

  /**
   * Extrahiert den eingefügten Code-Block
   */
  public extractInsertedCode(
    change: vscode.TextDocumentContentChangeEvent,
  ): string {
    return change.text;
  }

  /**
   * Erkennt Copilot-spezifische Muster
   */
  public detectCopilotPatterns(text: string): boolean {
    // Copilot fügt oft vollständige Funktionen/Kommentare ein
    const patterns = [
      /^function\s+\w+\(/m, // Funktionsdefinitionen
      /^const\s+\w+\s*=\s*\(/m, // Arrow Functions
      /^\/\*\*[\s\S]*?\*\//m, // JSDoc Kommentare
      /^import\s+.*from/m, // Import Statements
      /^export\s+(default|const)/m, // Export Statements
    ];

    return patterns.some((pattern) => pattern.test(text));
  }
}
