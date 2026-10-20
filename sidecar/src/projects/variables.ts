import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { listFiles, projectPath, safeJoin, touch } from "./store.js";

/**
 * Composition variables live in a `data-composition-variables='[…]'` attribute on the `<html>` (or a scene's
 * root) element: `[{id, type, label, default, …}]`. The Variables panel edits only `default`; the runtime binds
 * `data-var-text`, `data-var-src` and `var(--id)` to those values when the page loads.
 */
const Base = { id: z.string().min(1), label: z.string().optional() };

export const Variable = z.discriminatedUnion("type", [
  z.looseObject({ ...Base, type: z.literal("string"), default: z.string(), maxLength: z.number().optional(), placeholder: z.string().optional() }),
  z.looseObject({
    ...Base,
    type: z.literal("number"),
    default: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
  }),
  z.looseObject({ ...Base, type: z.literal("color"), default: z.string() }),
  z.looseObject({ ...Base, type: z.literal("boolean"), default: z.boolean() }),
  z.looseObject({
    ...Base,
    type: z.literal("enum"),
    default: z.string(),
    options: z.array(z.object({ value: z.string(), label: z.string().optional() })),
  }),
]);
export type Variable = z.infer<typeof Variable>;

export interface FileVariables {
  file: string;
  variables: Variable[];
}

const ATTR = /\bdata-composition-variables=(?:'([^']*)'|"([^"]*)")/;

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Single-quoted attribute holding JSON: only `'`, `&`, `<` need escaping there. */
function encode(json: string): string {
  return json.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

/** Parse the variables attribute of one HTML file, or null when it has none or it is not valid. */
export function parseVariables(html: string): Variable[] | null {
  const m = ATTR.exec(html);
  if (!m) return null;
  try {
    return z.array(Variable).parse(JSON.parse(decode(m[1] ?? m[2] ?? "")));
  } catch {
    return null;
  }
}

/** Return `html` with the default of variable `id` replaced; everything else in the file stays byte-identical. */
export function withVariableDefault(html: string, id: string, value: unknown): string {
  const m = ATTR.exec(html);
  if (!m) throw new Error("This file declares no variables.");
  const list: unknown = JSON.parse(decode(m[1] ?? m[2] ?? ""));
  const vars = z.array(Variable).parse(list);
  const target = vars.find((v) => v.id === id);
  if (!target) throw new Error(`Unknown variable: ${id}`);

  let checked: Variable["default"];
  switch (target.type) {
    case "string": {
      const s = z.string().max(target.maxLength ?? 10_000).parse(value);
      checked = s;
      break;
    }
    case "number": {
      const n = z.number().min(target.min ?? -Infinity).max(target.max ?? Infinity).parse(value);
      checked = n;
      break;
    }
    case "color":
      checked = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Use a hex colour like #ff7a3d").parse(value);
      break;
    case "boolean":
      checked = z.boolean().parse(value);
      break;
    case "enum": {
      const allowed = target.options.map((o) => o.value);
      checked = z.string().refine((s) => allowed.includes(s), `Choose one of: ${allowed.join(", ")}`).parse(value);
      break;
    }
  }

  // Edit the parsed-but-unvalidated list so unknown keys the runtime understands survive the round trip.
  const raw = z.array(z.looseObject({ id: z.string() })).parse(list);
  const next = raw.map((v) => (v.id === id ? { ...v, default: checked } : v));
  const q = m[1] !== undefined ? "'" : '"';
  const body = q === "'" ? encode(JSON.stringify(next)) : JSON.stringify(next).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return html.slice(0, m.index) + `data-composition-variables=${q}${body}${q}` + html.slice(m.index + m[0].length);
}

export async function readVariables(projectId: string): Promise<FileVariables[]> {
  const out: FileVariables[] = [];
  for (const file of await listFiles(projectId)) {
    if (file !== "index.html" && !(file.startsWith("compositions/") && file.endsWith(".html"))) continue;
    const variables = parseVariables(await readFile(join(projectPath(projectId), file), "utf8"));
    if (variables && variables.length > 0) out.push({ file, variables });
  }
  return out;
}

export async function setVariable(projectId: string, file: string, id: string, value: unknown): Promise<void> {
  if (file !== "index.html" && !(file.startsWith("compositions/") && file.endsWith(".html"))) {
    throw new Error("Variables can only be edited in index.html or compositions/*.html.");
  }
  const abs = safeJoin(projectPath(projectId), file);
  const next = withVariableDefault(await readFile(abs, "utf8"), id, value);
  const tmp = `${abs}.part`;
  await writeFile(tmp, next);
  await rename(tmp, abs);
  await touch(projectId);
}
