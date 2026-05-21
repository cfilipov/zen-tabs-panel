"use strict";

// Chrome-owned view model for the Recents view. It wraps the tab index with
// row-level intent metadata so replay and activation can resolve in chrome
// without asking the popup what a numbered row means.
this.createZenRecentsModel = function createZenRecentsModel(deps) {
  const tabIndex = deps && deps.tabIndex;

  function rowChordKey(offset, relativeIndex) {
    const absoluteIndex = (Number(offset) || 0) + relativeIndex;
    return absoluteIndex >= 0 && absoluteIndex < 9 ? String(absoluteIndex + 1) : null;
  }

  function getWindow(offset, limit, params) {
    if (!tabIndex) {
      return {
        version: 0,
        view: "last-visited",
        offset: 0,
        limit: 0,
        total: 0,
        rows: [],
        favicons: {},
        model: { id: "recents", view: "last-visited", rowIntents: [] },
      };
    }
    tabIndex.start();
    const win = tabIndex.getWindow("last-visited", offset, limit, params || {});
    return Object.assign({}, win, {
      model: {
        id: "recents",
        view: "last-visited",
        version: win.version,
        rowIntents: (win.rows || []).map((row, index) => ({
          rowId: row.domId || null,
          index: win.offset + index,
          chordKey: rowChordKey(win.offset, index),
          action: "activate-tab",
        })),
      },
    });
  }

  return { getWindow };
};
