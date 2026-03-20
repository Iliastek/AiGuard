import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { authMiddleware } from "./plugins/auth";
import { analyzeRoutes } from "./routes/analyze";
import { fixRoutes } from "./routes/fix";

const server = Fastify({ logger: true });

async function start(): Promise<void> {
  await server.register(cors, { origin: false });
  await server.register(authMiddleware);
  await server.register(analyzeRoutes, { prefix: "/v1" });
  await server.register(fixRoutes, { prefix: "/v1" });

  const port = Number(process.env.PORT ?? 3000);
  await server.listen({ port, host: "0.0.0.0" });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
