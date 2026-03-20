import type { FastifyInstance } from "fastify";
import type { AnalyzeRequest, AnalyzeResponse, CodeIssue } from "@aiguard/shared";
import { OpenAIService } from "../services/OpenAIService";

const openai = new OpenAIService();

// Convert a 1-based GPT line number to a 0-based VS Code line number.
// GPT returns 0 when the line is unknown; we map that to -1.
function to0(oneBased: number): number {
  return oneBased > 0 ? oneBased - 1 : -1;
}

// Same conversion for patch range values where 0 maps to 0 (not unknown).
function rangeLineToVsc(oneBased: number | undefined, fallback: number): number {
  const val = oneBased ?? fallback;
  return val > 0 ? val - 1 : 0;
}

export async function analyzeRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Body: AnalyzeRequest; Reply: AnalyzeResponse }>(
    "/analyze",
    async (request, reply) => {
      const { code, language, filePath } = request.body;
      const start = Date.now();
      const codeLines = code.split("\n");

      const normalized = await openai.analyze(language, code);

      const issues: CodeIssue[] = normalized.map((n) => {
        const line = to0(n.line);
        const patchStartLine = rangeLineToVsc(n.patch?.startLine, n.line);
        const patchEndLine = rangeLineToVsc(n.patch?.endLine, n.line);
        // endColumn must point to the end of the last replaced line so that
        // SyntaxValidator.applyFix correctly slices out the original text.
        // endColumn: 0 would leave the original line intact and prepend the
        // replacement, producing doubled code and a guaranteed syntax error.
        const patchEndColumn = (codeLines[patchEndLine] ?? "").length;

        return {
          id: crypto.randomUUID(),
          line,
          column: 0,
          endLine: n.patch ? patchEndLine : line,
          endColumn: 0,
          severity: n.severity,
          message: `[${n.type}] ${n.message}`,
          originalCode: n.codeSnippet ?? "",
          source: "ai-generated",
          status: "open",
          fixability: "auto",
          ...(n.patch && {
            fix: {
              type: n.patch.patchType,
              range: {
                startLine: patchStartLine,
                startColumn: 0,
                endLine: patchEndLine,
                endColumn: patchEndColumn,
              },
              replacement: n.patch.replacementCode,
            },
          }),
        };
      });

      void filePath; // received, available for future Context7 enrichment

      await reply.send({ issues, scanDurationMs: Date.now() - start });
    },
  );
}
