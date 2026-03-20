import type { FastifyInstance } from "fastify";
import type { FixRequest, FixResponse } from "@aiguard/shared";

export async function fixRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Body: FixRequest; Reply: FixResponse }>(
    "/fix/generate",
    async (request, reply) => {
      // TODO: validate license key from Authorization header
      // TODO: generate fix candidate via GPT-5.4
      // TODO: run critic review
      reply.send({ issue: request.body.issue });
    },
  );
}
