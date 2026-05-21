#!/usr/bin/env python3
"""Generate README palette screenshots from a deterministic Zen profile.

The script creates/reuses a dedicated profile, installs the current extension
build into it, opens a fixed set of tabs, opens each README palette view, and
captures the palette panel directly through Firefox's privileged snapshot API.

Default output overwrites the screenshot PNGs referenced by README.md.
"""

from __future__ import annotations

import argparse
import json
import os
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import zipfile
import struct
import zlib
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ID = "zen-tabs-panel@c13v.com"
ZEN_BIN = Path("/Applications/Zen.app/Contents/MacOS/zen")
DEFAULT_PROFILE = Path.home() / "Library/Application Support/zen-ergozen-readme-screenshots"
DEFAULT_PORT = 6100
WORKSPACE_COUNT = 10
DEFAULT_CAPTURE_SCALE = 2
MIN_OUTPUT_WIDTH = 1200
WORKSPACE_FIXTURES = [
    ("Research", "chrome://browser/skin/zen-icons/selectable/compass.svg"),
    ("Docs", "chrome://browser/skin/zen-icons/selectable/file.svg"),
    ("Build", "chrome://browser/skin/zen-icons/selectable/code.svg"),
    ("Design", "chrome://browser/skin/zen-icons/selectable/brush.svg"),
    ("Review", "chrome://browser/skin/zen-icons/selectable/check.svg"),
    ("Planning", "chrome://browser/skin/zen-icons/selectable/calendar.svg"),
    ("Support", "chrome://browser/skin/zen-icons/selectable/chat.svg"),
    ("Archive", "chrome://browser/skin/zen-icons/selectable/folder.svg"),
    ("Playground", "chrome://browser/skin/zen-icons/selectable/sparkles.svg"),
    ("Reading", "chrome://browser/skin/zen-icons/selectable/book.svg"),
]
SEED_TABS = [
    "https://zen-browser.app/",
    "https://zen-browser.app/release-notes/",
    "https://zen-browser.app/release-notes/",
    "https://zen-browser.app/release-notes/",
    "https://zen-browser.app/release-notes/",
    "https://github.com/cfilipov/ergozen",
    "https://en.wikipedia.org/wiki/Zen_Browser",
    "https://www.mozilla.org/firefox/",
]
DUPLICATE_PROMPT_URL = "https://zen-browser.app/release-notes/"
SCREENSHOTS = [
    {
        "filename": "screenshot-actions-page-2.png",
        "view": "actions",
        "label": "ErgoZen main menu page 2",
        "wait_for": "This tab",
        "select_actions_page": "2",
    },
    {
        "filename": "screenshot.png",
        "view": "actions",
        "label": "ErgoZen main menu",
        "wait_for": "This tab",
    },
    {
        "filename": "screenshot-reorder-tabs.png",
        "view": "reorder-tabs",
        "label": "Reorder tabs menu",
        "wait_for": "Reorder",
    },
    {
        "filename": "screenshot-close-select.png",
        "view": "close-and-select",
        "label": "Close and select menu",
        "wait_for": "Close",
    },
    {
        "filename": "screenshot-tabinfo.png",
        "view": "tab-info",
        "label": "Tab info view",
        "wait_for": "TAB AGE",
    },
    {
        "filename": "screenshot-duplicate-prompt.png",
        "view": "duplicate-prompt",
        "label": "Duplicate tab prompt",
        "wait_for": "Switch to existing tab",
        "open": "duplicate-prompt-api",
    },
]


def run(cmd: list[str], *, cwd: Path = ROOT, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        message = proc.stderr.strip() or proc.stdout.strip() or f"{cmd[0]} exited {proc.returncode}"
        raise RuntimeError(message)
    return proc


def package_xpi(profile: Path, build: bool) -> Path:
    if build:
        run(["npm", "run", "build"], timeout=120)
    manifest = ROOT / "dist/manifest.json"
    if not manifest.exists():
        raise RuntimeError("dist/manifest.json is missing; run npm run build or omit --no-build")

    extensions_dir = profile / "extensions"
    extensions_dir.mkdir(parents=True, exist_ok=True)
    xpi = extensions_dir / f"{EXTENSION_ID}.xpi"
    if xpi.exists():
        xpi.unlink()
    with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted((ROOT / "dist").rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(ROOT / "dist"))
    return xpi


def ensure_profile(profile: Path) -> None:
    profile.mkdir(parents=True, exist_ok=True)
    user_js = profile / "user.js"
    prefs = {
        "xpinstall.signatures.required": "false",
        "extensions.experiments.enabled": "true",
        "extensions.autoDisableScopes": "14",
        "devtools.chrome.enabled": "true",
        "devtools.debugger.remote-enabled": "true",
        "devtools.debugger.prompt-connection": "false",
        "browser.shell.checkDefaultBrowser": "false",
        "browser.startup.homepage": '"about:blank"',
        "browser.startup.page": "0",
        "browser.startup.homepage_override.mstone": '"ignore"',
        "browser.startup.homepage_override.buildID": '"ignore"',
        "browser.aboutwelcome.enabled": "false",
        "browser.newtabpage.enabled": "false",
        "startup.homepage_welcome_url": '""',
        "startup.homepage_welcome_url.additional": '""',
        "toolkit.telemetry.reportingpolicy.firstRun": "false",
        "datareporting.policy.dataSubmissionPolicyBypassNotification": "true",
    }
    lines = [f'user_pref("{key}", {value});\n' for key, value in prefs.items()]
    user_js.write_text("".join(lines), encoding="utf-8")


def wait_for_port(port: int, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.25)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.15)
    raise RuntimeError(f"Timed out waiting for Zen debugger port {port}")


