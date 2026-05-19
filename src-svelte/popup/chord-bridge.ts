import type { ViewId } from "../shared/types";

export type BridgeKeyData = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type BridgeReply = {
  buffered?: BridgeKeyData[];
  stale?: boolean;
  view?: string | null;
  armRevealTimer?: boolean;
};

export type WarmRearmPayload = {
  inst?: number;
  view?: ViewId;
  params?: Record<string, unknown>;
};

export type ForceReadyPayload = {
  buffered?: BridgeKeyData[];
};

type BridgeMessage =
  | { type: "deliver-key"; data?: BridgeKeyData }
  | { type: "warm-rearm"; data?: WarmRearmPayload }
  | { type: "force-ready"; data?: ForceReadyPayload }
  | { type: "cancel-reveal" }
  | { type: "go-to-actions" };

export type ChordBridgeHandlers = {
  onDeliverKey: (input: BridgeKeyData) => void;
  onWarmRearm: (data: WarmRearmPayload) => void;
  onForceReady: (data: ForceReadyPayload) => void;
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
      case "force-ready":
        handlers.onForceReady(message.data ?? {});
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
