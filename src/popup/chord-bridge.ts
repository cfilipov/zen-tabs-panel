import type { ViewId } from "../shared/types";

export type BridgeKeyData = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type InvalidChordFeedback = {
  key?: string;
  view?: string | null;
  path?: string[];
};

export type BridgeReply = {
  buffered?: BridgeKeyData[];
  stale?: boolean;
  view?: string | null;
  armRevealTimer?: boolean;
  invalidChord?: InvalidChordFeedback | null;
  visible?: boolean;
};

export type WarmRearmPayload = {
  inst?: number;
  readyGen?: number;
  view?: ViewId;
  params?: Record<string, unknown>;
};

export type PopupOptionsPayload = {
  skipAnimations?: boolean;
};

export type ForceReadyPayload = {
  buffered?: BridgeKeyData[];
  invalidChord?: InvalidChordFeedback | null;
  visible?: boolean;
};

type BridgeMessage =
  | { type: "deliver-key"; data?: BridgeKeyData }
  | { type: "warm-rearm"; data?: WarmRearmPayload }
  | { type: "popup-options"; data?: PopupOptionsPayload }
  | { type: "force-ready"; data?: ForceReadyPayload }
  | { type: "invalid-chord"; data?: InvalidChordFeedback }
  | { type: "palette-revealed" }
  | { type: "cancel-reveal" }
  | { type: "go-to-actions" };

export type ChordBridgeHandlers = {
  onDeliverKey: (input: BridgeKeyData) => void;
  onWarmRearm: (data: WarmRearmPayload) => void;
  onPopupOptions: (data: PopupOptionsPayload) => void;
  onForceReady: (data: ForceReadyPayload) => void;
  onInvalidChord: (data: InvalidChordFeedback) => void;
  onPaletteRevealed: () => void;
  onCancelReveal: () => void;
  onGoToActions: () => void;
};

const BRIDGE_EVENT = "ztt:bridge-message";

function parseBridgeMessage(event: Event): BridgeMessage | null {
  const detail = event instanceof CustomEvent ? event.detail : null;
  if (typeof detail !== "string") return null;
  try {
    const parsed = JSON.parse(detail) as BridgeMessage;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function installChordBridgeHandlers(handlers: ChordBridgeHandlers) {
  function onBridgeMessage(event: Event) {
    const message = parseBridgeMessage(event);
    if (!message) return;

    switch (message.type) {
      case "deliver-key":
        if (message.data?.key) handlers.onDeliverKey(message.data);
        return;
      case "warm-rearm":
        handlers.onWarmRearm(message.data ?? {});
        return;
      case "popup-options":
        handlers.onPopupOptions(message.data ?? {});
        return;
      case "force-ready":
        handlers.onForceReady(message.data ?? {});
        return;
      case "invalid-chord":
        handlers.onInvalidChord(message.data ?? {});
        return;
      case "palette-revealed":
        handlers.onPaletteRevealed();
        return;
      case "cancel-reveal":
        handlers.onCancelReveal();
        return;
      case "go-to-actions":
        handlers.onGoToActions();
        return;
    }
  }

  document.addEventListener(BRIDGE_EVENT, onBridgeMessage);
  return () => document.removeEventListener(BRIDGE_EVENT, onBridgeMessage);
}
