import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTool } from "../src/agent/tools.js";
import { createProject, updateMeta } from "../src/projects/store.js";
import { getSkill, installSkill, installSkillFromFolder, listSkills, parseGithubUrl, parseSkillMd, readSkillFile, removeSkill, SKILL_CHUNK } from "../src/skills/store.js";

const dataDir = mkdtempSync(join(tmpdir(), "memotion-skills-"));
process.env.MEMOTION_DATA_DIR = dataDir;
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

interface FakeRepo {
  branch: string;
  /** Refs that exist; the default branch is always one. */
  refs?: string[];
  files: Record<string, string>;
  /** Sizes the tree reports when they differ from the text. */
  sizes?: Record<string, number>;
}

/** A GitHub that serves the repository API, the tree API and raw files from memory. */
function fakeGithub(repos: Record<string, FakeRepo>): typeof fetch {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.github.com") {
      const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/git\/trees\/(.+))?$/.exec(url.pathname);
      const repo = m && repos[`${m[1]}/${m[2]}`];
      if (!repo) return json({ message: "Not Found" }, 404);
      if (m[3] === undefined) return json({ default_branch: repo.branch });
      const ref = decodeURIComponent(m[3]);
      if (ref !== repo.branch && !repo.refs?.includes(ref)) return json({ message: "Not Found" }, 404);
      return json({ tree: Object.keys(repo.files).map((path) => ({ path, type: "blob", size: repo.sizes?.[path] ?? Buffer.byteLength(repo.files[path] ?? "") })) });
    }
    const m = /^\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    const repo = m && repos[`${m[1]}/${m[2]}`];
    if (url.hostname !== "raw.githubusercontent.com" || !repo) return new Response("nope", { status: 404 });
    const rest = decodeURIComponent(m[3] ?? "");
    const ref = [repo.branch, ...(repo.refs ?? [])].find((r) => rest.startsWith(`${r}/`));
    const text = ref ? repo.files[rest.slice(ref.length + 1)] : undefined;
    return text === undefined ? new Response("missing", { status: 404 }) : new Response(text);
  }) as typeof fetch;
}

const SKILL_MD = `---
name: Bang Motion
description: >
  Motion graphics that move like video,
  not like slides.
metadata:
  name: not-this-one
---

# Rules
Follow them.`;

const MOTION: FakeRepo = {
  branch: "main",
  files: {
    "SKILL.md": SKILL_MD,
    "README.md": "readme",
    "references/anti-ppt.md": "no slides",
    "references/huge.md": "x",
    "scripts/run.py": "print(1)",
    "assets/logo.png": "png",
    "assets/starter.html": "<html>",
  },
  sizes: { "references/huge.md": 900_000 },
};

describe("reading a SKILL.md", () => {
  it("takes name and description from plain, quoted and folded values and ignores nested keys", () => {
    expect(parseSkillMd(SKILL_MD)).toMatchObject({ name: "Bang Motion", description: "Motion graphics that move like video, not like slides." });
    expect(parseSkillMd('---\nname: "Quoted: name"\ndescription: \'One line\'\n---\nbody')).toMatchObject({ name: "Quoted: name", description: "One line" });
    expect(parseSkillMd("# Just markdown")).toMatchObject({ name: "", description: "", body: "# Just markdown" });
    expect(parseSkillMd("---\nname: x\n---\n")).toBeNull();
  });
});

describe("GitHub links", () => {
  it("accepts repository, folder and SKILL.md links", () => {
    expect(parseGithubUrl("https://github.com/acme/motion")).toEqual({ owner: "acme", repo: "motion", rest: [] });
    expect(parseGithubUrl("github.com/acme/motion.git/")).toEqual({ owner: "acme", repo: "motion", rest: [] });
    expect(parseGithubUrl("https://github.com/acme/motion/tree/main/skills/one")).toMatchObject({ rest: ["main", "skills", "one"] });
    expect(parseGithubUrl("https://github.com/acme/motion/blob/main/skills/one/SKILL.md")).toMatchObject({ rest: ["main", "skills", "one"] });
  });

  it("refuses other hosts, plain http and malformed paths", () => {
    for (const bad of ["http://github.com/acme/motion", "https://evil.example/acme/motion", "https://github.com.evil.example/a/b", "https://github.com/acme", "https://github.com/acme/motion/issues/3", "https://github.com/a b/c", "not a link"]) {
      expect(() => parseGithubUrl(bad), bad).toThrow();
    }
  });
});

