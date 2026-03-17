"use strict";

const DEFAULTS = {
  autoCloseEnabled: false,
  autoCloseThreshold: "48h",
  autoMoveEnabled: false,
  autoMoveDelay: 3000,
};

const els = {
  autoCloseEnabled: document.getElementById("autoCloseEnabled"),
  autoCloseThreshold: document.getElementById("autoCloseThreshold"),
  autoMoveEnabled: document.getElementById("autoMoveEnabled"),
  autoMoveDelay: document.getElementById("autoMoveDelay"),
  status: document.getElementById("status"),
  companionMods: document.getElementById("companion-mods"),
};

async function loadSettings() {
  const settings = await browser.storage.local.get(DEFAULTS);
  els.autoCloseEnabled.checked = settings.autoCloseEnabled;
  els.autoCloseThreshold.value = settings.autoCloseThreshold;
  els.autoMoveEnabled.checked = settings.autoMoveEnabled;
  els.autoMoveDelay.value = String(settings.autoMoveDelay);
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

// -----------------------------------------------------------------------
// Companion mods management
// -----------------------------------------------------------------------

async function loadCompanionMods() {
  try {
    const mods = await browser.runtime.sendMessage({ type: "check-companion-mod" });
    els.companionMods.innerHTML = "";

    for (const mod of mods) {
      const row = document.createElement("div");
      row.className = "mod-row";

      const info = document.createElement("div");
      info.className = "mod-info";

      const name = document.createElement("div");
      name.className = "mod-name";
      name.textContent = mod.name;

      const desc = document.createElement("div");
      desc.className = "mod-description";
      desc.textContent = mod.description;

      info.appendChild(name);
      info.appendChild(desc);

      const btn = document.createElement("button");
      btn.className = mod.installed ? "btn btn-danger" : "btn";
      btn.textContent = mod.installed ? "Remove" : "Install";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const type = mod.installed ? "remove-companion-mod" : "install-companion-mod";
        await browser.runtime.sendMessage({ type, modId: mod.id });
        await loadCompanionMods();
      });

      row.appendChild(info);
      row.appendChild(btn);
      els.companionMods.appendChild(row);
    }
  } catch (e) {
    els.companionMods.innerHTML = `<div class="mod-error">Unable to load companion mods</div>`;
  }
}

// -----------------------------------------------------------------------
// Settings save
// -----------------------------------------------------------------------

async function saveSettings() {
  await browser.storage.local.set({
    autoCloseEnabled: els.autoCloseEnabled.checked,
    autoCloseThreshold: els.autoCloseThreshold.value,
    autoMoveEnabled: els.autoMoveEnabled.checked,
    autoMoveDelay: Number(els.autoMoveDelay.value),
  });

  els.status.classList.remove("hidden");
  setTimeout(() => els.status.classList.add("hidden"), 1500);
}

// Auto-save on any change
for (const el of Object.values(els)) {
  if (el && (el.tagName === "INPUT" || el.tagName === "SELECT")) {
    el.addEventListener("change", saveSettings);
  }
}

loadSettings();
loadShortcuts();
loadCompanionMods();