"use strict";

// Pure chord-tree helpers shared by chrome/session code and tests.
(function (scope) {
  function chordKeyFor(e) {
    if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") return null;
    if (e.metaKey || e.ctrlKey || e.altKey) return null;
    if (e.key === "Escape") return "Escape";
    if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
      const upper = e.key.toUpperCase();
      return e.shiftKey ? "Shift+" + upper : upper;
    }
    if (e.shiftKey && e.code && /^Digit[1-9]$/.test(e.code)) {
      return "Shift+" + e.code.slice(5);
    }
    return e.key || null;
  }

  function buildChordTree(KEYBINDINGS, WORKSPACE_DIGIT_CHORDS, constants) {
    function buildNode(entry) {
      if (entry.kind === "action") return { type: "action", actionId: entry.id };
      if (entry.kind === "open-view") return { type: "open-view", view: entry.view };
      if (entry.kind === "prefix") {
        const children = Object.create(null);
        for (const child of (entry.children || [])) {
          children[child.chord] = buildNode(child);
        }
        return {
          type: "prefix",
          timeoutMs: constants.CHORD_PREFIX_TIMEOUT_MS,
          onTimeout: { type: "open-view", view: entry.view },
          children,
        };
      }
      return null;
    }

    const tree = { children: Object.create(null) };
    for (const entry of (KEYBINDINGS || [])) {
      const node = buildNode(entry);
      if (node) tree.children[entry.chord] = node;
    }
    for (let i = 0; i < (WORKSPACE_DIGIT_CHORDS || []).length; i++) {
      tree.children[WORKSPACE_DIGIT_CHORDS[i]] = { type: "switch-workspace", index: i };
    }
    return tree;
  }

  scope.buildChordTree = buildChordTree;
  scope.chordKeyFor = chordKeyFor;
})(this);