describe("installing a skill", () => {
  it("keeps only the text documents that fit, SKILL.md first, and opens only those", async () => {
    const skill = await installSkill("https://github.com/acme/motion", fakeGithub({ "acme/motion": MOTION }));
    expect(skill).toMatchObject({ id: "bang-motion", name: "Bang Motion", description: "Motion graphics that move like video, not like slides." });
    expect(skill.files).toEqual(["SKILL.md", "README.md", "references/anti-ppt.md"]);
    expect(await readSkillFile(skill, "references/anti-ppt.md")).toBe("no slides");
    for (const bad of ["scripts/run.py", "references/huge.md", "../../preferences.json", "/etc/passwd", "references/../SKILL.md"]) {
      expect(await readSkillFile(skill, bad), bad).toBeNull();
    }
    expect(existsSync(join(dataDir, "skills", "bang-motion", "scripts"))).toBe(false);
  });

  it("replaces the same skill when installed again and gives a different skill with the same name its own id", async () => {
    const gh = fakeGithub({ "acme/motion": MOTION, "other/fork": { branch: "dev", files: { "SKILL.md": SKILL_MD } } });
    await installSkill("https://github.com/acme/motion", gh);
    expect((await listSkills()).filter((s) => s.name === "Bang Motion")).toHaveLength(1);
    const fork = await installSkill("https://github.com/other/fork", gh);
    expect(fork.id).toBe("bang-motion-2");
    expect((await listSkills()).map((s) => s.id)).toEqual(expect.arrayContaining(["bang-motion", "bang-motion-2"]));
  });

  it("needs a folder link when a repository holds several skills, and installs the one asked for, even on a branch with a slash", async () => {
    const multi: FakeRepo = {
      branch: "main",
      refs: ["feature/x"],
      files: {
        ".agents/skills/one/SKILL.md": "---\nname: One\ndescription: first\n---\nbody one",
        ".agents/skills/one/reference/a.md": "a",
        ".agents/skills/two/SKILL.md": "---\nname: Two\ndescription: second\n---\nbody two",
      },
    };
    const gh = fakeGithub({ "acme/multi": multi });
    await expect(installSkill("https://github.com/acme/multi", gh)).rejects.toThrow(/holds 2 skills[\s\S]*skills\/one[\s\S]*skills\/two/);
    const one = await installSkill("https://github.com/acme/multi/tree/feature/x/.agents/skills/one", gh);
    expect(one).toMatchObject({ name: "One", files: ["SKILL.md", "reference/a.md"] });
    await expect(installSkill("https://github.com/acme/multi/tree/nope/.agents/skills/one", gh)).rejects.toThrow(/not found/);
  });

  it("explains a repository that is missing or has no skill", async () => {
    const gh = fakeGithub({ "acme/plain": { branch: "main", files: { "README.md": "hi" } } });
    await expect(installSkill("https://github.com/acme/ghost", gh)).rejects.toThrow(/not found/);
    await expect(installSkill("https://github.com/acme/plain", gh)).rejects.toThrow(/No SKILL\.md/);
  });

  it("removes a skill for good", async () => {
    const skill = await installSkill("https://github.com/acme/motion", fakeGithub({ "acme/motion": MOTION }));
    expect(await removeSkill(skill.id)).toBe(true);
    expect(await getSkill(skill.id)).toBeNull();
    expect(existsSync(join(dataDir, "skills", skill.id))).toBe(false);
    expect(await removeSkill(skill.id)).toBe(false);
    expect(await removeSkill("../projects")).toBe(false);
  });
});

