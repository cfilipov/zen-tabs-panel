#!/usr/bin/env python3
"""Live smoke test for the Zen Tabs Panel popup.

Runs through the same chrome DevTools bridge as tools/firefox-eval.py. The
check is intentionally integration-heavy: it verifies that the chrome overlay
browser loads popup.html, the popup DOM renders, and visible-popup keyboard
dispatch still reaches the Svelte runtime.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FIREFOX_EVAL = ROOT / "tools" / "firefox-eval.py"


def run_eval(js: str) -> str:
    try:
        proc = subprocess.run(
            [sys.executable, str(FIREFOX_EVAL), js],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"firefox-eval timed out: {js[:160]}") from exc
    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or f"firefox-eval exited {proc.returncode}"
        raise RuntimeError(message)
    return proc.stdout.strip()


def eval_json(js: str) -> Any:
    out = run_eval(js)
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Expected JSON from firefox-eval, got: {out}") from exc


def start_smoke() -> str:
    js = r"""
(() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const runId = "popup-smoke-" + Date.now();
  const resultKey = "__ztpPopupSmoke";
  w[resultKey] = { ok: false, done: false, runId, steps: [], startedAt: Date.now() };

  const record = (name, data = {}) => {
    w[resultKey].steps.push({ name, ...data });
  };
  const fail = (message, data = {}) => {
    w[resultKey] = {
      ...w[resultKey],
      ok: false,
      done: true,
      message,
      ...data,
      finishedAt: Date.now()
    };
  };
  const sleep = (ms) => new Promise(resolve => w.setTimeout(resolve, ms));
  const mmForBrowser = (br) => br && (br.messageManager || br.frameLoader?.messageManager || null);

  function overlayState() {
    const overlay = w.document.getElementById("zen-tabs-panel-overlay");
    const panel = w.document.getElementById("zen-tabs-panel-panel");
    const br = w.document.getElementById("zen-tabs-panel-browser");
    return {
      overlay: !!overlay,
      closing: overlay?.dataset?.closing || "",
      visibility: overlay ? w.getComputedStyle(overlay).visibility : null,
      panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
      panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
      browserWidth: br ? br.style.width : "",
      browserHeight: br ? br.style.height : "",
      src: br?.getAttribute("src") || "",
      currentURI: String(br?.currentURI?.spec || ""),
      hasWindowGlobal: !!br?.browsingContext?.currentWindowGlobal,
      hasMessageManager: !!mmForBrowser(br)
    };
  }

  function getBackgroundMessageManager() {
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const ext = ExtensionParent.GlobalManager.extensionMap.get("zen-tabs-panel@c13v.com");
    const bg = Array.from(ext?.views || []).find(view => view.viewType === "background");
    return bg?.xulBrowser?.messageManager || bg?.xulBrowser?.frameLoader?.messageManager || null;
  }

  function runInBackground(source) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      function startWhenReady() {
        const mm = getBackgroundMessageManager();
        if (!mm) {
          if (Date.now() - startedAt < 5000) {
            w.setTimeout(startWhenReady, 100);
          } else {
            reject(new Error("no background messageManager"));
          }
          return;
        }
      const name = "ZenTabsPanel:PopupSmokeBg:" + Date.now() + ":" + Math.random();
      const timeout = w.setTimeout(() => {
        try { mm.removeMessageListener(name, handler); } catch (e) {}
        reject(new Error("background probe timed out"));
      }, 5000);
      function handler(msg) {
        w.clearTimeout(timeout);
        try { mm.removeMessageListener(name, handler); } catch (e) {}
        resolve(msg.data);
      }
      mm.addMessageListener(name, handler);
      const code = `(() => {
        (async () => {
          const cw = content.wrappedJSObject || content;
          try {
            const value = await (${source})(cw);
            sendAsyncMessage(${JSON.stringify(name)}, { ok: true, value });
          } catch (e) {
            sendAsyncMessage(${JSON.stringify(name)}, {
              ok: false,
              message: String(e && e.message || e),
              stack: String(e && e.stack || e)
            });
          }
        })();
      })();`;
      mm.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
      }
      startWhenReady();
    }).then(reply => {
      if (!reply || !reply.ok) throw new Error(reply?.message || "background probe failed");
      return reply.value;
    });
  }

  function runInPopup(source) {
    return new Promise((resolve, reject) => {
      const br = w.document.getElementById("zen-tabs-panel-browser");
      const mm = mmForBrowser(br);
      if (!mm) {
        reject(new Error("no popup messageManager"));
        return;
      }
      const name = "ZenTabsPanel:PopupSmokeFrame:" + Date.now() + ":" + Math.random();
      const timeout = w.setTimeout(() => {
        try { mm.removeMessageListener(name, handler); } catch (e) {}
        reject(new Error("popup frame probe timed out"));
      }, 1500);
      function handler(msg) {
        w.clearTimeout(timeout);
        try { mm.removeMessageListener(name, handler); } catch (e) {}
        resolve(msg.data);
      }
      mm.addMessageListener(name, handler);
      const code = `(() => {
        try {
          const value = (${source})(content);
          sendAsyncMessage(${JSON.stringify(name)}, { ok: true, value });
        } catch (e) {
          sendAsyncMessage(${JSON.stringify(name)}, {
            ok: false,
            message: String(e && e.message || e),
            stack: String(e && e.stack || e)
          });
        }
      })();`;
      mm.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
    }).then(reply => {
      if (!reply || !reply.ok) throw new Error(reply?.message || "popup frame probe failed");
      return reply.value;
    });
  }

  async function waitFor(label, predicate, timeoutMs = 5000, intervalMs = 50) {
    const deadline = Date.now() + timeoutMs;
    let lastValue = null;
    while (Date.now() < deadline) {
      lastValue = await predicate();
      if (lastValue && (!lastValue.ok === false)) return lastValue;
      if (lastValue === true) return true;
      await sleep(intervalMs);
    }
    throw new Error(label + " timed out: " + JSON.stringify(lastValue));
  }

  function keySource(key) {
    return `(content) => {
      const event = new content.KeyboardEvent("keydown", {
        key: ${JSON.stringify(key)},
        code: ${JSON.stringify(key === " " ? "Space" : "Key" + key.toUpperCase())},
        bubbles: true,
        cancelable: true
      });
      content.window.dispatchEvent(event);
      return {
        key: ${JSON.stringify(key)},
        defaultPrevented: event.defaultPrevented
      };
    }`;
  }

  function snapshotSource() {
    return `(content) => {
      const doc = content.document;
      const text = doc.body?.innerText || "";
      const selected = doc.querySelector(".list-item.selected");
      return {
        href: String(content.location.href),
        readyState: doc.readyState,
        textHead: text.split("\\n").slice(0, 50),
        textLength: text.length,
        title: doc.querySelector("#title, .title, h1, h2")?.textContent || "",
        pageDots: Array.from(doc.querySelectorAll("#page-indicator .page-dot")).map(dot => ({
          page: dot.getAttribute("data-page"),
          active: dot.classList.contains("active")
        })),
        activePage: doc.querySelector("#page-indicator .page-dot.active")?.getAttribute("data-page") || null,
        selectedId: selected?.getAttribute("data-id") || selected?.getAttribute("data-domain") || selected?.getAttribute("data-dom-id") || null,
        actionPages: Array.from(doc.querySelectorAll(".actions-page")).map(page => ({
          page: page.getAttribute("data-page"),
          text: (page.textContent || "").trim(),
          textLength: (page.textContent || "").trim().length
        })),
        domainsHeader: Array.from(doc.querySelectorAll(".list-section-header, .subtle, .item-title"))
          .map(node => (node.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 20)
      };
    }`;
  }

  function requireText(snapshot, expected, label) {
    const text = snapshot.textHead.join("\n");
    if (!text.includes(expected)) {
      throw new Error(label + " missing text " + JSON.stringify(expected) + ": " + text);
    }
  }

  async function trySnapshot() {
    try {
      return { ok: true, snap: await runInPopup(snapshotSource()) };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), state: overlayState() };
    }
  }

  function compactActionPages(snapshot) {
    return snapshot.actionPages.map(page => ({ page: page.page, textLength: page.textLength }));
  }

  function compactSuccessSteps(steps) {
    return steps.map((step) => {
      const compact = { name: step.name };
      if ("width" in step) compact.width = step.width;
      if ("activePage" in step) compact.activePage = step.activePage;
      if ("opened" in step) compact.opened = step.opened;
      if ("browserWidth" in step) compact.browserWidth = step.browserWidth;
      if ("browserHeight" in step) compact.browserHeight = step.browserHeight;
      return compact;
    });
  }

  async function hidePaletteForNextOpen(label) {
    record(label);
    await runInBackground(`async (cw) => {
      await cw.browser.zenWorkspaces.hidePalette();
      return true;
    }`);
    await waitFor(label + " hidden", () => {
      const state = overlayState();
      if (!state.overlay || state.visibility === "hidden") {
        return { ok: true, state };
      }
      return { ok: false, state };
    }, 3000, 50);
    await sleep(250);
  }

  async function forcePopupReady(label) {
    record(label);
    await runInPopup(`(content) => {
      const payload = { type: "force-ready", data: { buffered: [] } };
      content.document.dispatchEvent(new content.CustomEvent("ztt:bridge-message", { detail: JSON.stringify(payload) }));
      return true;
    }`);
    await sleep(80);
  }

  async function openDirectView(view, expectedText, opts = {}) {
    await hidePaletteForNextOpen("hide-before-" + view);
    record("show-" + view);
    const opened = await runInBackground(`async (cw) => {
      return await cw.browser.zenWorkspaces.showPalette(${JSON.stringify(view)});
    }`);
    record("show-" + view + "-result", { opened });

    const minWidth = opts.minWidth || 200;
    const maxWidth = opts.maxWidth || 1100;
    const state = await waitFor(view + " overlay", () => {
      const current = overlayState();
      const width = current.panelWidth || Number.parseInt(current.browserWidth, 10);
      if (
        current.overlay &&
        current.visibility !== "hidden" &&
        current.hasMessageManager &&
        current.currentURI.includes("popup.html") &&
        width >= minWidth &&
        width <= maxWidth
      ) {
        return { ok: true, state: current };
      }
      return { ok: false, state: current };
    }, opts.overlayTimeout || 5000, 100);

    const snap = await waitFor(view + " content", async () => {
      const result = await trySnapshot();
      if (!result.ok) return result;
      const current = result.snap;
      const text = current.textHead.join("\n");
      if (text.includes(expectedText) && !text.includes("Loading...")) {
        return { ok: true, snap: current };
      }
      return { ok: false, snap: current };
    }, opts.contentTimeout || 7000, 100);

    if (snap.snap.selectedId) {
      throw new Error(view + " has unexpected permanent selection: " + snap.snap.selectedId);
    }
    record("view-" + view, {
      textHead: snap.snap.textHead.slice(0, 12),
      href: snap.snap.href,
      width: state.state.panelWidth || Number.parseInt(state.state.browserWidth, 10)
    });
    return snap.snap;
  }

  (async () => {
    try {
      record("hide-palette");
      await runInBackground(`async (cw) => {
        await cw.browser.zenWorkspaces.hidePalette();
        return true;
      }`);
      await sleep(700);

      record("show-palette");
      const opened = await runInBackground(`async (cw) => {
        return await cw.browser.zenWorkspaces.showPalette({ skipChord: true });
      }`);
      record("show-result", { opened });

      await waitFor("overlay popup browser", () => {
        const state = overlayState();
        if (
          state.overlay &&
          state.visibility !== "hidden" &&
          state.hasMessageManager &&
          state.currentURI.includes("popup.html")
        ) {
          return { ok: true, state };
        }
        return { ok: false, state };
      });
      const loadedState = overlayState();
      record("overlay-loaded", loadedState);

      const main = await waitFor("main menu text", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const snap = result.snap;
        const head = snap.textHead.join("\n");
        if (head.includes("Navigate") && head.includes("All tabs")) {
          return { ok: true, snap };
        }
        return { ok: false, snap };
      });
      record("main-menu", {
        activePage: main.snap.activePage,
        pageDots: main.snap.pageDots,
        actionPages: compactActionPages(main.snap)
      });
      if (main.snap.pageDots.length < 2 || main.snap.activePage !== "1") {
        throw new Error("main menu page dots did not render active page 1");
      }
      if (main.snap.selectedId) {
        throw new Error("main menu has unexpected permanent selection: " + main.snap.selectedId);
      }
      const mainSize = await waitFor("actions panel width", () => {
        const state = overlayState();
        const width = state.panelWidth || Number.parseInt(state.browserWidth, 10);
        if (width >= 900) {
          return { ok: true, state };
        }
        return { ok: false, state };
      }, 2500, 100);
      record("main-menu-size", mainSize.state);
      await forcePopupReady("force-ready");
      await sleep(270);

      record("press-space");
      const spaceDispatch = await runInPopup(keySource(" "));
      record("press-space-result", spaceDispatch);
      const pageTwoResult = await waitFor("actions page 2 after Space", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const snap = result.snap;
        return snap.activePage === "2" ? { ok: true, snap } : { ok: false, snap };
      }, 1000, 50);
      const pageTwo = pageTwoResult.snap;
      record("after-space", {
        activePage: pageTwo.activePage,
        pageDots: pageTwo.pageDots,
        actionPages: compactActionPages(pageTwo)
      });
      if (pageTwo.activePage !== "2") throw new Error("Space did not activate actions page 2");
      const secondPage = pageTwo.actionPages.find(page => page.page === "2");
      if (!secondPage || secondPage.textLength < 20) throw new Error("Actions page 2 is blank");
      if (!secondPage.text.includes("This page")) throw new Error("actions page 2 missing This page");

      record("press-space-back");
      await runInPopup(keySource(" "));
      const pageOneAgainResult = await waitFor("actions page 1 after second Space", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const snap = result.snap;
        return snap.activePage === "1" ? { ok: true, snap } : { ok: false, snap };
      }, 1000, 50);
      const pageOneAgain = pageOneAgainResult.snap;
      if (pageOneAgain.activePage !== "1") throw new Error("Second Space did not return to actions page 1");

      record("replay-leaf-setup");
      await runInPopup(keySource("L"));
      await sleep(450);

      await openDirectView("actions", "Navigate", { minWidth: 900, maxWidth: 1000 });
      await forcePopupReady("force-ready-before-menu-only");
      record("press-w-menu-only");
      await runInPopup(keySource("W"));
      const closeMenu = await waitFor("close-and-select menu-only open", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const text = result.snap.textHead.join("\n");
        if (text.includes("Close & select") && text.includes("Next in sidebar")) {
          return { ok: true, snap: result.snap };
        }
        return { ok: false, snap: result.snap };
      }, 3000, 100);
      record("after-w-menu-only", { textHead: closeMenu.snap.textHead.slice(0, 10), href: closeMenu.snap.href });
      await runInPopup(keySource("Escape"));
      await sleep(350);

      await openDirectView("actions", "Navigate", { minWidth: 900, maxWidth: 1000 });
      await forcePopupReady("force-ready-before-replay");
      record("press-dot-replay");
      await runInPopup(keySource("."));
      const replayState = await waitFor("replay preserved prior leaf action", async () => {
        const state = overlayState();
        if (!state.overlay || state.visibility === "hidden") {
          return { ok: true, state };
        }
        const result = await trySnapshot();
        if (result.ok) {
          const text = result.snap.textHead.join("\n");
          if (text.includes("Close & select") || text.includes("Next in sidebar")) {
            return { ok: false, state, snap: result.snap, menuOnlyReplayVisible: true };
          }
        }
        return { ok: false, state, snap: result.ok ? result.snap : result };
      }, 3000, 100);
      record("after-dot-replay", replayState.state);

      await openDirectView("actions", "Navigate", { minWidth: 900, maxWidth: 1000 });
      await forcePopupReady("force-ready-before-r");
      record("press-r-recent");
      await runInPopup(keySource("R"));
      await sleep(180);
      const recent = await runInPopup(snapshotSource());
      record("after-r", { textHead: recent.textHead.slice(0, 12), href: recent.href });
      requireText(recent, "Recent", "R key");

      record("hide-before-domains-direct");
      await runInBackground(`async (cw) => {
        await cw.browser.zenWorkspaces.hidePalette();
        return true;
      }`);
      await sleep(700);

      record("show-domains-direct");
      const domainsOpened = await runInBackground(`async (cw) => {
        return await cw.browser.zenWorkspaces.showPalette("domains");
      }`);
      record("domains-show-result", { opened: domainsOpened });

      await waitFor("domains overlay width", () => {
        const state = overlayState();
        const width = state.panelWidth || Number.parseInt(state.browserWidth, 10);
        if (
          state.overlay &&
          state.visibility !== "hidden" &&
          state.hasMessageManager &&
          width >= 700 &&
          width < 900
        ) {
          return { ok: true, state };
        }
        return { ok: false, state };
      }, 3000, 100);

      const domains = await waitFor("domains list content", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const snap = result.snap;
        const text = snap.textHead.join("\n");
        if (text.includes("Domains") && !text.includes("Loading...") && snap.textLength > 20) {
          return { ok: true, snap };
        }
        return { ok: false, snap };
      }, 4000, 100);
      record("domains-direct", { textHead: domains.snap.textHead.slice(0, 12), href: domains.snap.href });

      record("force-ready-domains");
      await forcePopupReady("force-ready-domains-drain");

      record("press-s-domain-sort");
      await runInPopup(keySource("S"));
      const sorted = await waitFor("domains after sort", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const snap = result.snap;
        const text = snap.textHead.join("\n");
        if (text.includes("Domains") && !text.includes("Loading...") && snap.textLength > 20) {
          return { ok: true, snap };
        }
        return { ok: false, snap };
      }, 4000, 100);
      record("after-s-domains", { textHead: sorted.snap.textHead.slice(0, 12), href: sorted.snap.href });

      const firstDomain = await runInPopup(`(content) => {
        return content.document.querySelector(".list-item .item-title")?.textContent?.trim() || "";
      }`);
      if (!firstDomain) throw new Error("Domains view did not expose a first domain row for buffered drill");

      record("force-ready-domains-buffered-1");
      await runInPopup(`(content) => {
        const payload = {
          type: "force-ready",
          data: { buffered: [{ key: "1", code: "Digit1", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }] }
        };
        content.document.dispatchEvent(new content.CustomEvent("ztt:bridge-message", { detail: JSON.stringify(payload) }));
        return true;
      }`);
      const drilledDomain = await waitFor("domain buffered drill", async () => {
        const result = await trySnapshot();
        if (!result.ok) return result;
        const snap = result.snap;
        const text = snap.textHead.join("\n");
        if (text.includes(firstDomain) && !text.includes("Domains") && !text.includes("Loading...")) {
          return { ok: true, snap };
        }
        return { ok: false, snap };
      }, 5000, 100);
      record("after-domain-buffered-drill", { domain: firstDomain, textHead: drilledDomain.snap.textHead.slice(0, 12), href: drilledDomain.snap.href });

      const directViews = [
        ["child-tabs", "Children", { minWidth: 650, maxWidth: 760 }],
        ["sibling-tabs", "Siblings", { minWidth: 650, maxWidth: 760 }],
        ["parent-tabs", "Parent tabs", { minWidth: 650, maxWidth: 760 }],
        ["navigation", "Tab history", { minWidth: 580, maxWidth: 640 }],
        ["unvisited-tabs", "New tabs", { minWidth: 650, maxWidth: 760 }],
        ["last-visited", "Recent", { minWidth: 650, maxWidth: 760 }],
        ["recently-closed", "Recently closed", { minWidth: 580, maxWidth: 640 }],
        ["duplicates", "Duplicates", { minWidth: 650, maxWidth: 760 }],
        ["tab-info", "Tab info", { minWidth: 580, maxWidth: 640, overlayTimeout: 12000, contentTimeout: 12000 }],
        ["tabs-by-age", "Tabs by age", { minWidth: 650, maxWidth: 760 }],
        ["most-visited", "Most visited", { minWidth: 650, maxWidth: 760 }],
        ["move-to-workspace", "Move to workspace", { minWidth: 340, maxWidth: 430 }],
        ["open-in-container", "New container tab", { minWidth: 300, maxWidth: 340 }],
        ["profiles", "Profiles", { minWidth: 340, maxWidth: 430 }],
        ["move-to-folder", "Move to folder", { minWidth: 340, maxWidth: 430 }],
        ["split-view", "Split", { minWidth: 340, maxWidth: 430 }],
        ["reorder-tabs", "Reorder tabs", { minWidth: 580, maxWidth: 640 }],
        ["close-and-select", "Close & select", { minWidth: 580, maxWidth: 640 }],
      ];
      for (const [view, expected, opts] of directViews) {
        await openDirectView(view, expected, opts);
      }

      const mainAgain = await openDirectView("actions", "Navigate", { minWidth: 900, maxWidth: 1000 });
      if (!mainAgain.textHead.join("\n").includes("All tabs")) {
        throw new Error("direct actions reopen did not restore the main menu content");
      }

      const finalState = overlayState();
      await runInBackground(`async (cw) => {
        await cw.browser.zenWorkspaces.hidePalette();
        return true;
      }`);
      w[resultKey] = {
        ...w[resultKey],
        ok: true,
        done: true,
        message: "popup smoke passed",
        steps: compactSuccessSteps(w[resultKey].steps),
        finalState,
        finishedAt: Date.now()
      };
    } catch (e) {
      fail(String(e && e.message || e), {
        stack: String(e && e.stack || e),
        state: overlayState()
      });
    }
  })();

  return JSON.stringify({ ok: true, runId, resultKey });
})()
"""
    started = eval_json(js)
    if not started.get("ok"):
        raise RuntimeError(f"Could not start smoke: {started}")
    return started["runId"]


def poll_smoke(timeout: float) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: dict[str, Any] | None = None
    while time.time() < deadline:
        last = eval_json(
            '(() => { const r = Services.wm.getMostRecentWindow("navigator:browser").__ztpPopupSmoke || null; return JSON.stringify(r); })()'
        )
        if last and last.get("done"):
            return last
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for popup smoke; last state:\n{json.dumps(last, indent=2)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the live Zen Tabs Panel popup smoke test.")
    parser.add_argument("--timeout", type=float, default=90.0, help="seconds to wait for the smoke to finish")
    args = parser.parse_args()

    try:
        run_id = start_smoke()
        result = poll_smoke(args.timeout)
    except Exception as exc:
        print(f"popup smoke failed to run: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, indent=2))
    if not result.get("ok"):
        return 1
    if result.get("runId") != run_id:
        print(f"warning: smoke run id changed from {run_id} to {result.get('runId')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
