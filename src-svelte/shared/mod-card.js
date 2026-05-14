"use strict";

// Companion-mod card builder shared by options/options.js and
// welcome/welcome.js. Pages differ only in button styling and whether
// they render the "update available" badge + button.
//
// Loaded as <script src="../shared/mod-card.js"> from each HTML page,
// after dom-utils.js, constants.js, and messaging.js.
//
// Pages call `buildModRow(mod, opts)` and append the returned element to
// their container; `opts.onChange` is invoked after install/remove/update
// completes so the page can re-render the list.

(function () {
  const ext = typeof browser !== "undefined" ? browser : chrome;

  function makeButton(label, className, onClick) {
    const btn = document.createElement("button");
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await onClick();
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  this.buildModRow = function (mod, opts) {
    const o = opts || {};
    const installClass = o.installClass || "btn";
    const removeClass  = o.removeClass  || "btn btn-danger";
    const updateClass  = o.updateClass  || "btn";
    const showUpdate   = !!o.showUpdate;
    const onChange     = o.onChange || (() => {});

    const hasUpdate = mod.installed && mod.installedVersion !== mod.latestVersion;

    const row = document.createElement("div");
    row.className = "mod-row";

    const info = document.createElement("div");
    info.className = "mod-info";

    const nameRow = document.createElement("div");
    nameRow.className = "mod-name-row";

    const name = document.createElement("span");
    name.className = "mod-name";
    name.textContent = mod.name;
    nameRow.appendChild(name);

    if (showUpdate && hasUpdate) {
      const badge = document.createElement("span");
      badge.className = "mod-update-badge";
      badge.textContent = "Update available";
      nameRow.appendChild(badge);
    }

    const desc = document.createElement("div");
    desc.className = "mod-description";
    desc.textContent = mod.description;

    info.appendChild(nameRow);
    info.appendChild(desc);

    const actions = document.createElement("div");
    actions.className = "mod-actions";

    if (showUpdate && hasUpdate) {
      actions.appendChild(makeButton("Update", updateClass, async () => {
        await ext.runtime.sendMessage({ type: MSG.INSTALL_COMPANION_MOD, modId: mod.id });
        await onChange();
      }));
    }

    if (mod.installed) {
      actions.appendChild(makeButton("Remove", removeClass, async () => {
        await ext.runtime.sendMessage({ type: MSG.REMOVE_COMPANION_MOD, modId: mod.id });
        await onChange();
      }));
    } else {
      actions.appendChild(makeButton("Install", installClass, async () => {
        await ext.runtime.sendMessage({ type: MSG.INSTALL_COMPANION_MOD, modId: mod.id });
        await onChange();
      }));
    }

    row.appendChild(info);
    row.appendChild(actions);
    return row;
  };
}).call(this);
