#!/usr/bin/env python3
"""Live smoke test for ErgoZen chord state alignment.

This script drives a running Zen instance through the chrome DevTools bridge.
It focuses on the bug class where chrome's current view params diverge from
the WarmRearm payload sent to the popup.
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


def run_eval(js: str, timeout: int = 30) -> str:
    proc = subprocess.run(
        [sys.executable, str(FIREFOX_EVAL), js],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
        timeout=timeout,
    )
    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or f"firefox-eval exited {proc.returncode}"
        raise RuntimeError(message)
    return proc.stdout.strip()


def eval_json(js: str, timeout: int = 30) -> Any:
    out = run_eval(js, timeout=timeout)
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Expected JSON from firefox-eval, got: {out}") from exc


def start_smoke() -> str:
    js = r"""
(() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const runId = "chord-smoke-" + Date.now();
  const resultKey = "__ztpChordSmoke";
  w[resultKey] = { ok: false, done: false, runId, steps: [], startedAt: Date.now() };
  w.__zenTabsPanelSmokeEnabled = true;
  w.__zenTabsPanelTraceEnabled = true;
  w.__zenTabsPanelWarmRearmRecords = [];
  w.__zenTabsPanelLastWarmRearm = null;

  const sleep = (ms) => new Promise(resolve => w.setTimeout(resolve, ms));
  const mmForBrowser = (br) => br && (br.messageManager || br.frameLoader?.messageManager || null);
  const record = (name, data = {}) => {
    w[resultKey].steps.push({ name, ...data });
  };
  const fail = (message, data = {}) => {
    w[resultKey] = { ...w[resultKey], ok: false, done: true, message, ...data, finishedAt: Date.now() };
  };
  const pass = (data = {}) => {
    w[resultKey] = { ...w[resultKey], ok: true, done: true, message: "chord smoke passed", ...data, finishedAt: Date.now() };
  };
  const chordState = () => (typeof w.__ztpChordState === "function" ? w.__ztpChordState() : null);
  const viewState = () => {
    const s = chordState() || {};
    return {
      generation: s.generation || null,
      view: s.view || {},
      overlay: s.overlay || {},
      bridge: s.bridge || {},
      lastWarmRearm: w.__zenTabsPanelLastWarmRearm || null,
    };
  };

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
        const name = "ZenTabsPanel:ChordSmokeBg:" + Date.now() + ":" + Math.random();
        const timeout = w.setTimeout(() => {
          try { mm.removeMessageListener(name, handler); } catch (e) {}
          reject(new Error("background probe timed out"));
        }, 5000);
        function handler(msg) {
          w.clearTimeout(timeout);
          try { mm.removeMessageListener(name, handler); } catch (e) {}
          if (msg?.data?.ok) resolve(msg.data.value);
          else reject(new Error(msg?.data?.message || "background probe failed"));
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
      const name = "ZenTabsPanel:ChordSmokePopup:" + Date.now() + ":" + Math.random();
      const timeout = w.setTimeout(() => {
        try { mm.removeMessageListener(name, handler); } catch (e) {}
        reject(new Error("popup probe timed out"));
      }, 5000);
      function handler(msg) {
        w.clearTimeout(timeout);
        try { mm.removeMessageListener(name, handler); } catch (e) {}
        if (msg?.data?.ok) resolve(msg.data.value);
        else reject(new Error(msg?.data?.message || "popup probe failed"));
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
    });
  }

  async function waitFor(label, fn, timeoutMs = 5000, intervalMs = 50) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = await fn();
      if (last && last.ok) return last.value;
      await sleep(intervalMs);
    }
    throw new Error(label + " timed out: " + JSON.stringify(last));
  }

  async function hidePalette() {
    await runInBackground(`async (cw) => {
      await cw.browser.zenWorkspaces.hidePalette();
      return true;
    }`);
    await sleep(250);
  }

  async function armChord() {
    await runInBackground(`async (cw) => {
      await cw.browser.zenWorkspaces.armChord();
      return true;
    }`);
  }

  let keySeq = 0;
  function keyPayload(key) {
    const gen = chordState()?.generation;
    const lower = String(key);
    const isDigit = /^[0-9]$/.test(lower);
    return {
      __gen: gen,
      kind: "key",
      key: lower,
      code: isDigit ? "Digit" + lower : "Key" + lower.toUpperCase(),
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shimSeq: ++keySeq,
      shimTs: Date.now(),
    };
  }

  async function sendContentChordKey(key) {
    const tabBrowser = w.gBrowser && w.gBrowser.selectedBrowser;
    const mm = mmForBrowser(tabBrowser);
    if (!mm) throw new Error("no selected browser messageManager");
    const payload = keyPayload(key);
    const name = "ZenChord:Key:" + payload.__gen;
    const code = `(() => {
      try { sendAsyncMessage(${JSON.stringify(name)}, ${JSON.stringify(payload)}); } catch (e) {}
    })();`;
    mm.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
    await sleep(40);
  }

  async function sendPopupKey(key) {
    const payload = keyPayload(key);
    await runInPopup(`async (cw) => {
      const ev = new cw.KeyboardEvent("keydown", {
        key: ${JSON.stringify(payload.key)},
        code: ${JSON.stringify(payload.code)},
        bubbles: true,
        cancelable: true
      });
      cw.dispatchEvent(ev);
      return { defaultPrevented: ev.defaultPrevented };
    }`);
    await sleep(80);
  }

  async function forcePopupReadyVisible() {
    await runInPopup(`async (cw) => {
      const dispatch = (payload) => {
        cw.document.dispatchEvent(new cw.CustomEvent("ztt:bridge-message", {
          detail: JSON.stringify(payload)
        }));
      };
      dispatch({ type: "force-ready", data: { buffered: [], visible: true } });
      dispatch({ type: "palette-revealed" });
      return true;
    }`);
    await sleep(80);
  }

  async function firstDomain() {
    const win = await runInBackground(`async (cw) => {
      return await cw.browser.zenWorkspaces.getViewWindow("domains", 0, 1, JSON.stringify({}));
    }`);
    const row = win && Array.isArray(win.rows) ? win.rows[0] : null;
    if (!row || !row.domain) throw new Error("could not resolve first domain row");
    return row.domain;
  }

  function assertDomainState(label, domain) {
    const state = viewState();
    const params = state.view.currentViewParams || {};
    const warm = state.lastWarmRearm || {};
    const attempted = warm.attemptedPayload || {};
    const attemptedParams = attempted.params || {};
    if (state.view.currentViewName !== "domain-tabs" || params.domain !== domain) {
      throw new Error(label + " chrome state mismatch: " + JSON.stringify(state));
    }
    if (attempted.view !== "domain-tabs" || attemptedParams.domain !== domain || warm.sent !== true) {
      throw new Error(label + " WarmRearm mismatch: " + JSON.stringify(warm));
    }
    record(label, { domain, warmSent: warm.sent });
  }

  async function waitDomainState(label, domain) {
    await waitFor(label, () => {
      try {
        assertDomainState(label, domain);
        return { ok: true, value: true };
      } catch (e) {
        return { ok: false, message: String(e && e.message || e), state: viewState() };
      }
    }, 6000, 80);
  }

  async function scenarioFastDomainDrill(domain) {
    record("fast-domain-drill-start");
    await hidePalette();
    w.__zenTabsPanelWarmRearmRecords = [];
    w.__zenTabsPanelLastWarmRearm = null;
    await armChord();
    await sleep(40);
    await sendContentChordKey("q");
    await sendContentChordKey("1");
    await waitDomainState("fast-domain-drill", domain);
  }

  async function scenarioFastDomainTerminal(domain) {
    record("fast-domain-terminal-start");
    await hidePalette();
    await armChord();
    await sleep(40);
    await sendContentChordKey("q");
    await sendContentChordKey("1");
    await waitDomainState("fast-domain-terminal-drill", domain);
    await sendContentChordKey("1");
    await sleep(400);
    record("fast-domain-terminal", { state: viewState() });
  }

  async function scenarioSlowVisible(domain) {
    record("slow-visible-start");
    await hidePalette();
    await armChord();
    await waitFor("actions reveal", () => {
      const state = viewState();
      const visible = state.overlay && state.overlay.visibility !== "hidden";
      return visible ? { ok: true, value: true } : { ok: false, state };
    }, 2500, 80);
    await sendContentChordKey("q");
    await waitFor("domains visible view", () => {
      const state = viewState();
      return state.view.currentViewName === "domains" ? { ok: true, value: true } : { ok: false, state };
    }, 3000, 80);
    await sendContentChordKey("1");
    await waitDomainState("slow-visible-domain-drill", domain);
  }

  (async () => {
    try {
      record("smoke-start");
      const domain = await firstDomain();
      record("first-domain", { domain });
      await scenarioFastDomainDrill(domain);
      await scenarioFastDomainTerminal(domain);
      await scenarioSlowVisible(domain);
      pass({ domain, records: w.__zenTabsPanelWarmRearmRecords || [], finalState: viewState() });
    } catch (e) {
      fail(String(e && e.message || e), { stack: String(e && e.stack || ""), state: viewState() });
    }
  })();

  return runId;
})()
"""
    return run_eval(js)


def poll_result(timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        last = eval_json(
            "(() => JSON.stringify(Services.wm.getMostRecentWindow('navigator:browser').__ztpChordSmoke || null))()",
            timeout=10,
        )
        if isinstance(last, dict) and last.get("done"):
            return last
        time.sleep(0.5)
    raise RuntimeError(f"chord smoke timed out; last={last!r}")


def manual_input_check() -> None:
    print(
        "\nManual active-input check:\n"
        "1. Open or focus a content page with a text input.\n"
        "2. Focus the input and clear it.\n"
        "3. Type the real keyboard chord cmd+., q, 1, 1.\n"
        "4. Confirm the input value did not change.\n",
        file=sys.stderr,
    )
    answer = input("Did the focused input remain unchanged? [y/N] ").strip().lower()
    if answer not in {"y", "yes"}:
        raise RuntimeError("manual active-input check was not confirmed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manual-input", action="store_true", help="Pause for the real-keyboard active-input leak check")
    parser.add_argument("--timeout", type=float, default=45.0)
    args = parser.parse_args()

    start_smoke()
    result = poll_result(args.timeout)
    if args.manual_input:
      manual_input_check()

    compact = {
        "ok": result.get("ok"),
        "runId": result.get("runId"),
        "message": result.get("message"),
        "domain": result.get("domain"),
        "steps": result.get("steps"),
        "finalState": result.get("finalState"),
    }
    if not result.get("ok"):
        compact["stack"] = result.get("stack")
        compact["state"] = result.get("state")
    print(json.dumps(compact, indent=2))
    if not result.get("ok"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
