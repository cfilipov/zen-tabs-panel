export type Chord = string;

export type ViewId =
  | "actions"
  | "command-palette"
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
  | "domain-close-confirm"
  | "tabs-by-age"
  | "most-visited"
  | "move-to-workspace"
  | "move-to-parent"
  | "open-in-container"
  | "profiles"
  | "workspace-icons"
  | "workspace-actions"
  | "workspace-name"
  | "workspace-profiles"
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
  | "needsPinnedTab"
  | "needsReaderMode";

export type AvailabilityPredicateId = NavFlag;

export type ViewCapabilityId =
  | "closeSelection"
  | "closeAll"
  | "restoreSelection"
  | "sort"
  | "search"
  | "drillSelection"
  | "workspaceFilter";

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
  viewCapabilities?: readonly ViewCapabilityId[];
};

export type PrefixChildNode = ActionNode | OpenViewNode;

export type PrefixNode = NavBase & {
  kind: "prefix";
  view: ViewId;
  viewCapabilities?: readonly ViewCapabilityId[];
  children: readonly PrefixChildNode[];
};

export type NavNode = ActionNode | OpenViewNode | PrefixNode;

export type TerminalNode = ActionNode | OpenViewNode | PrefixNode;
