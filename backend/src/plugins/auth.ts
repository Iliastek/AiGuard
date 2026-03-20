import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { LicenseService } from "../services/LicenseService";

const licenseService = new LicenseService();

async function authPlugin(server: FastifyInstance): Promise<void> {
  server.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization ?? "";
      const key = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      if (!licenseService.validate(key)) {
        await reply.status(401).send({ error: "Invalid or missing license key" });
      }
    },
  );
}

export const authMiddleware = fp(authPlugin);
