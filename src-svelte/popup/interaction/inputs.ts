import type { Chord } from "../../shared/types";

export type InteractionInput =
  | { kind: "key"; key: string; code?: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  | { kind: "chord"; chord: Chord }
  | { kind: "mouse"; targetId: string };

export function chordFromKey(input: InteractionInput): Chord | null {
  if (input.kind === "chord") return input.chord;
  if (input.kind !== "key") return null;
  if (input.key.length === 1 && /[a-z]/i.test(input.key)) {
    return `${input.shiftKey ? "Shift+" : ""}${input.key.toUpperCase()}`;
  }
  return input.key;
}

export function inputFromKeyboardEvent(event: KeyboardEvent): InteractionInput {
  return {
    kind: "key",
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}
