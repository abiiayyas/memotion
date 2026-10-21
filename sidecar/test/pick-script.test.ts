import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { hyperframesBin } from "../src/config.js";
import { Target } from "../src/marks/store.js";
import { PICK_SCRIPT } from "../src/preview/inject.js";

/** The Chrome the HyperFrames CLI uses for renders; the test is skipped on a machine that has none. */
function chromePath(): string | null {
  try {
    const out = execFileSync(process.execPath, [hyperframesBin(), "browser", "path"], { encoding: "utf8", timeout: 20_000 }).trim().split("\n").at(-1) ?? "";
    return existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

const chrome = chromePath();

const Reply = z.object({ type: z.string(), target: z.unknown().nullish(), targets: z.array(z.unknown()).optional() });

const PAGE = `<!doctype html><html><body style="margin:0;width:1000px;height:600px">
  <div id="bg" style="position:fixed;left:0;top:0;width:1000px;height:600px;background:#111"></div>
  <h1 id="title" style="position:absolute;margin:0;left:100px;top:100px;width:300px;height:80px;color:#fff">Hello  world</h1>
  <div id="ghost" style="position:absolute;left:100px;top:300px;width:300px;height:80px;opacity:0">not visible yet</div>
  <div data-composition-id="scene" data-composition-src="compositions/scene.html" style="position:absolute;left:600px;top:100px;width:300px;height:300px">
    <p class="clip big" data-start="1" data-duration="2" style="margin:0;height:60px">first</p>
    <p class="clip big" data-start="3" data-duration="2" style="margin:0;height:60px">second</p>
  </div>
</body></html>`;

describe.skipIf(!chrome)("the pick script, in a real browser", () => {
  let browser: Browser;
  let page: Page;
  let seq = 0;

  /** Post a message as the parent does and wait for the reply carrying the same request id. */
  const ask = async (message: Record<string, unknown>): Promise<z.infer<typeof Reply>> => {
    const reqId = ++seq;
    return Reply.parse(await page.evaluate(`(async () => {
      const { promise, resolve } = Promise.withResolvers();
      const on = (e) => { if (e.data && e.data.source === "memotion-pick" && e.data.reqId === ${reqId}) { removeEventListener("message", on); resolve(e.data); } };
      addEventListener("message", on);
      postMessage({ source: "memotion-parent", reqId: ${reqId}, ...${JSON.stringify(message)} }, "*");
      return promise;
    })()`));
  };

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: chrome ?? undefined, headless: true, args: ["--no-sandbox"] });
    page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 600 });
    await page.setContent(PAGE);
    await page.addScriptTag({ content: PICK_SCRIPT });
  }, 60_000);
  afterAll(() => browser?.close());

  it("picks the visible element under a point and describes it in a shape the app accepts", async () => {
    const res = await ask({ type: "select", x: 150, y: 130 });
    const target = Target.parse(res.target);
    expect(target.selector).toBe("#title");
    expect(target.tag).toBe("h1");
    expect(target.text).toBe("Hello world"); // runs of whitespace collapse
    expect(target.rect).toMatchObject({ x: 100, y: 100, w: 300, h: 80 });
    expect(target.styles.fontSize).toBeTruthy();
  });

  it("never picks something fully transparent: it receives clicks but nobody can see it", async () => {
    const res = await ask({ type: "select", x: 150, y: 330 });
    expect(Target.parse(res.target).selector).toBe("#bg");
  });

  it("falls back to the full-frame background when nothing else is under the point", async () => {
    const res = await ask({ type: "select", x: 900, y: 550 });
    expect(Target.parse(res.target).selector).toBe("#bg");
  });

  it("gives an element without an id a path that finds it again, and reports its composition file", async () => {
    const res = await ask({ type: "select", x: 700, y: 160 }); // second <p> in the scene
    const target = Target.parse(res.target);
    expect(target.text).toBe("second");
    expect(target.compositionId).toBe("scene");
    expect(target.compositionFile).toBe("compositions/scene.html");
    expect(target.start).toBe("3");
    const found = await page.evaluate(`document.querySelector(${JSON.stringify(target.selector)})?.textContent`);
    expect(found).toBe("second");
  });

  it("lists each element under a drawing once, however many points land on it", async () => {
    const res = await ask({ type: "describe", points: [[120, 120], [200, 140], [380, 170], [650, 40], [700, 70]] });
    const selectors = (res.targets ?? []).map((t) => Target.parse(t).selector);
    expect(selectors.filter((s) => s === "#title")).toHaveLength(1);
    expect(selectors).toContain("#bg");
  });

  it("re-selects by selector after a reload, and answers null (not an error) for a selector that no longer exists", async () => {
    expect(Target.parse((await ask({ type: "select", selector: "#title" })).target).selector).toBe("#title");
    expect((await ask({ type: "select", selector: "#gone" })).target).toBeNull();
    expect((await ask({ type: "select", selector: "((not css" })).target).toBeNull();
  });

  it("draws its own boxes without making them pickable", async () => {
    await ask({ type: "select", x: 150, y: 130 }); // leaves a selection box on #title
    const res = await ask({ type: "select", x: 150, y: 130 });
    expect(Target.parse(res.target).selector).toBe("#title"); // not "__mo_picked"
  });
});
