/**
 * Runs inside the preview page, and only there: the sidecar adds it while proxying the Studio's page, so the project's
 * own files (and therefore renders) never contain it. It answers the app's questions about what is on screen:
 * which element is under a point, what does it look like, and it draws the hover and selection boxes.
 *
 * Messages in:  { source: "memotion-parent", type: "hover" | "leave" | "select" (x,y or selector) | "clear" | "describe", ... }
 * Messages out: { source: "memotion-pick", type: "ready" | "hover" | "selected" | "described", ... }
 * Coordinates are composition pixels, which are the page's own client pixels (the app scales the whole frame).
 */
export const PICK_SCRIPT = String.raw`
(() => {
  if (window.__memotionPick) return;
  window.__memotionPick = true;
  const post = (m) => parent.postMessage({ source: "memotion-pick", ...m }, "*");

  const box = (id, border, fill) => {
    const el = document.createElement("div");
    el.id = id;
    el.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;display:none;box-sizing:border-box;border:3px solid " + border + ";background:" + fill + ";border-radius:2px";
    const tag = document.createElement("div");
    tag.style.cssText = "position:absolute;left:-3px;top:-26px;max-width:600px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:" + border + ";color:#04210f;font:600 15px/22px system-ui,sans-serif;padding:0 8px;border-radius:3px";
    el.appendChild(tag);
    document.body.appendChild(el);
    return { el, tag };
  };
  const hover = box("__mo_hover", "#2fbf71", "rgba(47,191,113,0.10)");
  const picked = box("__mo_picked", "#2fbf71", "rgba(47,191,113,0.20)");
  let pickedEl = null;

  const own = (e) => e.id && e.id.indexOf("__mo_") === 0;

  // Elements that are fully transparent still receive hits; picking one would select something nobody can see.
  const effectiveOpacity = (e) => {
    let o = 1;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      o *= Number(cs.opacity);
      if (cs.visibility === "hidden") return 0;
    }
    return o;
  };

  const coversFrame = (e) => {
    const r = e.getBoundingClientRect();
    return r.width >= innerWidth * 0.98 && r.height >= innerHeight * 0.98;
  };

  function pickAt(x, y) {
    const stack = document.elementsFromPoint(x, y).filter((e) => !own(e) && e !== document.documentElement && e !== document.body && effectiveOpacity(e) > 0.02);
    return stack.find((e) => !coversFrame(e)) || stack[0] || null;
  }

  function selectorOf(e) {
    if (e.id) return "#" + CSS.escape(e.id);
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id) {
        parts.unshift("#" + CSS.escape(n.id));
        break;
      }
      let s = n.tagName.toLowerCase();
      const cls = Array.from(n.classList).filter((c) => c !== "clip").slice(0, 2);
      if (cls.length) s += "." + cls.map((c) => CSS.escape(c)).join(".");
      const same = n.parentElement ? Array.from(n.parentElement.children).filter((x) => x.tagName === n.tagName) : [];
      if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      parts.unshift(s);
    }
    return parts.join(" > ");
  }

  function describe(e) {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    const comp = e.closest("[data-composition-id]");
    const src = e.closest("[data-composition-src]");
    const clip = e.closest("[data-start]");
    const text = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const media = e.getAttribute("src") || e.getAttribute("href") || undefined;
    return {
      selector: selectorOf(e),
      id: e.id || undefined,
      tag: e.tagName.toLowerCase(),
      classes: Array.from(e.classList).filter((c) => c !== "clip"),
      text: text || undefined,
      media,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      compositionId: comp ? comp.getAttribute("data-composition-id") : undefined,
      compositionFile: src ? src.getAttribute("data-composition-src") : undefined,
      start: clip ? clip.getAttribute("data-start") : undefined,
      duration: clip ? clip.getAttribute("data-duration") : undefined,
      styles: { color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, fontFamily: cs.fontFamily.split(",")[0], fontWeight: cs.fontWeight, opacity: cs.opacity },
    };
  }

  const place = (b, e) => {
    const r = e.getBoundingClientRect();
    b.el.style.left = r.left + "px";
    b.el.style.top = r.top + "px";
    b.el.style.width = r.width + "px";
    b.el.style.height = r.height + "px";
    b.el.style.display = "block";
  };
  const label = (e) => (e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.classList[0] ? "." + e.classList[0] : ""));

  // The selection follows its element while the animation moves it.
  (function follow() {
    if (pickedEl && pickedEl.isConnected) place(picked, pickedEl);
    requestAnimationFrame(follow);
  })();

  window.addEventListener("message", (ev) => {
    if (ev.source !== parent || !ev.data || ev.data.source !== "memotion-parent") return;
    const m = ev.data;
    if (m.type === "hover") {
      const e = pickAt(m.x, m.y);
      if (!e) return void (hover.el.style.display = "none");
      place(hover, e);
      hover.tag.textContent = label(e);
      post({ type: "hover", target: describe(e) });
    } else if (m.type === "leave") {
      hover.el.style.display = "none";
    } else if (m.type === "select") {
      // By selector when the app re-selects after the page reloaded; by point when the user clicks.
      let e = null;
      if (typeof m.selector === "string") {
        try {
          e = document.querySelector(m.selector);
        } catch (err) {
          e = null;
        }
      } else e = pickAt(m.x, m.y);
      pickedEl = e;
      hover.el.style.display = "none";
      if (e) {
        picked.tag.textContent = label(e);
        place(picked, e);
      } else picked.el.style.display = "none";
      post({ type: "selected", reqId: m.reqId, target: e ? describe(e) : null });
    } else if (m.type === "clear") {
      pickedEl = null;
      picked.el.style.display = "none";
    } else if (m.type === "describe") {
      const seen = {};
      const targets = [];
      for (const p of m.points || []) {
        const e = pickAt(p[0], p[1]);
        if (!e) continue;
        const d = describe(e);
        if (seen[d.selector]) continue;
        seen[d.selector] = true;
        targets.push(d);
        if (targets.length >= 12) break;
      }
      post({ type: "described", reqId: m.reqId, targets });
    }
  });

  post({ type: "ready" });
})();
`;
