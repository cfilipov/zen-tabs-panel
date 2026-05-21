"use strict";

const ext = typeof browser !== "undefined" ? browser : chrome;
const params = new URLSearchParams(location.search);

function configurePageMode() {
  if (params.get("mode") !== "update") return;

  document.querySelector("h1").textContent = "ErgoZen updated";
  document.querySelector(".intro").textContent = "A new version of ErgoZen is installed.";

  if (params.get("restart") === "1") {
    const notice = document.getElementById("restart-notice");
    if (notice) notice.hidden = false;
  }
}

async function loadShortcut() {
  try {
    const commands = await ext.commands.getAll();
    const palette = commands.find((c) => c.name === "open-palette");
    if (palette?.shortcut) {
      document.getElementById("shortcut").textContent = palette.shortcut;
    }
  } catch (e) {}
}

async function loadCompanionMods() {
  const container = document.getElementById("companion-mods");
  try {
    const mods = await sendMessageWithReply(MSG.CHECK_COMPANION_MOD);
    container.innerHTML = "";
    for (const mod of mods) {
      container.appendChild(buildModRow(mod, {
        showUpdate: false,
        installClass: "btn btn-primary btn-sm",
        removeClass: "btn btn-danger btn-sm",
        onChange: loadCompanionMods,
      }));
    }
  } catch (e) {
    container.innerHTML = `<div class="mod-error">Unable to load companion mods</div>`;
  }
}

document.getElementById("get-started").addEventListener("click", () => {
  window.close();
});

document.getElementById("open-settings").addEventListener("click", () => {
  ext.runtime.openOptionsPage();
});

document.getElementById("restart-zen").addEventListener("click", async () => {
  const button = document.getElementById("restart-zen");
  const status = document.getElementById("restart-status");
  button.disabled = true;
  status.textContent = "Restarting...";
  try {
    await sendMessageWithReply(MSG.RESTART_ZEN);
  } catch (e) {
    button.disabled = false;
    status.textContent = "Restart failed. Quit Zen and reopen it to finish clearing old keyboard handlers.";
  }
});

configurePageMode();
loadShortcut();
loadCompanionMods();
