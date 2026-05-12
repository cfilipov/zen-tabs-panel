"use strict";

const els = {
  autoCloseEnabled: document.getElementById("autoCloseEnabled"),
  autoCloseThreshold: document.getElementById("autoCloseThreshold"),
  autoMoveEnabled: document.getElementById("autoMoveEnabled"),
  autoMoveDelay: document.getElementById("autoMoveDelay"),
  interceptExtensionPopups: document.getElementById("interceptExtensionPopups"),
  status: document.getElementById("status"),
  companionMods: document.getElementById("companion-mods"),
};

async function loadSettings() {
  const settings = await browser.storage.local.get(STORAGE_DEFAULTS);
  els.autoCloseEnabled.checked = settings.autoCloseEnabled;
  els.autoCloseThreshold.value = settings.autoCloseThreshold;
  els.autoMoveEnabled.checked = settings.autoMoveEnabled;
  els.autoMoveDelay.value = String(settings.autoMoveDelay);
  els.interceptExtensionPopups.checked = settings.interceptExtensionPopups;
}

async function loadShortcuts() {
  const commands = await browser.commands.getAll();
  const list = document.getElementById("shortcut-list");
  list.innerHTML = "";

  for (const cmd of commands) {
    const row = document.createElement("div");
    row.className = "shortcut-row";

    const label = document.createElement("span");
    label.textContent = cmd.description || cmd.name;

    const kbd = document.createElement("kbd");
    kbd.textContent = cmd.shortcut || "Not set";
    if (!cmd.shortcut) kbd.classList.add("unset");

    row.appendChild(label);
    row.appendChild(kbd);
    list.appendChild(row);
  }
}

async function loadCompanionMods() {
  try {
    const mods = await sendMessageWithReply(MSG.CHECK_COMPANION_MOD);
    els.companionMods.innerHTML = "";
    for (const mod of mods) {
      els.companionMods.appendChild(buildModRow(mod, {
        showUpdate: true,
        onChange: loadCompanionMods,
      }));
    }
  } catch (e) {
    els.companionMods.innerHTML = `<div class="mod-error">Unable to load companion mods</div>`;
  }
}

async function saveSettings() {
  await browser.storage.local.set({
    autoCloseEnabled: els.autoCloseEnabled.checked,
    autoCloseThreshold: els.autoCloseThreshold.value,
    autoMoveEnabled: els.autoMoveEnabled.checked,
    autoMoveDelay: Number(els.autoMoveDelay.value),
    interceptExtensionPopups: els.interceptExtensionPopups.checked,
  });

  els.status.classList.remove("hidden");
  setTimeout(() => els.status.classList.add("hidden"), 1500);
}

for (const el of Object.values(els)) {
  if (el && (el.tagName === "INPUT" || el.tagName === "SELECT")) {
    el.addEventListener("change", saveSettings);
  }
}

loadSettings();
loadShortcuts();
loadCompanionMods();
