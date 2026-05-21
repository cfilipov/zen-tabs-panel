export type InvalidChordKeyLike = {
  key?: string | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);
const STRUCTURAL_KEYS = new Set([
  "Escape",
  "Backspace",
  "Tab",
  "Enter",
  " ",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

export function displayInvalidChordKey(raw: string | undefined | null) {
  const value = String(raw || "");
  if (!value) return "that key";
  if (value === " ") return "Space";
  if (value === "\\") return "\\";
  if (value === "ArrowLeft") return "Left";
  if (value === "ArrowRight") return "Right";
  if (value === "ArrowUp") return "Up";
  if (value === "ArrowDown") return "Down";
  return value;
}

export function invalidChordMessage(raw: string | undefined | null) {
  return `No shortcut for ${displayInvalidChordKey(raw)}`;
}

export function isInvalidChordFeedbackInput(input: InvalidChordKeyLike) {
  if (input.metaKey || input.ctrlKey || input.altKey) return false;
  const key = input.key || "";
  if (MODIFIER_KEYS.has(key)) return false;
  return !STRUCTURAL_KEYS.has(key);
}
