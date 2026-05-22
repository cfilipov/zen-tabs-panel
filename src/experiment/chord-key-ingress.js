"use strict";

// Physical-key ingress for the chrome-side chord engine.
//
// The chrome shim, content shim, and fallback listeners can all report the
// same physical key. This boundary owns the "consume once" rule before keys
// reach ChordSession.
(function (scope) {
  function keySignature(keyData) {
    if (!keyData) return null;
    return [
      keyData.key || "",
      keyData.code || "",
      keyData.shiftKey ? "1" : "0",
      keyData.altKey ? "1" : "0",
      keyData.ctrlKey ? "1" : "0",
      keyData.metaKey ? "1" : "0",
    ].join(":");
  }

  function createChordKeyIngress(options) {
    options = options || {};
    const chordSession = options.chordSession;
    const debugTrace = typeof options.debugTrace === "function" ? options.debugTrace : null;
    const nowMs = typeof options.nowMs === "function" ? options.nowMs : Date.now;
    const echoWindowMs = typeof options.echoWindowMs === "number" ? options.echoWindowMs : 1200;
    const maxRecent = typeof options.maxRecent === "number" ? options.maxRecent : 16;

    let recent = [];
    let consumed = 0;
    let duplicates = 0;
    const sources = Object.create(null);

    function resetForArm() {
      recent = [];
    }

    function prune(now) {
      recent = recent.filter((entry) => now - entry.at <= echoWindowMs);
      if (recent.length > maxRecent) recent = recent.slice(-maxRecent);
    }

    function remember(signature, source, now) {
      recent.push({ signature, source, at: now });
      if (recent.length > maxRecent) recent = recent.slice(-maxRecent);
    }

    function consumeDuplicate(signature, source, now) {
      const index = recent.findIndex((entry) =>
        entry.signature === signature &&
        entry.source !== source &&
        now - entry.at <= echoWindowMs
      );
      if (index < 0) return null;
      const entry = recent.splice(index, 1)[0];
      return {
        source: entry.source,
        elapsed: now - entry.at,
      };
    }

    function submit(keyData, source) {
      if (!chordSession || !keyData || keyData.kind !== "key") return "ignored";
      const actualSource = source || keyData.source || "unknown";
      const signature = keySignature(keyData);
      if (!signature) return "ignored";
      const now = nowMs();
      prune(now);

      const duplicate = consumeDuplicate(signature, actualSource, now);
      if (duplicate) {
        duplicates += 1;
        if (debugTrace) {
          debugTrace("ingress-duplicate-suppressed", {
            key: keyData.key,
            code: keyData.code,
            source: actualSource,
            originalSource: duplicate.source,
            elapsed: duplicate.elapsed,
          });
        }
        return "duplicate";
      }

      remember(signature, actualSource, now);
      consumed += 1;
      sources[actualSource] = (sources[actualSource] || 0) + 1;
      chordSession.acceptKey(Object.assign({}, keyData, { source: actualSource }));
      return "consumed";
    }

    function stats() {
      return {
        consumed,
        duplicates,
        sources: Object.assign({}, sources),
        recent: recent.length,
      };
    }

    return {
      submit,
      resetForArm,
      stats,
    };
  }

  scope.createChordKeyIngress = createChordKeyIngress;
})(this);
