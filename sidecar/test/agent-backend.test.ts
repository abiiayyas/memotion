import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getAgentBackend } from "../src/providers/store.js";
import { buildApp } from "../src/server.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-backend-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("a coding agent that is no longer supported", () => {
  it("falls back to the AI provider when the saved config still names it", () => {
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ providers: [], activeProviderId: null, agentBackend: "agy" }));
    expect(getAgentBackend()).toBe("api");
  });

  it("cannot be chosen any more", async () => {
    const app = buildApp({ token: "t" });
    const res = await app.request("/agents/backend", {
      method: "PUT",
      headers: { Host: "127.0.0.1:1", Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ backend: "agy" }),
    });
    expect(res.status).toBe(400);
    expect(getAgentBackend()).toBe("api");
  });
});
