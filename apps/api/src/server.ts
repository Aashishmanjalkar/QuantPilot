import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { loadConfig } from "./config";
import {
  createQueue,
  createRunEvents,
  createWorker,
  reconcileFailedJob,
  redisConnection,
} from "./queue";
import { createQuantClient } from "./quantClient";
import { createPrismaStore } from "./store";
import { attachRunSocket } from "./ws";

const config = loadConfig();
const prisma = new PrismaClient();
const store = createPrismaStore(prisma);
const quant = createQuantClient(config.QUANT_URL, config.QUANT_TIMEOUT_MS);

const queueConn = redisConnection(config.REDIS_URL);
const eventsConn = redisConnection(config.REDIS_URL);
const queue = createQueue(queueConn);
const events = createRunEvents(eventsConn, { onFailed: reconcileFailedJob(queue, store) });
const workerConn = config.RUN_WORKER ? redisConnection(config.REDIS_URL) : null;
const worker = workerConn ? createWorker(workerConn, { store, quant }) : null;
worker?.on("failed", (job, err) => {
  console.error(`backtest job ${job?.id ?? "?"} attempt failed: ${err.message}`);
});

const server = createServer(createApp({ store, quant, queue, corsOrigin: config.CORS_ORIGIN }));
const wss = attachRunSocket(server, { store, events });

server.on("error", (err) => {
  console.error(`http server error: ${err.name}: ${err.message}`);
  process.exit(1);
});
server.listen(config.PORT, () => {
  console.log(`api listening on :${config.PORT} (worker ${worker ? "on" : "off"})`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  wss.close();
  server.close();
  await worker?.close();
  await Promise.allSettled([queue.close(), events.close()]);
  for (const c of [queueConn, eventsConn, workerConn]) c?.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
