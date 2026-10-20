// Tauri's externalBin needs `binaries/node-<target-triple>`. Copy the Node that runs this script
// (Node 22+, the version the sidecar is tested with) there for release builds.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "src-tauri", "binaries");
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
if (!host) throw new Error("could not read the host target triple from `rustc -vV`");
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error(`Node 22+ required, got ${process.version}`);

mkdirSync(dest, { recursive: true });
const target = join(dest, `node-${host}${process.platform === "win32" ? ".exe" : ""}`);
copyFileSync(process.execPath, target);
console.log(`bundled node ${process.version} -> ${target}`);
