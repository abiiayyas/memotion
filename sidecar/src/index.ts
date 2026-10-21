import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { stopAllAgents } from "./agents/run.js";
import { setSelfPort } from "./config.js";
import { stopAllPreviews } from "./engine/preview.js";
import { buildApp } from "./server.js";

const token = process.env.MEMOTION_TOKEN ?? randomBytes(24).toString("hex");
const extraOrigins = (process.env.MEMOTION_EXTRA_ORIGINS ?? "http://localhost:1420,http://127.0.0.1:1420")
  .split(",")
  .filter(Boolean);
const app = buildApp({ token, extraOrigins, logRequests: process.env.MEMOTION_DEV === "1" });

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: Number(process.env.MEMOTION_PORT ?? 0) }, (info) => {
  setSelfPort(info.port);
  // One JSON line on stdout is the handshake: the Tauri shell reads it to learn port and token.
  console.log(JSON.stringify({ ready: true, port: info.port, token }));
});

function shutdown(): void {
  stopAllAgents();
  stopAllPreviews();
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("exit", () => {
  stopAllAgents();
  stopAllPreviews();
});
// The shell keeps our stdin open for its whole life; EOF means it died, so do not leave orphans behind.
if (process.env.MEMOTION_EXIT_ON_STDIN_CLOSE === "1") {
  process.stdin.resume();
  process.stdin.on("end", shutdown);
}
