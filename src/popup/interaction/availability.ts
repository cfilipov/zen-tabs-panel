import { NAVIGATION_TREE } from "../../shared/navigation-tree";
import type { AvailabilityPredicateId, NavNode } from "../../shared/types";

export type AvailabilityContext = {
  previewsById: Readonly<Record<string, unknown>>;
  counts: Readonly<Record<string, number>>;
  recentlyClosedCount: number;
  navigationEntryCount: number;
  currentTabIsPinned: boolean;
  currentTabCanReaderMode: boolean;
};

export const AVAILABILITY_PREDICATES = {
  needsParent: (ctx) => !!ctx.previewsById["go-to-parent-tab"],
  needsChildren: (ctx) => (ctx.counts["child-tabs"] ?? 0) > 0,
  needsSiblings: (ctx) => (ctx.counts["sibling-tabs"] ?? 0) > 0,
  needsParentTabs: (ctx) => (ctx.counts["parent-tabs"] ?? 0) > 0,
  needsUnvisited: (ctx) => (ctx.counts["unvisited-tabs"] ?? 0) > 0,
  needsDuplicates: (ctx) => (ctx.counts["duplicates"] ?? 0) > 0,
  needsRecentlyClosed: (ctx) => ctx.recentlyClosedCount > 0,
  needsHistory: (ctx) => ctx.navigationEntryCount > 1,
  needsPinnedTab: (ctx) => ctx.currentTabIsPinned,
  needsReaderMode: (ctx) => ctx.currentTabCanReaderMode,
} satisfies Record<AvailabilityPredicateId, (ctx: AvailabilityContext) => boolean>;

function flatten(nodes: readonly NavNode[]): NavNode[] {
  const out: NavNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "prefix") out.push(...node.children);
  }
  return out;
}

export function unavailableNavigationIds(
  context: AvailabilityContext,
  nodes: readonly NavNode[] = NAVIGATION_TREE,
) {
  const unavailable = new Set<string>();
  for (const node of flatten(nodes)) {
    for (const key of Object.keys(AVAILABILITY_PREDICATES) as AvailabilityPredicateId[]) {
      if (node[key] && !AVAILABILITY_PREDICATES[key](context)) {
        unavailable.add(node.id);
        break;
      }
    }
  }
  return unavailable;
}
