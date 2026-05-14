export type Chord = string;

export type ViewId =
  | "actions"
  | "child-tabs"
  | "sibling-tabs"
  | "parent-tabs"
  | "navigation"
  | "unvisited-tabs"
  | "last-visited"
  | "recently-closed"
  | "duplicates"
  | "tab-info"
  | "domains"
  | "domain-tabs"
  | "tabs-by-age"
  | "most-visited"
  | "move-to-workspace"
  | "open-in-container"
  | "profiles"
  | "move-to-folder"
  | "reorder-tabs"
  | "split-view"
  | "close-and-select"
  | "duplicate-prompt"
  | "extension-popup";

export type NavFlag =
  | "needsParent"
  | "needsChildren"
  | "needsSiblings"
  | "needsParentTabs"
  | "needsUnvisited"
  | "needsDuplicates"
  | "needsRecentlyClosed"
  | "needsHistory"
  | "needsPinnedTab";

export type NavBase = {
  id: string;
  chord: Chord;
  label: string;
  icon?: string;
  page?: number;
} & Partial<Record<NavFlag, boolean>>;

export type ActionNode = NavBase & {
  kind: "action";
};

export type OpenViewNode = NavBase & {
  kind: "open-view";
  view: ViewId;
};

export type PrefixNode = NavBase & {
  kind: "prefix";
  view: ViewId;
  children: ActionNode[];
};

export type NavNode = ActionNode | OpenViewNode | PrefixNode;

export type TerminalNode = ActionNode | OpenViewNode | PrefixNode;
