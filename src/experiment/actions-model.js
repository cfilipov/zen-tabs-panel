"use strict";

// Chrome-owned model for the root actions view. The popup renders this
// snapshot and reports user intent; it no longer decides counts,
// availability, previews, workspace switch rows, or badges for this view.
this.createZenActionsModel = function createZenActionsModel(deps) {
  const SECTION_DEFS = Array.isArray(deps.sectionDefs) ? deps.sectionDefs : null;
  if (!SECTION_DEFS || SECTION_DEFS.length === 0) {
    throw new Error("Missing actions menu section definitions");
  }
  const navigationTree = deps.navigationTree || [];
  const displayKey = typeof deps.displayKey === "function"
    ? deps.displayKey
    : (chord) => chord == null ? "" : String(chord).replace(/^Shift\+/, "⇧");
  const commandPaletteLeaderBadge = typeof deps.commandPaletteLeaderBadge === "string"
    ? deps.commandPaletteLeaderBadge
    : "⌘.";

  function flatten(nodes) {
    const out = [];
    for (const node of nodes || []) {
      out.push(node);
      if (node.kind === "prefix") out.push(...flatten(node.children || []));
    }
    return out;
  }

  const nodeById = new Map(flatten(navigationTree).map((node) => [node.id, node]));

  function itemFromNode(node, page, disabledIds) {
    return {
      id: node.id,
      kind: node.kind,
      view: node.kind === "open-view" || node.kind === "prefix" ? node.view : undefined,
      label: node.label,
      icon: node.icon,
      hotkey: node.chord,
      badge: displayKey(node.chord),
      isView: node.kind === "open-view" || node.kind === "prefix",
      page,
      disabled: disabledIds.has(node.id),
    };
  }

  function commandPaletteItemFromNode(node, disabledIds, parent) {
    const isPrefixChild = !!parent;
    const navPath = isPrefixChild
      ? [parent.chord, node.chord].filter(Boolean).map(displayKey).filter(Boolean).join(" ")
      : displayKey(node.chord);
    const chordPath = [commandPaletteLeaderBadge, navPath].filter(Boolean).join(" ");
    const label = isPrefixChild ? `${parent.label}: ${node.label}` : node.label;
    const searchText = isPrefixChild
      ? `${parent.label} ${node.label} ${parent.id} ${node.id}`
      : `${node.label} ${node.id}`;
    return {
      ...itemFromNode(node, 1, disabledIds),
      label,
      searchText,
      chordPathBadge: chordPath,
      badge: chordPath,
    };
  }

  function buildCommandPaletteItems(disabledIds) {
    const out = [];
    for (const node of navigationTree) {
      if (!node) continue;
      if (node.kind === "prefix") {
        for (const child of node.children || []) {
          if (child && (child.kind === "action" || child.kind === "open-view")) {
            out.push(commandPaletteItemFromNode(child, disabledIds, node));
          }
        }
        continue;
      }
      if (node.kind === "action" || node.kind === "open-view") {
        out.push(commandPaletteItemFromNode(node, disabledIds, null));
      }
    }
    return out;
  }

  function historyPreview(entry) {
    if (!entry) return null;
    return {
      title: entry.title || entry.url || "Untitled",
      url: entry.url || "",
      isHistory: true,
    };
  }

  function workspaceNavigationIconMap(workspaces) {
    const activeIndex = workspaces.findIndex((workspace) => workspace.isActive);
    if (activeIndex < 0 || workspaces.length <= 1) return {};
    const prev = workspaces[(activeIndex - 1 + workspaces.length) % workspaces.length];
    const next = workspaces[(activeIndex + 1) % workspaces.length];
    return {
      "go-to-prev-workspace": prev.svgContent ? `<span class="workspace-icon">${prev.svgContent}</span>` : null,
      "go-to-next-workspace": next.svgContent ? `<span class="workspace-icon">${next.svgContent}</span>` : null,
    };
  }

  function unavailableNavigationIds(context) {
    const predicates = {
      needsParent: (ctx) => !!ctx.previewsById["go-to-parent-tab"],
      needsChildren: (ctx) => (ctx.counts["child-tabs"] || 0) > 0,
      needsSiblings: (ctx) => (ctx.counts["sibling-tabs"] || 0) > 0,
      needsParentTabs: (ctx) => (ctx.counts["parent-tabs"] || 0) > 0,
      needsUnvisited: (ctx) => (ctx.counts["unvisited-tabs"] || 0) > 0,
      needsDuplicates: (ctx) => (ctx.counts["duplicates"] || 0) > 0,
      needsRecentlyClosed: (ctx) => ctx.recentlyClosedCount > 0,
      needsHistory: (ctx) => ctx.navigationEntryCount > 1,
      needsPinnedTab: (ctx) => ctx.currentTabIsPinned,
      needsReaderMode: (ctx) => ctx.currentTabCanReaderMode,
    };
    const unavailable = new Set();
    for (const node of flatten(navigationTree)) {
      for (const key of Object.keys(predicates)) {
        if (node[key] && !predicates[key](context)) {
          unavailable.add(node.id);
          break;
        }
      }
    }
    return unavailable;
  }

  function buildBaseSections(disabledIds) {
    return SECTION_DEFS.map((section) => ({
      id: section.id,
      label: section.label,
      page: section.page,
      navigateGrid: section.navigateGrid,
      column: section.column,
      stack: section.stack,
      scrollable: section.scrollable,
      items: section.actionIds.map((id) => {
        const node = nodeById.get(id);
        if (!node) throw new Error("Missing navigation node: " + id);
        return itemFromNode(node, section.page, disabledIds);
      }),
    }));
  }

  function buildPrefixItemsByView(disabledIds) {
    const itemsByView = Object.create(null);
    for (const node of navigationTree) {
      if (!node || node.kind !== "prefix" || !node.view) continue;
      itemsByView[node.view] = (node.children || []).map((child) =>
        itemFromNode(child, 1, disabledIds)
      );
    }
    return itemsByView;
  }

  function appendWorkspaceSwitchItems(sections, workspaces, tabCounts) {
    return sections.map((section) => {
      if (section.id !== "workspaces" || section.page !== 1) {
        return { ...section, items: section.items.slice() };
      }
      const workspaceItems = workspaces.map((workspace, index) => ({
        id: `workspace-switch:${workspace.uuid}`,
        kind: "workspace-switch",
        workspaceId: workspace.uuid,
        workspaceIndex: index,
        workspaceIconHtml: workspace.svgContent,
        label: workspace.name,
        hotkey: index < 9 ? String(index + 1) : "",
        badge: index < 9 ? String(index + 1) : "",
        isView: false,
        page: section.page,
        disabled: !!workspace.isActive,
        count: tabCounts[workspace.uuid] || 0,
      }));
      return { ...section, items: [...section.items, ...workspaceItems] };
    });
  }

  function applyActionMetadata(sections, counts, disabledIds, iconHtmlById, previewsById) {
    return sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        iconHtml: iconHtmlById[item.id] ?? item.iconHtml,
        count: item.kind === "workspace-switch" ? item.count : counts[item.id] || 0,
        disabled: item.disabled || disabledIds.has(item.id),
        preview: previewsById[item.id] ?? item.preview,
      })),
    }));
  }

  function getViewModel(input) {
    const workspaces = input.workspaces || [];
    const snapshot = input.snapshot || {};
    const navHistory = input.navHistory || null;
    const recentlyClosedCount = Number(input.recentlyClosedCount) || 0;
    const selectedDomIds = Array.isArray(input.selectedDomIds) ? input.selectedDomIds : [];
    const hasVisibleHistoryCurrent = !!navHistory && navHistory.index >= 0;
    const backPreview = hasVisibleHistoryCurrent && navHistory.index > 0
      ? historyPreview(navHistory.entries[navHistory.index - 1])
      : null;
    const forwardPreview = hasVisibleHistoryCurrent && navHistory.index < navHistory.entries.length - 1
      ? historyPreview(navHistory.entries[navHistory.index + 1])
      : null;
    const previewsById = {
      ...(snapshot.previews || {}),
      "go-back-in-tab": backPreview,
      "go-forward-in-tab": forwardPreview,
    };
    const counts = {
      "child-tabs": snapshot.childTabCount || 0,
      "sibling-tabs": snapshot.siblingTabCount || 0,
      "parent-tabs": snapshot.parentTabCount || 0,
      "unvisited-tabs": snapshot.unvisitedTabCount || 0,
      "domains": snapshot.domainCount || 0,
      "recently-closed": recentlyClosedCount,
      "duplicates": snapshot.duplicateGroupCount || 0,
      "move-to-workspace": selectedDomIds.length > 1 ? selectedDomIds.length : 0,
    };
    const disabledIds = unavailableNavigationIds({
      previewsById,
      counts,
      recentlyClosedCount,
      navigationEntryCount: navHistory?.entries?.length || 0,
      currentTabIsPinned: !!snapshot.currentTabIsPinned,
      currentTabCanReaderMode: !!snapshot.currentTabCanReaderMode,
    });
    for (const id of [
      ...(!previewsById["go-to-previous-tab"] ? ["go-to-previous-tab"] : []),
      ...(!previewsById["go-to-prev-vertical-tab"] ? ["go-to-prev-vertical-tab"] : []),
      ...(!previewsById["go-to-next-vertical-tab"] ? ["go-to-next-vertical-tab"] : []),
      ...(!previewsById["go-back-in-tab"] ? ["go-back-in-tab"] : []),
      ...(!previewsById["go-forward-in-tab"] ? ["go-forward-in-tab"] : []),
      ...(!previewsById["unvisited-newest"] ? ["unvisited-newest"] : []),
      ...(!previewsById["unvisited-oldest"] ? ["unvisited-oldest"] : []),
      ...((snapshot.domainCount || 0) <= 0 ? ["domains"] : []),
    ]) disabledIds.add(id);

    const workspaceTabCounts = snapshot.workspaceTabCounts || {};
    const iconHtmlById = workspaceNavigationIconMap(workspaces);
    const sections = applyActionMetadata(
      appendWorkspaceSwitchItems(buildBaseSections(disabledIds), workspaces, workspaceTabCounts),
      counts,
      disabledIds,
      iconHtmlById,
      previewsById
    );
    const prefixItemsByView = buildPrefixItemsByView(disabledIds);
    const commandPaletteItems = buildCommandPaletteItems(disabledIds);

    return {
      version: snapshot.version || Date.now(),
      view: "actions",
      sections,
      prefixItemsByView,
      commandPaletteItems,
      workspaces,
      extensions: input.extensions || [],
      selectedIndex: -1,
      model: {
        id: "actions",
        view: "actions",
        rowIntents: sections.flatMap((section) => section.items.map((item, index) => ({
          rowId: item.id,
          index,
          chordKey: item.hotkey || null,
          action: item.kind,
        }))),
      },
    };
  }

  return { getViewModel };
};
