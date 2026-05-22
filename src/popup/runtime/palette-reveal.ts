export type PaletteRevealController = {
  readonly inst: number | null;
  readonly readyGen: number | null;
  configureFromSearch: (search: string) => void;
  updateInst: (inst: number | null | undefined) => void;
  updateReadyGen: (readyGen: number | null | undefined) => void;
  clear: () => void;
  arm: () => void;
  markAlive: () => void;
  markDead: () => void;
  popupReadyMessage: () => { type: "popup-ready"; inst: number | null; readyGen: number | null };
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
  let popupReadyGen: number | null = null;
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
    get readyGen() {
      return popupReadyGen;
    },
    configureFromSearch(search) {
      const params = new URLSearchParams(search);
      const inst = Number.parseInt(params.get("inst") || "", 10);
      popupInst = Number.isFinite(inst) ? inst : null;
      const readyGen = Number.parseInt(params.get("readyGen") || "", 10);
      popupReadyGen = Number.isFinite(readyGen) ? readyGen : null;
      const delay = Number.parseInt(params.get("delay") || "", 10);
      if (Number.isFinite(delay) && delay >= 0) popupChordDelay = delay;
    },
    updateInst(inst) {
      if (typeof inst === "number") popupInst = inst;
      else if (inst === null) popupInst = null;
    },
    updateReadyGen(readyGen) {
      if (typeof readyGen === "number") popupReadyGen = readyGen;
      else if (readyGen === null) popupReadyGen = null;
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
      return { type: "popup-ready", inst: popupInst, readyGen: popupReadyGen };
    },
  };
}
