(function(scope) {
  "use strict";

  function acceptsPopupViewStateMessage(deps, inst, readyGen) {
    if (!deps || !deps.matchesPopupInstance(inst)) return false;
    if (typeof readyGen === "number") return deps.matchesReadinessGeneration(readyGen);
    return !deps.hasActiveBridge() && !deps.hasPendingReveal();
  }

  scope.acceptsPopupViewStateMessage = acceptsPopupViewStateMessage;
})(this);
