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

      const normalized = await openai.analyze(language, code);

      const issues: CodeIssue[] = normalized.map((n) => {
        const line = to0(n.line);
        const patchStartLine = rangeLineToVsc(n.patch?.startLine, n.line);
        const patchEndLine = rangeLineToVsc(n.patch?.endLine, n.line);
        const targetStartLine = rangeLineToVsc(n.target?.range?.startLine, n.line);
        const targetEndLine = rangeLineToVsc(n.target?.range?.endLine, n.line);

        return {
          id: crypto.randomUUID(),
          line,
          column: 0,
          endLine: n.patch ? patchEndLine : line,
          endColumn: 0,
          severity: n.severity,
          message: n.message,
          originalCode: n.codeSnippet ?? "",
          source: "ai-generated",
          status: "open",
          fixability: n.patch ? "auto" : "manual",
          ...(n.patch && {
            fix: {
              type: n.patch.patchType ?? "replace",
              range: {
                startLine: patchStartLine,
                startColumn: 0,
                endLine: patchEndLine,
                endColumn: 0,
              },
              replacement: n.patch.replacementCode ?? "",
            },
          }),
          ...(n.target && {
            fixCandidate: {
              source: "generator",
              patchType: n.patch?.patchType ?? "replace",
              replacement: n.patch?.replacementCode ?? "",
              confidence: n.confidence,
              target: {
                strategy: (n.target.strategy as "line-range") ?? "line-range",
                range: n.target.range
                  ? {
                      startLine: targetStartLine,
                      startColumn: 0,
                      endLine: targetEndLine,
                      endColumn: 0,
                    }
                  : undefined,
                snippet: n.target.snippet,
                contextBefore: n.target.contextBefore,
                contextAfter: n.target.contextAfter,
              },
            },
          }),
        };
      });

      void filePath; // received, available for future Context7 enrichment

      await reply.send({ issues, scanDurationMs: Date.now() - start });
    },
  );
}
