/**
 * NEOP responsive audit — real headless-browser measurements.
 *
 * Drives an installed Chromium browser (Edge/Chrome) over the DevTools
 * Protocol using Node's built-in WebSocket. No npm dependencies.
 *
 * For every route × viewport width it reports:
 *   • horizontal overflow (documentElement.scrollWidth - innerWidth) and the
 *     exact elements causing it — the root cause, never a hidden symptom
 *   • whether the document can actually scroll vertically
 *   • inner scroll areas (nested scrollers) and their pixel sizes
 *   • fixed/sticky elements and how much vertical space they occupy, so
 *     content can be checked for being covered
 *
 * Usage:
 *   node _scripts/responsive-audit.mjs [--routes "/,/admin/login"] [--widths 320,375,...]
 *                                      [--base http://localhost:3000] [--json out.json]
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3000");
const ROUTES = arg(
  "routes",
  "/,/about/methodology,/about/privacy,/admin/login,/agent/login,/agent/register,/auth/auth-code-error"
).split(",").map((s) => s.trim()).filter(Boolean);
const WIDTHS = arg("widths", "320,375,390,430,768,820,1024,1280,1440,1920")
  .split(",").map(Number).filter((n) => n > 0);
const SETTLE_MS = Number(arg("settle", "1800"));
const JSON_OUT = arg("json", "_logs/responsive-audit.json");
const PORT = Number(arg("port", "9223"));
// Optional session cookie so authenticated screens (admin console, agent
// area) can be measured too, e.g. --cookie "sb-<ref>-auth-token=<json>".
const COOKIE = arg("cookie", "");
// Optional full session JSON (as returned by the GoTrue token endpoint).
// supabase-js keeps its session in localStorage, so a cookie alone only gets
// past the edge middleware — the client SDK would still boot unauthenticated
// and the page's own gate would bounce to login. Seeding the same key makes
// the authenticated screens measure as a real signed-in user sees them.
const SESSION_FILE = arg("session", "");

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.error("No Chromium browser found. Tried:\n" + CANDIDATES.join("\n"));
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "neop-qa-"));
const child = spawn(
  browserPath,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars=false",
    "--window-size=1280,900",
    "about:blank",
  ],
  { stdio: "ignore", detached: false }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("DevTools endpoint never came up");
}

async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  return page;
}

/** Minimal CDP client: send(method, params) -> result. */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    const listeners = [];

    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const msgId = ++id;
          ws.send(JSON.stringify({ id: msgId, method, params }));
          return new Promise((res, rej) => pending.set(msgId, { res, rej }));
        },
        on(fn) { listeners.push(fn); },
        drain() { return events.splice(0, events.length); },
        close() { try { ws.close(); } catch {} },
      })
    );
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        events.push(msg.method);
        listeners.forEach((fn) => fn(msg));
      }
    });
  });
}

const MEASURE = `(() => {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const bad = [];
  const nodes = document.querySelectorAll('body *');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    const over = Math.round(b.right - vw);
    if (over > 1) {
      // Walk up to find the scroll/clip container that owns this element: an
      // element past the viewport edge is only acceptable when an ancestor
      // deliberately scrolls or clips it.
      let host = el.parentElement, hostDesc = 'none';
      for (let h = 0; h < 8 && host; h++) {
        const hcs = getComputedStyle(host);
        if (hcs.overflowX === 'auto' || hcs.overflowX === 'scroll' || hcs.overflowX === 'hidden') {
          hostDesc = hcs.overflowX + ':' + String(host.className || '').slice(0, 40);
          break;
        }
        host = host.parentElement;
      }
      bad.push({
        tag: el.tagName.toLowerCase(), over: over, w: Math.round(b.width),
        cls: String(el.className || '').slice(0, 90), host: hostDesc,
      });
    }
  }
  const sc = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 40) {
      sc.push({ cls: String(el.className || '').slice(0, 70), ch: el.clientHeight, sh: el.scrollHeight });
    }
  }
  const bars = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const b = el.getBoundingClientRect();
    if (b.height < 4 || b.width < 40) continue;
    bars.push({ cls: String(el.className || '').slice(0, 60), pos: cs.position, top: Math.round(b.top), h: Math.round(b.height) });
  }
  // Vertical rhythm: how much breathing room each major section gives,
  // measured as the offset from the section's top edge to its first heading
  // and its own block padding.
  const sections = [];
  const sectionEls = document.querySelectorAll('main > section, main > div > section');
  for (let i = 0; i < sectionEls.length; i++) {
    const el = sectionEls[i];
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const head = el.querySelector('h1, h2, h3');
    const inner = el.querySelector('div');
    const ics = inner ? getComputedStyle(inner) : null;
    sections.push({
      id: el.id || String(el.className || '').slice(0, 40),
      h: Math.round(b.height),
      padT: Math.round(parseFloat(cs.paddingTop) || 0),
      padB: Math.round(parseFloat(cs.paddingBottom) || 0),
      innerPadT: ics ? Math.round(parseFloat(ics.paddingTop) || 0) : 0,
      headOffset: head ? Math.round(head.getBoundingClientRect().top - b.top) : null,
    });
  }

  window.scrollTo(0, 0);
  const before = window.scrollY;
  window.scrollTo(0, 99999);
  const maxScroll = window.scrollY;
  window.scrollTo(0, before);
  return {
    vw: vw,
    docW: de.scrollWidth,
    hOverflow: de.scrollWidth - vw,
    docH: de.scrollHeight,
    viewportH: window.innerHeight,
    maxScroll: Math.round(maxScroll),
    canScroll: maxScroll > 20,
    overflowCount: bad.length,
    overflowers: bad.slice(0, 14),
    innerScrollerCount: sc.length,
    innerScrollers: sc.slice(0, 5),
    bars: bars.slice(0, 8),
    sections: sections,
    title: document.title,
    // Proof of what was actually measured: a redirect to a login page would
    // otherwise read as a clean pass for a protected route.
    path: location.pathname,
    h1: (document.querySelector('h1') ? document.querySelector('h1').textContent : '')
      .replace(/\s+/g, ' ').trim().slice(0, 60),
    textLen: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
  };
})()`;