def parse_rdp_messages(buf: bytes) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    pos = 0
    while pos < len(buf):
        colon = buf.find(b":", pos)
        if colon == -1:
            break
        try:
            length = int(buf[pos:colon])
        except ValueError:
            break
        start = colon + 1
        end = start + length
        if end > len(buf):
            break
        try:
            messages.append(json.loads(buf[start:end].decode("utf-8", errors="replace")))
        except json.JSONDecodeError:
            pass
        pos = end
    return messages


class RdpClient:
    def __init__(self, port: int):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect(("127.0.0.1", port))
        self.sock.settimeout(5)
        self.console_actor = ""
        self._read_greeting()
        self._connect_console()

    def close(self) -> None:
        self.sock.close()

    def _read_greeting(self) -> None:
        buf = b""
        while True:
            buf += self.sock.recv(65536)
            colon = buf.find(b":")
            if colon <= 0:
                continue
            try:
                length = int(buf[:colon])
            except ValueError:
                continue
            if len(buf) >= colon + 1 + length:
                return

    def request(self, message: dict[str, Any], wait: float = 2.0) -> list[dict[str, Any]]:
        data = json.dumps(message).encode("utf-8")
        self.sock.sendall(str(len(data)).encode("ascii") + b":" + data)
        buf = b""
        deadline = time.monotonic() + wait + 5
        first_byte_deadline = time.monotonic() + wait
        idle_deadline: float | None = None
        while time.monotonic() < deadline:
            now = time.monotonic()
            if idle_deadline is not None and now >= idle_deadline:
                break
            timeout = 0.1
            if idle_deadline is None:
                timeout = min(timeout, max(0.0, first_byte_deadline - now))
            else:
                timeout = min(timeout, max(0.0, idle_deadline - now))
            readable, _, _ = select.select([self.sock], [], [], timeout)
            if not readable:
                if idle_deadline is None and time.monotonic() >= first_byte_deadline:
                    break
                continue
            chunk = self.sock.recv(262144)
            if not chunk:
                break
            buf += chunk
            idle_deadline = time.monotonic() + 0.25
        return parse_rdp_messages(buf)

    def _connect_console(self) -> None:
        process_actor = ""
        for reply in self.request({"to": "root", "type": "getProcess", "id": 0}, wait=1):
            process_actor = reply.get("processDescriptor", {}).get("actor", process_actor)
        if not process_actor:
            raise RuntimeError("could not get process actor")

        for reply in self.request({"to": process_actor, "type": "getTarget"}, wait=1):
            self.console_actor = reply.get("process", {}).get("consoleActor", self.console_actor)
        if not self.console_actor:
            raise RuntimeError("could not get console actor")

    def eval(self, js: str, wait: float = 3.0) -> Any:
        replies = self.request(
            {"to": self.console_actor, "type": "evaluateJSAsync", "text": js},
            wait=wait,
        )
        for reply in replies:
            if "result" in reply:
                return grip_value(reply["result"])
        for reply in replies:
            if "resultID" in reply:
                time.sleep(1)
                for later in parse_rdp_messages(self.sock.recv(262144)):
                    if "result" in later:
                        return grip_value(later["result"])
        raise RuntimeError(f"no eval result for: {js[:160]}")

    def eval_json(self, js: str, wait: float = 3.0) -> Any:
        value = self.eval(js, wait=wait)
        if isinstance(value, dict) and value.get("class") == "Promise":
            raise RuntimeError("eval returned an unresolved Promise; use eval_async_json for async chrome work")
        if isinstance(value, str):
            return json.loads(value)
        return value


def grip_value(grip: Any) -> Any:
    if isinstance(grip, dict):
        if grip.get("type") == "longString":
            return grip.get("initial", "")
        if "value" in grip:
            return grip["value"]
        return grip
    return grip


