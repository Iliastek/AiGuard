export class PromptBuilder {
  static readonly SYSTEM_PROMPT =
    "You are a secure code refactoring engine. Return only compact JSON containing real executable code patches.";

  buildAnalyzePrompt(language: string, code: string): string {
    const numberedCode = this.withLineNumbers(code);

    return [
      "Analyze this code for bugs, security risks, maintainability issues, and suspicious AI-generated mistakes.",
      "When an issue is fixable, you MUST provide a real code replacement that changes behavior or configuration safely.",
      "The replacement must be a complete valid statement for the given language.",
      "Never return partial expressions such as identifiers, literals, or member access fragments.",
      "The replacement must compile on its own when replacing the original line or range.",
      "Do not use column ranges.",
      "All patches must replace complete lines using only startLine and endLine.",
      "Columns must not be used.",
      "Return JSON only in this format:",
      '{"issues":[{"line":number,"severity":"info|warning|error","message":"string","codeSnippet":"string optional","patchId":"string optional","confidence":0.0,"target":{"strategy":"line-range optional","range":{"startLine":number,"endLine":number},"snippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"},"patch":{"id":"string optional","startLine":number,"endLine":number,"patchType":"insert|replace|delete","replacementCode":"string","targetSnippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"}}],"patches":[{"id":"string","startLine":number,"endLine":number,"patchType":"insert|replace|delete","replacementCode":"string","targetSnippet":"string optional","contextBefore":"string optional","contextAfter":"string optional"}]}',
      "If you can propose a concrete safe fix, include a structured patch.",
      "replacementCode must contain valid executable code only — no explanation, prose, markdown, or comments.",
      "Do not provide advice. Do not provide TODO, FIXME, NOTE, or Consider-using comments.",
      "Never insert //, /* */, or narrative text in replacementCode.",
      "For single-line replacements, prefer complete statements.",
      "replacementCode must contain exactly the lines that replace the specified range.",
      "Do not include extra indentation changes or unrelated lines.",
      "Prefer top-level patches[] with patchId references from issues[]. If not possible, include patch inline under issue.patch.",
      "Patch ranges must be 1-based and refer to exact lines in the numbered code.",
      "Use the line numbers from the code block below (prefixed as L<line>:).",
      "line must be 1-based.",
      "If uncertain, set line to 0 and provide codeSnippet.",
      "target.strategy should be line-range whenever a patch is provided.",
      `Language: ${language}`,
      "Code:",
      numberedCode,
    ].join("\n");
  }

  private withLineNumbers(code: string): string {
    return code
      .split("\n")
      .map((line, i) => `L${i + 1}: ${line}`)
      .join("\n");
  }
}
