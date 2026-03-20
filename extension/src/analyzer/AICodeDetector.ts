import * as vscode from "vscode";

export class AICodeDetector {
  private lastChangeTimestamp = 0;
  private readonly changeThreshold = 120; // ms zwischen Änderungen

  /**
   * Erkennt ob Code wahrscheinlich von AI generiert wurde
   * basierend auf:
   * - Große Textmengen auf einmal
   * - Mehrere Zeilen gleichzeitig
   * - Schnelle Änderungen
   */
  public isHighConfidenceAIGenerated(
    change: vscode.TextDocumentContentChangeEvent,
  ): boolean {
    // Ignore deletions and tiny edits to avoid manual typing false positives.
    if (!change.text || change.text.trim().length === 0) {
      return false;
    }

    const now = Date.now();
    const timeSinceLastChange = now - this.lastChangeTimestamp;
    this.lastChangeTimestamp = now;

    const textLength = change.text.length;
    const insertedLines = change.text.split("\n").length;
    const hasCopilotPattern = this.detectCopilotPatterns(change.text);

    // High confidence: large multiline insertion.
    if (textLength >= 120 && insertedLines >= 3) {
      return true;
    }

    // High confidence: pattern + enough size for generated block.
    if (hasCopilotPattern && textLength >= 80 && insertedLines >= 2) {
      return true;
    }

    // High confidence: very fast + large block.
    if (
      timeSinceLastChange < this.changeThreshold &&
      textLength >= 100 &&
      insertedLines >= 2
    ) {
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
   * Erkennt typische Muster in AI-Completion-Blöcken.
   */
  public detectCopilotPatterns(text: string): boolean {
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