def js_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png_density(path: Path, scale: float) -> None:
    """Annotate a PNG with density metadata matching CSS-size display.

    Zen renders a CSS pixel with multiple physical pixels on retina displays.
    The pHYs chunk lets image viewers that honor PNG density display the image
    at the CSS-size point dimensions while keeping the higher-resolution pixels.
    """
    if scale <= 0:
        return
    signature = b"\x89PNG\r\n\x1a\n"
    raw = path.read_bytes()
    if not raw.startswith(signature):
        return
    pixels_per_meter = max(1, round((72 * scale) / 0.0254))
    phys = png_chunk(b"pHYs", struct.pack(">IIB", pixels_per_meter, pixels_per_meter, 1))
    out = bytearray(signature)
    pos = len(signature)
    inserted = False
    while pos + 8 <= len(raw):
        length = struct.unpack(">I", raw[pos:pos + 4])[0]
        kind = raw[pos + 4:pos + 8]
        end = pos + 12 + length
        if end > len(raw):
            return
        if kind == b"pHYs":
            pos = end
            continue
        out.extend(raw[pos:end])
        pos = end
        if kind == b"IHDR" and not inserted:
            out.extend(phys)
            inserted = True
    path.write_bytes(bytes(out))


def eval_async_json(client: RdpClient, expression: str, timeout: float = 10.0) -> Any:
    """Run an async chrome expression and poll its result.

    The DevTools console actor can return a Promise grip instead of awaiting the
    promise. Store the result on the chrome window and poll synchronously so the
    script works across Zen/Firefox builds.
    """
    key = f"__ztpReadmeScreenshotsTask_{os.getpid()}_{time.time_ns()}"
    client.eval_json(
        f"""
JSON.stringify((() => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const key = {js_json(key)};
  w[key] = {{ done: false, startedAt: Date.now() }};
  (async () => {{
    try {{
      const value = await ({expression});
      w[key] = {{ done: true, ok: true, value }};
    }} catch (e) {{
      w[key] = {{
        done: true,
        ok: false,
        message: String(e && e.message || e),
        stack: String(e && e.stack || e)
      }};
    }}
  }})();
  return {{ key }};
}})())
""",
        wait=2,
    )
    deadline = time.monotonic() + timeout
    state: Any = None
    while time.monotonic() < deadline:
        state = client.eval_json(
            f'JSON.stringify(Services.wm.getMostRecentWindow("navigator:browser")[{js_json(key)}] || {{}})',
            wait=2,
        )
        if state.get("done"):
            client.eval(f'delete Services.wm.getMostRecentWindow("navigator:browser")[{js_json(key)}]', wait=1)
            if state.get("ok"):
                return state.get("value")
            raise RuntimeError(state.get("message", "async chrome task failed"))
        time.sleep(0.1)
    raise RuntimeError(f"Timed out waiting for async chrome task; last state: {state}")


