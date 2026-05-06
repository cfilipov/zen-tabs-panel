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
    const mods = await ext.runtime.sendMessage({ type: "check-companion-mod" });
    container.innerHTML = "";

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

      const actions = document.createElement("div");
      actions.className = "mod-actions";

      const btn = document.createElement("button");
      if (mod.installed) {
        btn.className = "btn btn-danger btn-sm";
        btn.textContent = "Remove";
      } else {
        btn.className = "btn btn-primary btn-sm";
        btn.textContent = "Install";
      }
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const type = mod.installed ? "remove-companion-mod" : "install-companion-mod";
        await ext.runtime.sendMessage({ type, modId: mod.id });
        await loadCompanionMods();
      });
      actions.appendChild(btn);

      row.appendChild(info);
      row.appendChild(actions);
      container.appendChild(row);
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
