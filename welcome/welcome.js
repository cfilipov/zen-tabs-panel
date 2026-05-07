"use strict";

const ext = typeof browser !== "undefined" ? browser : chrome;

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

loadShortcut();
loadCompanionMods();