def wait_for_extension(client: RdpClient, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready = client.eval_json(
            """
JSON.stringify((() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const ext = ExtensionParent.GlobalManager.extensionMap.get("zen-tabs-panel@c13v.com");
  return { windowReady: !!w, extensionReady: !!ext, viewCount: ext ? Array.from(ext.views || []).length : 0 };
})())
""",
            wait=2,
        )
        if ready.get("windowReady") and ready.get("extensionReady"):
            return
        time.sleep(0.25)
    raise RuntimeError("Timed out waiting for ErgoZen extension to load")


def eval_background(client: RdpClient, source: str, wait: float = 8.0) -> Any:
    js = f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const {{ ExtensionParent }} = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  function getBackgroundMessageManager() {{
    const ext = ExtensionParent.GlobalManager.extensionMap.get({js_json(EXTENSION_ID)});
    const bg = Array.from(ext?.views || []).find(view => view.viewType === "background");
    return bg?.xulBrowser?.messageManager || bg?.xulBrowser?.frameLoader?.messageManager || null;
  }}
  const startedAt = Date.now();
  const mm = await new Promise((resolve, reject) => {{
    function poll() {{
      const found = getBackgroundMessageManager();
      if (found) return resolve(found);
      if (Date.now() - startedAt > 5000) return reject(new Error("no background messageManager"));
      w.setTimeout(poll, 100);
    }}
    poll();
  }});
  const reply = await new Promise((resolve, reject) => {{
    const name = "ZenTabsPanel:ReadmeScreenshots:" + Date.now() + ":" + Math.random();
    const timer = w.setTimeout(() => {{
      try {{ mm.removeMessageListener(name, handler); }} catch (e) {{}}
      reject(new Error("background probe timed out"));
    }}, 7000);
    function handler(msg) {{
      w.clearTimeout(timer);
      try {{ mm.removeMessageListener(name, handler); }} catch (e) {{}}
      resolve(msg.data);
    }}
    mm.addMessageListener(name, handler);
    const code = `(() => {{
      (async () => {{
        const cw = content.wrappedJSObject || content;
        try {{
          const value = await ({source})(cw);
          sendAsyncMessage(${{JSON.stringify(name)}}, {{ ok: true, value }});
        }} catch (e) {{
          sendAsyncMessage(${{JSON.stringify(name)}}, {{ ok: false, message: String(e && e.message || e), stack: String(e && e.stack || e) }});
        }}
      }})();
    }})();`;
    mm.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
  }});
  return reply;
}})()
"""
    reply = eval_async_json(client, js, timeout=wait)
    if not reply or not reply.get("ok"):
        raise RuntimeError(reply.get("message", "background probe failed") if isinstance(reply, dict) else str(reply))
    return reply.get("value")


def eval_popup(client: RdpClient, source: str, wait: float = 4.0) -> Any:
    js = f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const br = w.document.getElementById("zen-tabs-panel-browser");
  const mm = br?.messageManager || br?.frameLoader?.messageManager;
  if (!mm) throw new Error("no popup messageManager");
  const reply = await new Promise((resolve, reject) => {{
    const name = "ZenTabsPanel:ReadmeScreenshotsPopup:" + Date.now() + ":" + Math.random();
    const timer = w.setTimeout(() => {{
      try {{ mm.removeMessageListener(name, handler); }} catch (e) {{}}
      reject(new Error("popup probe timed out"));
    }}, {max(1000, int(wait * 1000) - 500)});
    function handler(msg) {{
      w.clearTimeout(timer);
      try {{ mm.removeMessageListener(name, handler); }} catch (e) {{}}
      resolve(msg.data);
    }}
    mm.addMessageListener(name, handler);
    const code = `(() => {{
      try {{
        const value = ({source})(content);
        sendAsyncMessage(${{JSON.stringify(name)}}, {{ ok: true, value }});
      }} catch (e) {{
        sendAsyncMessage(${{JSON.stringify(name)}}, {{ ok: false, message: String(e && e.message || e), stack: String(e && e.stack || e) }});
      }}
    }})();`;
    mm.loadFrameScript("data:application/javascript," + encodeURIComponent(code), false);
  }});
  return reply;
}})()
"""
    reply = eval_async_json(client, js, timeout=wait)
    if not reply or not reply.get("ok"):
        raise RuntimeError(reply.get("message", "popup probe failed") if isinstance(reply, dict) else str(reply))
    return reply.get("value")


def suppress_start_pages(client: RdpClient) -> None:
    """Keep the screenshot/debug profile out of first-run welcome screens."""
    eval_background(
        client,
        """async (cw) => {
          await cw.browser.storage.local.set({ welcomed: true });
          return true;
        }""",
        wait=4,
    )
    eval_async_json(
        client,
        f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const fixtureUrls = new Set({js_json(SEED_TABS)});
  const isStartPage = (url) => {{
    if (!url) return true;
    if (fixtureUrls.has(url)) return false;
    return (
      url === "about:blank" ||
      url === "about:home" ||
      url === "about:newtab" ||
      url === "about:welcome" ||
      url.includes("/welcome/welcome.html") ||
      /(?:zen|browser).*welcome|welcome.*(?:zen|browser)|first[-_ ]?run|getting[-_ ]?started/i.test(url)
    );
  }};
  for (const tab of [...w.gBrowser.tabs]) {{
    const url = tab.linkedBrowser?.currentURI?.spec || "";
    if (isStartPage(url) && w.gBrowser.tabs.length > 1) {{
      try {{ w.gBrowser.removeTab(tab, {{ animate: false, closeWindowWithLastTab: false }}); }} catch (e) {{}}
    }}
  }}
  return {{ tabCount: w.gBrowser.tabs.length, selected: w.gBrowser.selectedBrowser.currentURI.spec }};
}})()
""",
        timeout=6,
    )


def seed_tabs(client: RdpClient, urls: list[str]) -> None:
    eval_async_json(
        client,
        f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  w.moveTo(80, 60);
  w.resizeTo(1280, 900);
  const principal = Services.scriptSecurityManager.getSystemPrincipal();
  const urls = {js_json(urls)};
  const fixtureTabs = new Set();
  const first = w.gBrowser.addTab(urls[0], {{ triggeringPrincipal: principal, inBackground: false }});
  fixtureTabs.add(first);
  w.gBrowser.selectedTab = first;
  for (const tab of [...w.gBrowser.tabs]) {{
    if (!fixtureTabs.has(tab)) {{
      try {{ w.gBrowser.removeTab(tab, {{ animate: false, closeWindowWithLastTab: false }}); }} catch (e) {{}}
    }}
  }}
  for (const url of urls.slice(1)) {{
    fixtureTabs.add(w.gBrowser.addTab(url, {{ triggeringPrincipal: principal, inBackground: true }}));
  }}
  await new Promise(resolve => w.setTimeout(resolve, 2500));
  const fixtureUrls = new Set(urls);
  for (const tab of [...w.gBrowser.tabs]) {{
    const url = tab.linkedBrowser?.currentURI?.spec || "";
    if (!fixtureTabs.has(tab) && !fixtureUrls.has(url)) {{
      try {{ w.gBrowser.removeTab(tab, {{ animate: false, closeWindowWithLastTab: false }}); }} catch (e) {{}}
    }}
  }}
  w.gBrowser.selectedTab = first;
  return {{ tabCount: w.gBrowser.tabs.length, selected: w.gBrowser.selectedBrowser.currentURI.spec }};
}})()
""",
        timeout=8,
    )


