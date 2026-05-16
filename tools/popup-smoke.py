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
      const mm = getBackgroundMessageManager();
      if (!mm) {
        reject(new Error("no background messageManager"));
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
      }, 5000);
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
      const payload = {
        type: "deliver-key",
        data: {
          key: ${JSON.stringify(key)},
          code: ${JSON.stringify(key === " " ? "Space" : "Key" + key.toUpperCase())}
        }
      };
      const event = new content.CustomEvent("ztt:bridge-message", { detail: JSON.stringify(payload) });
      content.document.dispatchEvent(event);
      return {
        key: ${JSON.stringify(key)}
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

  function compactActionPages(snapshot) {
    return snapshot.actionPages.map(page => ({ page: page.page, textLength: page.textLength }));
  }

  (async () => {
    try {
      record("hide-palette");
      await runInBackground(`async (cw) => {
        await cw.browser.zenWorkspaces.hidePalette();
        return true;
      }`);
      await sleep(120);

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
        const snap = await runInPopup(snapshotSource());
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
      record("force-ready");
      await runInPopup(`(content) => {
        const payload = { type: "force-ready", data: { buffered: [] } };
        content.document.dispatchEvent(new content.CustomEvent("ztt:bridge-message", { detail: JSON.stringify(payload) }));
        return true;
      }`);
      await sleep(350);

      record("press-space");
      await runInPopup(keySource(" "));
      await sleep(80);
      const pageTwo = await runInPopup(snapshotSource());
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
      await sleep(80);
      const pageOneAgain = await runInPopup(snapshotSource());
      if (pageOneAgain.activePage !== "1") throw new Error("Second Space did not return to actions page 1");

      record("press-r-recent");
      await runInPopup(keySource("R"));
      await sleep(180);
      const recent = await runInPopup(snapshotSource());
      record("after-r", { textHead: recent.textHead.slice(0, 12), href: recent.href });
      requireText(recent, "Recent", "R key");

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
    parser.add_argument("--timeout", type=float, default=20.0, help="seconds to wait for the smoke to finish")
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