describe("importing a skill from a folder", () => {
  const scratch = mkdtempSync(join(tmpdir(), "memotion-skill-src-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function makeSkill(dir: string, name: string): string {
    mkdirSync(join(dir, "reference"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: from disk\n---\nbody`);
    writeFileSync(join(dir, "reference", "a.md"), "A");
    writeFileSync(join(dir, "scripts", "run.py"), "print(1)");
    writeFileSync(join(dir, "logo.png"), "png");
    writeFileSync(join(dir, "node_modules", "dep", "readme.md"), "not mine");
    return dir;
  }

  it("keeps only text documents, skips symlinks and tool folders, and replaces itself when imported again", async () => {
    const dir = makeSkill(join(scratch, "disk-skill"), "Disk Skill");
    writeFileSync(join(scratch, "outside.md"), "secret");
    symlinkSync(join(scratch, "outside.md"), join(dir, "linked.md"));
    const skill = await installSkillFromFolder(dir);
    expect(skill).toMatchObject({ id: "disk-skill", name: "Disk Skill", origin: "folder" });
    expect(skill.files).toEqual(["SKILL.md", "reference/a.md"]);
    writeFileSync(join(dir, "reference", "b.md"), "B");
    const again = await installSkillFromFolder(dir);
    expect(again.id).toBe(skill.id);
    expect(again.files).toEqual(["SKILL.md", "reference/a.md", "reference/b.md"]);
    expect((await listSkills()).filter((s) => s.id === skill.id)).toHaveLength(1);
  });

  it("finds the one skill inside a folder, and asks which when there are several", async () => {
    const parent = join(scratch, "skills-home");
    makeSkill(join(parent, "only-one"), "Only One");
    expect((await installSkillFromFolder(parent)).name).toBe("Only One");
    makeSkill(join(parent, "second"), "Second");
    await expect(installSkillFromFolder(parent)).rejects.toThrow(/holds 2 skills \((only-one, second|second, only-one)\)/);
  });

  it("refuses a missing folder, one without SKILL.md, and Memotion's own skills folder", async () => {
    mkdirSync(join(scratch, "empty"), { recursive: true });
    await expect(installSkillFromFolder(join(scratch, "nope"))).rejects.toThrow(/exists/);
    await expect(installSkillFromFolder(join(scratch, "empty"))).rejects.toThrow(/No SKILL\.md/);
    const installed = await installSkill("https://github.com/acme/motion", fakeGithub({ "acme/motion": MOTION }));
    await expect(installSkillFromFolder(join(dataDir, "skills", installed.id))).rejects.toThrow(/already inside Memotion/);
  });
});

describe("the director reading a skill", () => {
  const long = `---\nname: Long\ndescription: long one\n---\n${"x".repeat(SKILL_CHUNK + 500)}END`;

  it("gets SKILL.md with the other file names, continues a long file by offset, and is told when something is missing", async () => {
    const skill = await installSkill("https://github.com/acme/long", fakeGithub({ "acme/long": { branch: "main", files: { "SKILL.md": long, "references/a.md": "A" } } }));
    const { id } = await createProject({ name: "Skilled", orientation: "landscape" });
    const ctx = { signal: new AbortController().signal, vision: false, imageBudget: { left: 0 }, reviewBudget: { left: 0 } };

    const none = await runTool(id, "read_skill", {}, ctx);
    expect(none.ok).toBe(false);
    expect(none.content).toMatch(/No skill is attached/);

    await updateMeta(id, { skillId: skill.id });
    const first = await runTool(id, "read_skill", {}, ctx);
    expect(first.ok).toBe(true);
    expect(first.content).toContain(`more characters: call read_skill again with offset=${SKILL_CHUNK}`);
    expect(first.content).not.toContain("END");
    const rest = await runTool(id, "read_skill", { offset: SKILL_CHUNK }, ctx);
    expect(rest.content).toContain("END");
    expect(rest.content).not.toMatch(/more characters/);
    expect((await runTool(id, "read_skill", { file: "references/a.md" }, ctx)).content).toBe("A");
    const missing = await runTool(id, "read_skill", { file: "../../meta.json" }, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.content).toMatch(/no file/);
    expect(first.content).toMatch(/Other files in this skill[^]*references\/a\.md/);

    await removeSkill(skill.id);
    expect((await runTool(id, "read_skill", {}, ctx)).ok).toBe(false);
  }, 60_000);
});