def ensure_workspaces(client: RdpClient, count: int) -> None:
    result = eval_async_json(
        client,
        f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const zen = w.gZenWorkspaces;
  if (!zen || typeof zen.getWorkspaces !== "function") throw new Error("gZenWorkspaces unavailable");
  if (typeof zen.createAndSaveWorkspace !== "function") throw new Error("gZenWorkspaces.createAndSaveWorkspace unavailable");
  const fixtures = {js_json(WORKSPACE_FIXTURES)};
  let workspaces = Array.from(zen.getWorkspaces() || []);
  let created = [];
  for (const [name, icon] of fixtures) {{
    workspaces = Array.from(zen.getWorkspaces() || []);
    if (workspaces.length >= {int(count)}) break;
    if (workspaces.some(ws => ws?.name === name)) continue;
    const workspace = await zen.createAndSaveWorkspace(name, icon, false, 0);
    if (workspace?.name) created.push(workspace.name);
    await new Promise(resolve => w.setTimeout(resolve, 120));
  }}
  workspaces = Array.from(zen.getWorkspaces() || []);
  if (workspaces.length < {int(count)}) {{
    throw new Error("only created " + workspaces.length + " workspaces; wanted {int(count)}");
  }}
  try {{
    const first = workspaces[0];
    if (first?.uuid && zen.activeWorkspace !== first.uuid) await zen.changeWorkspaceWithID(first.uuid);
  }} catch (e) {{}}
  await new Promise(resolve => w.setTimeout(resolve, 300));
  return {{ count: workspaces.length, created }};
}})()
""",
        timeout=30,
    )
    print(f"Workspace fixtures ready: {result['count']} workspaces", flush=True)


def force_theme(client: RdpClient, theme: str) -> None:
    if theme not in {"light", "dark"}:
        raise RuntimeError(f"unsupported theme: {theme}")
    client.eval_json(
        f"""
JSON.stringify((() => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const root = w.document.documentElement;
  root.style.colorScheme = {js_json(theme)};
  root.setAttribute("zen-should-be-dark-mode", {js_json("true" if theme == "dark" else "false")});
  return {{ theme: w.getComputedStyle(root).colorScheme }};
}})())
""",
        wait=2,
    )


def open_view(client: RdpClient, view: str, params: dict[str, Any] | None = None) -> None:
    eval_background(
        client,
        f"""async (cw) => {{
          await cw.browser.zenWorkspaces.hidePalette().catch(() => {{}});
          await new Promise(resolve => cw.setTimeout(resolve, 450));
          await cw.browser.zenWorkspaces.showPalette({{ view: {js_json(view)}, params: {js_json(params or {})}, skipChord: true }});
          await new Promise(resolve => cw.setTimeout(resolve, 900));
          return true;
        }}""",
    )


def open_duplicate_prompt_view(client: RdpClient) -> dict[str, Any]:
    eval_async_json(
        client,
        f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const targetUrl = {js_json(DUPLICATE_PROMPT_URL)};
  const matching = [...w.gBrowser.tabs].filter(tab => tab.linkedBrowser?.currentURI?.spec === targetUrl);
  if (matching.length < 2) throw new Error("duplicate prompt fixture needs at least two open tabs for " + targetUrl);
  return {{ count: matching.length }};
}})()
""",
        timeout=5,
    )
    return eval_background(
        client,
        f"""async (cw) => {{
          await cw.browser.zenWorkspaces.hidePalette().catch(() => {{}});
          await new Promise(resolve => cw.setTimeout(resolve, 450));
          const domId = await cw.browser.zenWorkspaces.showDuplicatePrompt({js_json(DUPLICATE_PROMPT_URL)}, null, false);
          if (!domId) throw new Error("showDuplicatePrompt did not find an existing tab for {DUPLICATE_PROMPT_URL}");
          await new Promise(resolve => cw.setTimeout(resolve, 900));
          return {{ domId }};
        }}""",
        wait=8,
    )


