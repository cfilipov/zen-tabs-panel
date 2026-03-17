/* globals ExtensionAPI, Services */
"use strict";

this.zenWorkspaces = class extends ExtensionAPI {
  getAPI(context) {

    // -----------------------------------------------------------------------
    // Companion Zen Mods
    // -----------------------------------------------------------------------

    const COMPANION_MODS = {
      "zen-tabs-panel-unread-indicator": {
        name: "Unread Tab Indicator",
        description: "Blue dot on tabs opened in the background that you haven't visited yet.",
        version: "1.0.0",
        css: `
.tabbrowser-tab[unread="true"] .tab-content {
  position: relative !important;
}
.tabbrowser-tab[unread="true"] .tab-content::after {
  content: "" !important;
  position: absolute !important;
  top: 50% !important;
  right: 4px !important;
  transform: translateY(-50%) !important;
  width: 8px !important;
  height: 8px !important;
  border-radius: 50% !important;
  background: #3b82f6 !important;
  border: 1.5px solid rgba(0, 0, 0, 0.3) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
  z-index: 9999 !important;
  pointer-events: none !important;
}
.tabbrowser-tab[unread="true"]:hover .tab-content::after {
  display: none !important;
}`,
      },
      "zen-tabs-panel-dim-unloaded": {
        name: "Dim Unloaded Tabs",
        description: "Grayscale and fade tabs that have been unloaded from memory.",
        version: "1.0.0",
        css: `
.tabbrowser-tab[pending="true"] .tab-icon-stack {
  filter: grayscale(1) !important;
  opacity: 0.5 !important;
}
.tabbrowser-tab[pending="true"] .tab-label-container {
  filter: grayscale(1) !important;
  opacity: 0.5 !important;
}`,
      },
      "zen-tabs-panel-corner-fix": {
        name: "Corner Bleed Fix",
        description: "Fixes white corners bleeding through on pages with light backgrounds. May have a minor performance impact on lower-end hardware.",
        version: "1.0.0",
        css: `
html:not([sizemode="fullscreen"]) .browserStack,
html:not([sizemode="fullscreen"]) .browserStack > browser {
  clip-path: inset(0 round var(--zen-native-inner-radius)) !important;
}`,
      },
      "zen-tabs-panel-split-header-hover": {
        name: "Split View Header on Hover",
        description: "Hides the split view toolbar until you hover near the top edge of the pane.",
        version: "1.0.0",
        css: `
.browserSidebarContainer .zen-view-splitter-header-container {
  opacity: 0 !important;
  transition: opacity 0.15s !important;
}
.zen-view-splitter-header-container:hover {
  opacity: 1 !important;
}`,
      },
    };

    // Clean up on extension unload
    context.callOnClose({
      close() {
        const w = Services.wm.getMostRecentWindow("navigator:browser");
        if (!w) return;
        const overlay = w.document.getElementById("zen-tabs-panel-overlay");
        if (overlay) overlay.remove();
      },
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function getWin() {
      return Services.wm.getMostRecentWindow("navigator:browser");
    }

    function findTabByDomId(domId) {
      const w = getWin();
      if (!w) return null;
      return w.document.getElementById(domId);
    }

    function getExtTabId(nativeTab) {
      try {
        return context.extension.tabManager.getWrapper(nativeTab)?.id ?? null;
      } catch (e) {
        return null;
      }
    }

    // Get all tab elements across all workspaces from the DOM
    function getAllTabElements() {
      const w = getWin();
      if (!w || !w.document) return [];
      return Array.from(w.document.querySelectorAll(".tabbrowser-tab"));
    }

    // Activate a native tab, switching workspaces if needed
    async function activateNativeTab(tab) {
      const w = getWin();
      if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

      const tabWorkspace = tab.getAttribute("zen-workspace-id") || null;
      const activeWorkspace = w.gZenWorkspaces.activeWorkspace;

      if (tabWorkspace && tabWorkspace !== activeWorkspace) {
        await w.gZenWorkspaces.changeWorkspaceWithID(tabWorkspace);
      }

      w.gBrowser.selectedTab = tab;
      return true;
    }

    // -----------------------------------------------------------------------
    // Palette overlay
    // -----------------------------------------------------------------------

    const OVERLAY_ID = "zen-tabs-panel-overlay";
    const PANEL_ID = "zen-tabs-panel-panel";

    function getPaletteURL() {
      return context.extension.getURL("popup/popup.html");
    }

    function createOverlay() {
      const w = getWin();
      if (!w) return null;

      if (w.document.getElementById(OVERLAY_ID)) return null;

      // Inject animation styles into chrome if not already present
      if (!w.document.getElementById("zen-tabs-panel-anim-styles")) {
        const animStyle = w.document.createElement("style");
        animStyle.id = "zen-tabs-panel-anim-styles";
        animStyle.textContent = `
          @keyframes ztt-overlay-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes ztt-panel-in {
            from { opacity: 0; transform: scale(0.96) translateY(-8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes ztt-overlay-out {
            from { opacity: 1; }
            to { opacity: 0; }
          }
          @keyframes ztt-panel-out {
            from { opacity: 1; transform: scale(1) translateY(0); }
            to { opacity: 0; transform: scale(0.96) translateY(-8px); }
          }
        `;
        w.document.documentElement.appendChild(animStyle);
      }

      const overlay = w.document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = [
        "position: fixed",
        "top: 0",
        "left: 0",
        "width: 100%",
        "height: 100%",
        "z-index: 99999",
        "display: flex",
        "align-items: center",
        "justify-content: center",
        "background: rgba(0, 0, 0, 0.25)",
        "animation: ztt-overlay-in 0.15s ease-out",
      ].join(";");

      const panel = w.document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.cssText = [
        "width: 600px",
        "max-height: 506px",
        "background: #1a1b2e",
        "border-radius: 16px",
        "border: 1px solid rgba(255, 255, 255, 0.08)",
        "box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)",
        "overflow: hidden",
        "display: flex",
        "flex-direction: column",
        "animation: ztt-panel-in 0.15s ease-out",
      ].join(";");

      const br = w.document.createXULElement("browser");
      br.id = "zen-tabs-panel-browser";
      br.setAttribute("type", "content");
      br.setAttribute("remote", "true");
      br.setAttribute("maychangeremoteness", "true");
      br.setAttribute("disableglobalhistory", "true");
      br.setAttribute("messagemanagergroup", "webext-browsers");
      br.setAttribute("webextension-view-type", "popup");
      br.setAttribute("src", getPaletteURL());
      br.style.cssText = "width:600px;height:506px;border:none";

      panel.appendChild(br);
      overlay.appendChild(panel);

      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) {
          destroyOverlay();
        }
      });

      w.document.documentElement.appendChild(overlay);

      w.setTimeout(() => {
        br.focus();
      }, 50);

      return overlay;
    }

    function destroyOverlay() {
      const w = getWin();
      if (!w) return;
      const overlay = w.document.getElementById(OVERLAY_ID);
      if (!overlay || overlay.dataset.closing) return;

      overlay.dataset.closing = "true";
      const panel = w.document.getElementById(PANEL_ID);
      overlay.style.animation = "ztt-overlay-out 0.12s ease-in forwards";
      if (panel) panel.style.animation = "ztt-panel-out 0.12s ease-in forwards";

      overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
    }

    function isOverlayOpen() {
      const w = getWin();
      if (!w) return false;
      const overlay = w.document.getElementById(OVERLAY_ID);
      // Not open if it's animating out
      return overlay && !overlay.dataset.closing;
    }

    return {
      zenWorkspaces: {
        async getAll() {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return [];
          return w.gZenWorkspaces.getWorkspaces();
        },

        async getActiveWorkspaceId() {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return null;
          return w.gZenWorkspaces.activeWorkspace;
        },

        async getTabWorkspaceId(tabId) {
          try {
            const nativeTab = context.extension.tabManager.get(tabId)?.nativeTab;
            if (!nativeTab) return null;
            return nativeTab.getAttribute("zen-workspace-id") || null;
          } catch (e) {
            return null;
          }
        },

        async switchTo(uuid) {
          const w = getWin();
          if (!w || !w.gZenWorkspaces) return;
          await w.gZenWorkspaces.changeWorkspaceWithID(uuid);
        },

        async activateTabByDomId(domId) {
          const tab = findTabByDomId(domId);
          if (!tab) return false;
          return activateNativeTab(tab);
        },

        // Go to previous tab using lastAccessed, filtering out the current
        // tab and any tabs visible in split view.
        async goToPreviousTab() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

          const allTabs = getAllTabElements();
          const currentTab = w.gBrowser.selectedTab;
          const currentDomId = currentTab?.id;

          // Collect DOM IDs of tabs currently visible to the user
          const visibleDomIds = new Set();
          if (currentDomId) visibleDomIds.add(currentDomId);

          // If current tab is in a split view, find its sibling tabs
          if (w.gZenViewSplitter?._data) {
            const currentGroup = w.gZenViewSplitter._data.find(
              (g) => g.tabs && g.tabs.some((t) => t.id === currentDomId)
            );
            if (currentGroup) {
              for (const tab of currentGroup.tabs) {
                visibleDomIds.add(tab.id);
              }
            }
          }

          // Sort by lastAccessed descending, filter out visible tabs
          const candidates = allTabs
            .filter((t) => !visibleDomIds.has(t.id))
            .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

          if (candidates.length === 0) return false;

          return activateNativeTab(candidates[0]);
        },

        async goToParentTab() {
          const w = getWin();
          if (!w || !w.gBrowser || !w.gZenWorkspaces) return false;

          const currentTab = w.gBrowser.selectedTab;
          if (!currentTab || !currentTab.openerTab) return false;

          return activateNativeTab(currentTab.openerTab);
        },

        // Close a tab by DOM id — works cross-workspace.
        async closeTabByDomId(domId) {
          const w = getWin();
          if (!w || !w.gBrowser) return false;

          const tab = findTabByDomId(domId);
          if (!tab) return false;

          // Never close pinned tabs (includes Essentials)
          if (tab.pinned) return false;

          w.gBrowser.removeTab(tab);
          return true;
        },

        // Get ALL tabs across ALL workspaces.
        async getAllTabs() {
          const tabElements = getAllTabElements();
          const w = getWin();
          const results = [];

          // Build a map of tab DOM ID → split group ID
          const tabToGroupId = new Map();
          if (w?.gZenViewSplitter?._data) {
            for (const group of w.gZenViewSplitter._data) {
              if (group.tabs) {
                for (const tab of group.tabs) {
                  tabToGroupId.set(tab.id, group.groupId);
                }
              }
            }
          }

          for (const tab of tabElements) {
            const extId = getExtTabId(tab);

            results.push({
              id: extId,
              domId: tab.id,
              title: tab.label || "",
              url: tab.linkedBrowser?.currentURI?.spec || "",
              workspaceId: tab.getAttribute("zen-workspace-id") || null,
              pinned: tab.pinned || false,
              active: tab.selected || false,
              lastAccessed: tab.lastAccessed || 0,
              favIconUrl: tab.image || "",
              unread: tab.hasAttribute("unread"),
              openerTabDomId: tab.openerTab?.id || null,
              splitView: tab.hasAttribute("split-view"),
              splitGroupId: tabToGroupId.get(tab.id) || null,
            });
          }
          return results;
        },

        // ---------------------------------------------------------------
        // Companion mod management
        // ---------------------------------------------------------------

        async getCompanionMods() {
          const w = getWin();
          const installedMods = (w && w.gZenMods) ? await w.gZenMods.getMods() : {};
          const result = [];
          for (const [id, def] of Object.entries(COMPANION_MODS)) {
            result.push({
              id,
              name: def.name,
              description: def.description,
              installed: !!installedMods[id],
            });
          }
          return result;
        },

        async installCompanionMod(modId) {
          const def = COMPANION_MODS[modId];
          if (!def) return { success: false };

          const w = getWin();
          if (!w || !w.gZenMods) return { success: false };

          try {
            const { PathUtils, IOUtils } = w;

            const modFolder = PathUtils.join(w.gZenMods.modsRootPath, modId);
            await IOUtils.makeDirectory(modFolder, { ignoreExisting: true });
            await IOUtils.write(
              PathUtils.join(modFolder, "chrome.css"),
              new w.TextEncoder().encode(def.css)
            );

            const mods = await w.gZenMods.getMods();
            mods[modId] = {
              id: modId,
              name: "Zen Tabs Panel — " + def.name,
              description: def.description,
              author: "c13v",
              version: def.version,
              enabled: true,
            };
            await IOUtils.writeJSON(w.gZenMods.modsDataFile, mods);
            w.gZenMods.triggerModsUpdate();
            return { success: true };
          } catch (e) {
            console.error("[ZenTabsPanel] Failed to install mod " + modId + ":", e);
            return { success: false };
          }
        },

        async removeCompanionMod(modId) {
          const w = getWin();
          if (!w || !w.gZenMods) return { success: false };

          try {
            const { PathUtils, IOUtils } = w;

            const modFolder = PathUtils.join(w.gZenMods.modsRootPath, modId);
            await IOUtils.remove(modFolder, { recursive: true, ignoreAbsent: true });

            const mods = await w.gZenMods.getMods();
            delete mods[modId];
            await IOUtils.writeJSON(w.gZenMods.modsDataFile, mods);
            w.gZenMods.triggerModsUpdate();
            return { success: true };
          } catch (e) {
            console.error("[ZenTabsPanel] Failed to remove mod " + modId + ":", e);
            return { success: false };
          }
        },

        // Palette management
        async showPalette() {
          if (isOverlayOpen()) {
            destroyOverlay();
            return false;
          }
          createOverlay();
          return true;
        },

        async hidePalette() {
          destroyOverlay();
        },
      },
    };
  }
};