// Builds the release sidecar into sidecar/bundle/: one bundled entry plus an npm-installed
// node_modules for the packages that cannot be bundled (the hyperframes CLI is spawned by path,
// and the keychain addon is native). `npm` (not pnpm) installs them so the folder has no symlinks
// into a store and can be copied into the app bundle as-is.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const bundle = join(root, "bundle");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const external = ["hyperframes", "@napi-rs/keyring"];

rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, "dist"), { recursive: true });

await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(bundle, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  // Bundled CJS deps (openai's transitive ones) call require(); give ESM output a working one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

writeFileSync(
  join(bundle, "package.json"),
  JSON.stringify(
    {
      name: "memotion-sidecar",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(external.map((name) => [name, pkg.dependencies[name]])),
    },
    null,
    2,
  ),
);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npmCmd, ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], {
  cwd: bundle,
  stdio: "inherit",
  shell: process.platform === "win32",
});
console.log("sidecar bundle ready:", bundle);
