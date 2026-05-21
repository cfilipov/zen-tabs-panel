"use strict";

// Chrome-owned model for the move-to-workspace view. It keeps current
// workspace state, counts, and row intents together in chrome so visible
// selection and replay resolve against the same source.
this.createZenWorkspacesModel = function createZenWorkspacesModel(deps) {
  function rowChordKey(index) {
    return index >= 0 && index < 9 ? String(index + 1) : null;
  }

  function getRows() {
    const getWorkspaceRows = deps && deps.getWorkspaceRows;
    const getWorkspaceTabCounts = deps && deps.getWorkspaceTabCounts;
    const rows = typeof getWorkspaceRows === "function" ? getWorkspaceRows(true) : [];
    const counts = typeof getWorkspaceTabCounts === "function" ? getWorkspaceTabCounts() : {};
    return {
      version: Date.now(),
      view: "move-to-workspace",
      rows: rows.map((row, index) => ({
        uuid: row.uuid,
        name: row.name,
        svgContent: row.svgContent || "",
        icon: row.icon || "",
        isActive: !!row.isActive,
        tabCount: counts[row.uuid] || 0,
        chordKey: rowChordKey(index),
      })),
      model: {
        id: "workspaces",
        view: "move-to-workspace",
        rowIntents: rows.map((row, index) => ({
          rowId: row.uuid,
          index,
          chordKey: rowChordKey(index),
          shiftedChordKey: rowChordKey(index) ? "Shift+" + rowChordKey(index) : null,
          action: "move-selected-tabs-to-workspace",
          disabled: !!row.isActive,
        })),
      },
      selectedIndex: -1,
    };
  }

  return { getRows };
};
