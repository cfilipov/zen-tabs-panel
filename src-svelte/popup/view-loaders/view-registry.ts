import type { NavigationViewId } from "../../shared/navigation-tree";
import type { ViewId } from "../../shared/types";

const nativeTabViews = [
  "child-tabs",
  "sibling-tabs",
  "parent-tabs",
  "last-visited",
  "unvisited-tabs",
  "tabs-by-age",
  "most-visited",
  "domain-tabs",
] as const satisfies readonly ViewId[];

const nativeDomainViews = ["domains"] as const satisfies readonly ViewId[];
const prefixViewIds = ["reorder-tabs", "close-and-select", "split-view"] as const satisfies readonly NavigationViewId[];

export type NativeTabView = (typeof nativeTabViews)[number];
export type NativeDomainView = (typeof nativeDomainViews)[number];
export type NativeListView = NativeTabView | NativeDomainView;
export type NativePrefixView = (typeof prefixViewIds)[number];

export const LIST_VIEW_TITLES: Record<NativeListView, string> = {
  "last-visited": "Recent",
  "unvisited-tabs": "New tabs",
  "tabs-by-age": "Tabs by age",
  "most-visited": "Most visited",
  "domain-tabs": "",
  "child-tabs": "Children",
  "sibling-tabs": "Siblings",
  "parent-tabs": "Parent tabs",
  "domains": "Domains",
};

const listViews = new Set<ViewId>([...nativeTabViews, ...nativeDomainViews]);
const tabViews = new Set<ViewId>(nativeTabViews);
const prefixViews = new Set<ViewId>(prefixViewIds);

export const VIEW_LOADERS = {
  navigation: "navigation",
  "recently-closed": "recently-closed",
  "move-to-workspace": "move-to-workspace",
  "open-in-container": "open-in-container",
  "move-to-folder": "move-to-folder",
  profiles: "profiles",
  duplicates: "duplicates",
  "tab-info": "tab-info",
  "duplicate-prompt": "duplicate-prompt",
} as const satisfies Partial<Record<NavigationViewId | "duplicate-prompt", string>>;

export type LoaderView = keyof typeof VIEW_LOADERS;
export type ViewLoaderId = (typeof VIEW_LOADERS)[LoaderView];
type PlannedNavigationView = NativeListView | NativePrefixView | LoaderView;
const _viewCoverage: Record<Exclude<NavigationViewId, PlannedNavigationView>, never> = {};
void _viewCoverage;

const CONCRETE_VIEW_TITLES: Partial<Record<ViewId, string>> = {
  navigation: "Tab history",
  "recently-closed": "Recently closed",
  duplicates: "Duplicates",
  "tab-info": "Tab info",
  "duplicate-prompt": "Duplicate tab already open",
  "move-to-workspace": "Move to workspace",
  "open-in-container": "New container tab",
  "move-to-folder": "Move to folder",
  profiles: "Profiles",
};

export type ViewOpenPlan =
  | { kind: "actions" }
  | { kind: "list"; view: NativeListView; params: Record<string, unknown>; domain: string | null }
  | { kind: "prefix"; view: NativePrefixView }
  | { kind: "loader"; view: LoaderView; loader: ViewLoaderId }
  | { kind: "unsupported"; view: ViewId };

export function isNativeTabView(view: ViewId | undefined): view is NativeTabView {
  return !!view && tabViews.has(view);
}

export function isNativeListView(view: ViewId | undefined): view is NativeListView {
  return !!view && listViews.has(view);
}

export function isNativePrefixView(view: ViewId | undefined): view is NativePrefixView {
  return !!view && prefixViews.has(view);
}

export function resolveViewTitle(
  view: ViewId,
  options: {
    currentDomain?: string | null;
    actionLabel?: string | null;
  } = {},
) {
  if (view === "domain-tabs" && options.currentDomain) return options.currentDomain;
  if (isNativeListView(view)) return LIST_VIEW_TITLES[view];
  return CONCRETE_VIEW_TITLES[view] ?? options.actionLabel ?? "";
}

export function paramsRecord(params?: URLSearchParams | Record<string, unknown>) {
  if (!params) return {};
  if (params instanceof URLSearchParams) return Object.fromEntries(params.entries());
  return params;
}

export function paramValue(params: URLSearchParams | Record<string, unknown> | undefined, key: string) {
  if (!params) return null;
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return typeof value === "string" ? value : null;
}

export function resolveViewOpenPlan(
  view: ViewId,
  params?: URLSearchParams | Record<string, unknown>,
): ViewOpenPlan {
  if (view === "actions") return { kind: "actions" };
  if (isNativeListView(view)) {
    return {
      kind: "list",
      view,
      params: paramsRecord(params),
      domain: paramValue(params, "domain"),
    };
  }
  if (isNativePrefixView(view)) return { kind: "prefix", view };
  if (view in VIEW_LOADERS) {
    const loaderView = view as LoaderView;
    return { kind: "loader", view: loaderView, loader: VIEW_LOADERS[loaderView] };
  }
  return { kind: "unsupported", view };
}