async function main() {
  await waitForDevTools();
  const ws = await connect((await pageTarget()).webSocketDebuggerUrl);
  await ws.send("Network.enable");
  await ws.send("Page.enable");
  await ws.send("Runtime.enable");

  if (COOKIE) {
    const eq = COOKIE.indexOf("=");
    const name = COOKIE.slice(0, eq);
    const value = COOKIE.slice(eq + 1);
    for (const domain of ["localhost", "127.0.0.1"]) {
      await ws.send("Network.setCookie", {
        name, value, domain, path: "/", httpOnly: false, secure: false, sameSite: "Lax",
      }).catch(() => {});
    }
  }

  // Seed the SDK's own session so authenticated screens render signed-in.
  if (SESSION_FILE && COOKIE) {
    const key = COOKIE.slice(0, COOKIE.indexOf("="));
    const sessionJson = readFileSync(SESSION_FILE, "utf8").trim();
    await ws.send("Page.navigate", { url: BASE + "/" });
    await sleep(1500);
    const seeded = await ws.send("Runtime.evaluate", {
      expression: `try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(
        sessionJson
      )}); 'seeded' } catch (e) { 'seed-failed: ' + e.message }`,
      returnByValue: true,
    });
    console.log(
      "session seed: " + (seeded.result?.result?.value || JSON.stringify(seeded)) +
      " under " + key
    );
    // The SDK restores the session on boot, so the next real navigation
    // starts authenticated.
  }

  const results = [];
  let prevMobile = null;
  for (const width of WIDTHS) {
    // Flushing the emulation change keeps the mobile→desktop transition from
    // leaking stale metrics into the next measurement (Chromium applies the
    // override lazily, so a narrow viewport was occasionally measured at the
    // previous width). Re-measure and retry once if the viewport is wrong.
    await ws.send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: 1, mobile: width <= 430,
    });
    if (prevMobile !== null && prevMobile !== width <= 430) {
      await ws.send("Page.navigate", { url: BASE + "/" });
      await sleep(800);
    }
    prevMobile = width <= 430;
    for (const route of ROUTES) {
      const url = BASE + route;
      ws.drain();
      const loaded = new Promise((res) => {
        const timer = setTimeout(res, 12000);
        ws.on((m) => { if (m.method === "Page.loadEventFired") { clearTimeout(timer); res(); } });
      });
      try {
        await ws.send("Page.navigate", { url });
      } catch (e) {
        // navigation aborted (e.g. redirect chain) — measurement still useful
      }
      await loaded;
      await sleep(SETTLE_MS);

      let rec = { route, width };
      try {
        const r = await ws.send("Runtime.evaluate", {
          expression: MEASURE, returnByValue: true, awaitPromise: false,
        });
        rec = { ...rec, ...(r.result.value || {}) };
        // The emulation override is applied lazily on some transitions; if the
        // measured viewport doesn't match the requested width, give the
        // renderer a beat and measure once more.
        if (rec.vw && rec.vw !== width) {
          await sleep(700);
          const r2 = await ws.send("Runtime.evaluate", {
            expression: MEASURE, returnByValue: true, awaitPromise: false,
          });
          if (r2.result.value && r2.result.value.vw === width) {
            rec = { ...rec, ...(r2.result.value || {}) };
          }
        }
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 140);
      }
      results.push(rec);

      const verdict = rec.hOverflow > 0
        ? `OVERFLOW +${rec.hOverflow}px`
        : rec.error ? `ERROR ${rec.error}` : "ok";
      console.log(
        `${String(width).padStart(4)}px  ${route.padEnd(26)} ${verdict}` +
        (rec.innerScrollerCount ? `   inner-scrollers:${rec.innerScrollerCount}` : "") +
        (rec.canScroll === false ? "   NO-PAGE-SCROLL" : "")
      );
      (rec.overflowers || []).forEach((o) =>
        console.log(`        +${o.over}px  <${o.tag}> w=${o.w} host=${o.host}  ${o.cls}`)
      );
      (rec.innerScrollers || []).forEach((s) =>
        console.log(`        inner-scroll ${s.ch}/${s.sh}px  ${s.cls}`)
      );
    }
  }

  writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, routes: ROUTES, widths: WIDTHS, results }, null, 1));
  console.log(`\nWrote ${JSON_OUT}`);

  const worst = results.filter((r) => r.hOverflow > 0).length;
  const trapped = results.filter((r) => r.canScroll === false).length;
  console.log(`Summary: ${results.length} measurements · ${worst} with horizontal overflow · ${trapped} without page scroll`);

  ws.close();
  child.kill();
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e.message);
  try { child.kill(); } catch {}
  process.exit(1);
});
