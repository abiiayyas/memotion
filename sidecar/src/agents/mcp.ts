import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { getPreferences } from "../preferences.js";
import { runTool, TOOL_SPECS } from "../agent/tools.js";
import { projectPath } from "../projects/store.js";
import { existsSync } from "node:fs";

/**
 * Tools a CLI agent gets from Memotion. Its own tools already read and write files, so the file tools are not
 * offered; what is left is what only Memotion can do (check, snapshots, docs, voice, capture, images).
 */
const MCP_TOOLS: Record<string, true> = {
  list_media: true,
  check: true,
  snapshot: true,
  review: true,
  read_docs: true,
  read_skill: true,
  generate_voiceover: true,
  transcribe_and_caption: true,
  capture_website: true,
  generate_image: true,
};

interface RunScope {
  projectId: string;
  signal: AbortSignal;
  imageBudget: { left: number };
  reviewBudget: { left: number };
}

const scopes: Record<string, RunScope | undefined> = {};

export interface OpenScope {
  token: string;
  /** Path (no host) the CLI is pointed at. */
  path: string;
  close: () => void;
}

/** A capability for one agent run: the token in the URL is the only credential, and it dies with the run. */
export function openRunScope(projectId: string, signal: AbortSignal): OpenScope {
  const token = randomBytes(24).toString("hex");
  scopes[token] = { projectId, signal, imageBudget: { left: getPreferences().maxImages }, reviewBudget: { left: getPreferences().maxReviews } };
  return {
    token,
    path: `/mcp/${token}`,
    close: () => {
      scopes[token] = undefined;
    },
  };
}

const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

const InitParams = z.looseObject({ protocolVersion: z.string().optional() });
const CallParams = z.looseObject({ name: z.string(), arguments: z.unknown().optional() });

const SUPPORTED = "2025-06-18";

function listTools() {
  return TOOL_SPECS.flatMap((spec) =>
    spec.type === "function" && MCP_TOOLS[spec.function.name] ? [{ name: spec.function.name, description: spec.function.description ?? "", inputSchema: spec.function.parameters ?? { type: "object" } }] : [],
  );
}

export function registerMcpRoutes(app: Hono): void {
  // Streamable HTTP, stateless: one JSON response per POST. No server-initiated stream.
  app.get("/mcp/:token", (c) => c.body(null, 405));
  app.delete("/mcp/:token", (c) => c.body(null, 200));
  app.post("/mcp/:token", async (c) => {
    const scope = scopes[c.req.param("token")];
    if (!scope) return c.json({ error: "unknown or finished run" }, 404);
    const req = RpcRequest.safeParse(await c.req.json().catch(() => null));
    if (!req.success) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, 400);
    const { id, method, params } = req.data;
    const reply = (result: unknown) => c.json({ jsonrpc: "2.0", id: id ?? null, result });
    const fail = (code: number, message: string) => c.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

    if (id === undefined) return c.body(null, 202); // notifications (initialized, cancelled, ...)
    if (method === "initialize") {
      const asked = InitParams.safeParse(params);
      return reply({
        protocolVersion: asked.success && asked.data.protocolVersion ? asked.data.protocolVersion : SUPPORTED,
        capabilities: { tools: {} },
        serverInfo: { name: "memotion", version: "0.1.0" },
      });
    }
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: listTools() });
    if (method === "tools/call") {
      const call = CallParams.safeParse(params);
      if (!call.success || !MCP_TOOLS[call.data.name]) return fail(-32602, "Unknown tool");
      if (!existsSync(projectPath(scope.projectId))) return fail(-32000, "The project no longer exists");
      const out = await runTool(scope.projectId, call.data.name, call.data.arguments ?? {}, { signal: scope.signal, vision: true, imageBudget: scope.imageBudget, reviewBudget: scope.reviewBudget });
      const images = (out.images ?? []).map((png) => ({ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }));
      return reply({ content: [{ type: "text", text: out.content }, ...images], isError: !out.ok });
    }
    return fail(-32601, `Method not found: ${method}`);
  });
}
