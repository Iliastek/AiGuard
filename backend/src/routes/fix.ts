import type { FastifyInstance } from "fastify";
import type { FixCandidate, FixRequest, FixResponse } from "@aiguard/shared";
import { OpenAIService } from "../services/OpenAIService";

const openai = new OpenAIService();

export async function fixRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Body: FixRequest; Reply: FixResponse }>(
    "/fix/generate",
    async (request, reply) => {
      const { issue, codeContext, language } = request.body;

      const replacement = await openai.generateFix(language, issue, codeContext);
      if (!replacement) {
        await reply.send({ issue });
        return;
      }

      const fixCandidate: FixCandidate = {
        source: "generator",
        patchType: "replace",
        replacement,
        rationale: issue.message,
        target: {
          strategy: "line-range",
          range: {
            startLine: issue.line,
            startColumn: 0,
            endLine: issue.endLine,
            endColumn: 0,
          },
          snippet: issue.originalCode,
        },
      };

      await reply.send({ issue: { ...issue, fixCandidate } });
    },
  );
}
