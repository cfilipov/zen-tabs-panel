export type PaletteRevealController = {
  readonly inst: number | null;
  configureFromSearch: (search: string) => void;
  updateInst: (inst: number | null | undefined) => void;
  clear: () => void;
  arm: () => void;
  markAlive: () => void;
  markDead: () => void;
  popupReadyMessage: () => { type: "popup-ready"; inst: number | null };
};

type PaletteRevealOptions = {
  sendReveal: (inst: number | null) => void;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
};

export function createPaletteRevealController(options: PaletteRevealOptions): PaletteRevealController {
  const setTimer = options.setTimeout ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimer = options.clearTimeout ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let popupInst: number | null = null;
  let popupChordDelay = 500;
  let pageAlive = true;
  let popupRevealTimer: unknown | null = null;

  function clear() {
    if (popupRevealTimer !== null) {
      clearTimer(popupRevealTimer);
      popupRevealTimer = null;
    }
  }

  return {
    get inst() {
      return popupInst;
    },
    configureFromSearch(search) {
      const params = new URLSearchParams(search);
      const inst = Number.parseInt(params.get("inst") || "", 10);
      popupInst = Number.isFinite(inst) ? inst : null;
      const delay = Number.parseInt(params.get("delay") || "", 10);
      if (Number.isFinite(delay) && delay >= 0) popupChordDelay = delay;
    },
    updateInst(inst) {
      if (typeof inst === "number") popupInst = inst;
      else if (inst === null) popupInst = null;
    },
    clear,
    arm() {
      clear();
      popupRevealTimer = setTimer(() => {
        popupRevealTimer = null;
        if (!pageAlive) return;
        options.sendReveal(popupInst);
      }, popupChordDelay);
    },
    markAlive() {
      pageAlive = true;
    },
    markDead() {
      pageAlive = false;
      clear();
    },
    popupReadyMessage() {
      return { type: "popup-ready", inst: popupInst };
    },
  };
}