def press_popup_key(client: RdpClient, key: str, code: str) -> None:
    eval_popup(
        client,
        f"""(content) => {{
    const event = new content.KeyboardEvent("keydown", {{
      key: {js_json(key)},
      code: {js_json(code)},
      bubbles: true,
      cancelable: true
    }});
    content.window.dispatchEvent(event);
    return {{ defaultPrevented: event.defaultPrevented }};
  }}""",
        wait=8,
    )
    time.sleep(1.1)


def wait_for_actions_page(client: RdpClient, page: str, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = eval_popup(
                client,
                """(content) => ({
    activePage: content.document.querySelector("#page-indicator .page-dot.active")?.getAttribute("data-page") || null,
    pagerTransform: content.getComputedStyle(content.document.querySelector(".actions-pager")).transform,
    pageLeft: (() => {
      const page = content.document.querySelector("#page-indicator .page-dot.active")?.getAttribute("data-page") || "1";
      return content.document.querySelector('.actions-page[data-page="' + page + '"]')?.getBoundingClientRect().left || null;
    })()
  })""",
                wait=3,
            )
        except RuntimeError:
            last = None
        if last and last.get("activePage") == page and abs(float(last.get("pageLeft") or 999)) < 30:
            return
        time.sleep(0.2)
    raise RuntimeError(f"Timed out waiting for actions page {page}; last state: {last}")


def select_actions_page(client: RdpClient, page: str) -> None:
    if page == "2":
        press_popup_key(client, " ", "Space")
    else:
        raise RuntimeError(f"unsupported actions page selection: {page}")
    wait_for_actions_page(client, page)


def target_params(client: RdpClient, target: dict[str, Any]) -> dict[str, Any]:
    return dict(target.get("params") or {})


def open_screenshot_target(client: RdpClient, target: dict[str, Any]) -> None:
    if target.get("open") == "duplicate-prompt-api":
        open_duplicate_prompt_view(client)
    else:
        view = str(target["view"])
        open_view(client, view, target_params(client, target))

    expected = target.get("wait_for")
    if expected:
        wait_for_popup_text(client, str(expected))

    actions_page = target.get("select_actions_page")
    if actions_page:
        print(f"  selecting actions page {actions_page}", flush=True)
        select_actions_page(client, str(actions_page))

    wait_for_capture_box(client)


def wait_for_popup_text(client: RdpClient, needle: str, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        state = popup_state(client)
        last = state.get("text", "")
        if needle in last:
            return
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for popup text {needle!r}; last text: {last[:200]!r}")


def popup_state(client: RdpClient) -> dict[str, Any]:
    try:
        return eval_popup(
            client,
            """(content) => ({
    text: content.document.body ? content.document.body.innerText : "",
    title: content.document.getElementById("view-title")?.textContent || "",
    readyState: content.document.readyState
  })""",
            wait=3,
        )
    except RuntimeError:
        return {"text": "", "title": "", "readyState": ""}


def capture_box(client: RdpClient) -> dict[str, Any]:
    return client.eval_json(
        """
JSON.stringify((() => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const panel = w.document.getElementById("zen-tabs-panel-panel");
  const br = w.document.getElementById("zen-tabs-panel-browser");
  if (!panel || !br) return { ready: false };
  const panelRect = panel.getBoundingClientRect();
  const brRect = br.getBoundingClientRect();
  const width = parseFloat(br.style.width || "") || brRect.width || panelRect.width;
  const height = parseFloat(br.style.height || "") || brRect.height || panelRect.height;
  return {
    ready: !!width && !!height,
    width: Math.round(width),
    height: Math.round(height),
    panelWidth: Math.round(panelRect.width),
    panelHeight: Math.round(panelRect.height),
    view: panel.dataset.view || "",
    opacity: w.getComputedStyle(panel).opacity,
  };
})())
""",
        wait=2,
    )


def wait_for_capture_box(client: RdpClient, timeout: float = 6.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    stable_count = 0
    stable_key: tuple[int, int, str] | None = None
    while time.monotonic() < deadline:
        last = capture_box(client)
        if last.get("ready"):
            key = (int(last.get("width") or 0), int(last.get("height") or 0), str(last.get("view") or ""))
            if key == stable_key:
                stable_count += 1
            else:
                stable_key = key
                stable_count = 1
            if stable_count >= 3:
                return last
        time.sleep(0.12)
    raise RuntimeError(f"Timed out waiting for stable screenshot capture box; last state: {last}")


def capture_palette(client: RdpClient, output: Path, capture_scale: float) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(1, 4):
        try:
            return eval_async_json(
                client,
                f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const panel = w.document.getElementById("zen-tabs-panel-panel");
  const br = w.document.getElementById("zen-tabs-panel-browser");
  if (!panel || !br) throw new Error("palette panel is not open");
  await new Promise(resolve => w.setTimeout(resolve, 120));
  const withTimeout = (promise, label, ms = 12000) => Promise.race([
    promise,
    new Promise((_, reject) => w.setTimeout(() => reject(new Error(label + " timed out")), ms))
  ]);
  const brRect = br.getBoundingClientRect();
  const width = parseFloat(br.style.width || "") || brRect.width || panel.getBoundingClientRect().width;
  const height = parseFloat(br.style.height || "") || brRect.height || panel.getBoundingClientRect().height;
  if (!width || !height) throw new Error("palette browser has no capture size");
  const scale = Math.max(1, {float(capture_scale)});
  const popupGlobal = br.browsingContext?.currentWindowGlobal;
  if (!popupGlobal) throw new Error("popup WindowGlobal unavailable");
  const snapshot = await withTimeout(popupGlobal.drawSnapshot(
    new w.DOMRect(0, 0, width, height),
    scale,
    "transparent"
  ), "drawSnapshot");
  const canvas = w.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = Math.max(2, snapshot.width || Math.round(width * scale));
  canvas.height = Math.max(2, snapshot.height || Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(snapshot, 0, 0);
  const blob = await withTimeout(new Promise(resolve => canvas.toBlob(resolve, "image/png")), "canvas.toBlob");
  if (!blob) throw new Error("canvas.toBlob returned null");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const IOUtils = w.IOUtils || ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils;
  await IOUtils.write({js_json(str(output))}, bytes);
  return {{
    path: {js_json(str(output))},
    width: canvas.width,
    height: canvas.height,
    cssWidth: width,
    cssHeight: height,
    snapshotWidth: snapshot.width || null,
    snapshotHeight: snapshot.height || null,
    scale
  }};
}})()
""",
                timeout=18,
            )
        except RuntimeError as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(1.0)
    raise RuntimeError(str(last_error) if last_error else "capture failed")


def combine_diagonal(client: RdpClient, dark: Path, light: Path, output: Path, output_scale: float) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    return eval_async_json(
        client,
        f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const IOUtils = w.IOUtils || ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils;
  async function bitmap(path) {{
    const bytes = await IOUtils.read(path);
    const blob = new w.Blob([bytes], {{ type: "image/png" }});
    return await w.createImageBitmap(blob);
  }}
  const dark = await bitmap({js_json(str(dark))});
  const light = await bitmap({js_json(str(light))});
  const sourceWidth = Math.min(dark.width, light.width);
  const sourceHeight = Math.min(dark.height, light.height);
  const outputScale = Math.max(0.25, Math.min(1, {float(output_scale)}));
  const width = Math.max(2, Math.round(sourceWidth * outputScale));
  const height = Math.max(2, Math.round(sourceHeight * outputScale));
  const canvas = w.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(light, 0, 0, width, height);

  const topX = Math.round(width * 0.58);
  const bottomX = Math.round(width * 0.42);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(topX, 0);
  ctx.lineTo(bottomX, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(dark, 0, 0, width, height);
  ctx.restore();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("combined canvas.toBlob returned null");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await IOUtils.write({js_json(str(output))}, bytes);
  return {{ path: {js_json(str(output))}, width, height, sourceWidth, sourceHeight, outputScale }};
}})()
""",
        timeout=20,
    )


def normalize_output_canvas(client: RdpClient, path: Path, min_width: int) -> dict[str, Any] | None:
    """Pad narrow screenshots so image viewers use the same effective zoom.

    The panel itself is not scaled. We extend the left/right edge pixels into
    gutters so compact views keep their rendered text size while QuickLook sees
    a canvas width comparable to the other README screenshots.
    """
    if min_width <= 0:
        return None
    return eval_async_json(
        client,
        f"""
(async () => {{
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const IOUtils = w.IOUtils || ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils;
  const path = {js_json(str(path))};
  const bytes = await IOUtils.read(path);
  const blob = new w.Blob([bytes], {{ type: "image/png" }});
  const image = await w.createImageBitmap(blob);
  const minWidth = Math.max(0, {int(min_width)});
  if (image.width >= minWidth) {{
    return {{ path, width: image.width, height: image.height, padded: false }};
  }}
  const canvas = w.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = minWidth;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const left = Math.floor((minWidth - image.width) / 2);
  const right = minWidth - image.width - left;
  if (left > 0) ctx.drawImage(image, 0, 0, 1, image.height, 0, 0, left, image.height);
  if (right > 0) ctx.drawImage(image, image.width - 1, 0, 1, image.height, left + image.width, 0, right, image.height);
  ctx.drawImage(image, left, 0);
  const out = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!out) throw new Error("normalize canvas.toBlob returned null");
  await IOUtils.write(path, new Uint8Array(await out.arrayBuffer()));
  return {{ path, width: canvas.width, height: canvas.height, padded: true, sourceWidth: image.width, sourceHeight: image.height }};
}})()
""",
        timeout=20,
    )


def launch_zen(profile: Path, port: int) -> subprocess.Popen[str]:
    if not ZEN_BIN.exists():
        raise RuntimeError(f"Zen binary not found at {ZEN_BIN}")
    return subprocess.Popen(
        [
            str(ZEN_BIN),
            "-no-remote",
            "-profile",
            str(profile),
            "--start-debugger-server",
            str(port),
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )


def generate(args: argparse.Namespace) -> None:
    profile = Path(args.profile).expanduser().resolve()
    output_dir = Path(args.output_dir).resolve()
    theme_mode = "split" if args.theme in {"split", "both"} else args.theme
    if args.reset_profile and profile.exists():
        shutil.rmtree(profile)
    ensure_profile(profile)
    xpi = package_xpi(profile, build=not args.no_build)
    print(f"Using screenshot profile: {profile}", flush=True)
    print(f"Installed extension package: {xpi}", flush=True)

    process = launch_zen(profile, args.port)
    client: RdpClient | None = None
    try:
        wait_for_port(args.port)
        client = RdpClient(args.port)
        wait_for_extension(client)
        suppress_start_pages(client)
        ensure_workspaces(client, args.workspace_count)
        seed_tabs(client, args.tabs)

        with tempfile.TemporaryDirectory(prefix="ergozen-readme-screenshots-") as tmp:
            variant_dir = Path(tmp)
            for target in SCREENSHOTS:
                filename = str(target["filename"])
                label = str(target["label"])
                print(f"Capturing {filename} ({label})", flush=True)
                output_path = output_dir / filename

                if theme_mode in {"dark", "light"}:
                    print(f"  {theme_mode} variant", flush=True)
                    force_theme(client, theme_mode)
                    open_screenshot_target(client, target)
                    meta = capture_palette(client, output_path, args.capture_scale)
                    density_scale = args.capture_scale
                else:
                    dark_path = variant_dir / ("dark-" + filename)
                    light_path = variant_dir / ("light-" + filename)
                    for theme, path in (("dark", dark_path), ("light", light_path)):
                        print(f"  {theme} variant", flush=True)
                        force_theme(client, theme)
                        open_screenshot_target(client, target)
                        capture_palette(client, path, args.capture_scale)
                    output_scale = 1 if args.output_scale is None else args.output_scale
                    meta = combine_diagonal(client, dark_path, light_path, output_path, output_scale)
                    density_scale = args.capture_scale * output_scale

                if args.write_density:
                    write_png_density(output_path, density_scale)
                normalized = normalize_output_canvas(client, output_path, args.min_output_width)
                if normalized and normalized.get("padded") and args.write_density:
                    write_png_density(output_path, density_scale)
                    meta = { **meta, "width": normalized["width"], "height": normalized["height"] }
                print(f"  wrote {meta['path']} ({meta['width']}x{meta['height']})", flush=True)

        eval_background(
            client,
            "async (cw) => { await cw.browser.zenWorkspaces.hidePalette().catch(() => {}); return true; }",
            wait=4,
        )
    finally:
        if client:
            client.close()
        if not args.keep_open:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default=str(DEFAULT_PROFILE), help="Dedicated Zen profile directory to create/reuse")
    parser.add_argument("--output-dir", default=str(ROOT), help="Directory for README screenshot PNGs")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Remote debugger port for the screenshot Zen instance")
    parser.add_argument("--reset-profile", action="store_true", help="Delete and recreate the screenshot profile before running")
    parser.add_argument("--no-build", action="store_true", help="Do not run npm run build before packaging dist/")
    parser.add_argument("--keep-open", action="store_true", help="Leave the screenshot Zen instance open after capture")
    parser.add_argument("--workspace-count", type=int, default=WORKSPACE_COUNT, help="Minimum number of workspaces in the screenshot profile")
    parser.add_argument("--capture-scale", type=float, default=DEFAULT_CAPTURE_SCALE, help="Snapshot scale before compositing; defaults to 2 for retina-sharp pixels")
    parser.add_argument("--output-scale", type=float, default=None, help="Final composite scale after capture; defaults to 1")
    parser.add_argument("--min-output-width", type=int, default=MIN_OUTPUT_WIDTH, help="Pad narrower PNGs to this width without scaling panel content; defaults to 1200")
    parser.add_argument("--theme", choices=["split", "both", "light", "dark"], default="split", help="Capture theme mode: split/both combines dark left + light right; light or dark captures one theme only")
    parser.add_argument("--no-density", action="store_false", dest="write_density", help="Do not write PNG density metadata")
    parser.add_argument("--tab", action="append", dest="tabs", help="Seed tab URL; repeat to override the default tab set")
    args = parser.parse_args(argv)
    if not args.tabs:
        args.tabs = SEED_TABS
    return args


if __name__ == "__main__":
    try:
        generate(parse_args(sys.argv[1:]))
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
