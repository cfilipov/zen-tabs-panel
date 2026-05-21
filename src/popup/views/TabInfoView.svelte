<script lang="ts">
  import { iconHtml } from "../components/icons";
  import type { HistoryVisit, TabInfo } from "../runtime/tab-info-client";
  import type { TabIndexRow } from "../runtime/tab-index-client";
  import type { WorkspaceRow } from "../runtime/workspace-client";
  import { formatBytes, formatDuration } from "./format";
  import { domainOf } from "./url";

  type Props = {
    info: TabInfo | null;
    visits?: HistoryVisit[];
    duplicates?: TabIndexRow[];
    workspaces?: WorkspaceRow[];
    onactivate?: (row: TabIndexRow | { domId: string }) => void;
    onduplicateactivate?: (row: TabIndexRow, index: number) => void | Promise<void>;
    onclose?: (row: TabIndexRow) => void;
    oncloseothers?: () => void;
    onpreview?: (row: TabIndexRow | { domId: string }) => void;
    onclearpreview?: () => void;
  };

  let {
    info,
    visits = [],
    duplicates = [],
    workspaces = [],
    onactivate,
    onduplicateactivate,
    onclose,
    oncloseothers,
    onpreview,
    onclearpreview,
  }: Props = $props();

  const now = $derived(Date.now());
  const workspaceById = $derived(new Map(workspaces.map((workspace) => [workspace.uuid, workspace])));
  const domain = $derived(info ? domainOf(info.url) : "");
  const stats = $derived(info?.panelStats ?? null);
  const hasDuplicates = $derived(duplicates.length > 1);
  const groupedVisits = $derived(groupVisitsByDate(visits));

  function createdAt() {
    if (!info) return 0;
    const persisted = info.panelStats?.createdAt ?? 0;
    const fallback = Number.parseInt(info.domId.split("-")[0] || "", 10);
    if (persisted > 1e12) return persisted;
    return fallback > 1e12 ? fallback : 0;
  }

  function openerLabel() {
    const labels: Record<string, string> = {
      tab: "Another tab",
      bookmark: "Bookmark",
      history: "History",
      external: "External app",
      manual: "URL bar / new tab",
    };
    const type = stats?.openerType || "";
    if (!labels[type]) return "";
    return type === "tab" && info?.parentTitle ? `${labels[type]}: ${info.parentTitle}` : labels[type];
  }

  function firstVisitTime() {
    return visits.length ? Math.min(...visits.map((visit) => visit.visitTime)) : 0;
  }

  function formatTransition(transition?: string) {
    const map: Record<string, string> = {
      link: "link",
      typed: "typed",
      auto_bookmark: "bookmark",
      auto_subframe: "frame",
      manual_subframe: "frame",
      generated: "generated",
      auto_toplevel: "auto",
      form_submit: "form",
      reload: "reload",
      keyword: "search",
      keyword_generated: "search",
    };
    return map[transition || ""] || transition || "";
  }

  function formatVisitTime(ts: number) {
    const date = new Date(ts);
    return {
      date: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      time: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };
  }

  function groupVisitsByDate(rows: HistoryVisit[]) {
    const dayFmt: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
    const map = new Map<string, { label: string; visits: HistoryVisit[] }>();
    for (const visit of [...rows].sort((a, b) => b.visitTime - a.visitTime)) {
      const date = new Date(visit.visitTime);
      const key = date.toISOString().slice(0, 10);
      if (!map.has(key)) {
        map.set(key, { label: date.toLocaleDateString(undefined, dayFmt), visits: [] });
      }
      map.get(key)?.visits.push(visit);
    }
    return [...map.values()];
  }

  function workspaceName(row: TabIndexRow) {
    return row.workspaceId ? workspaceById.get(row.workspaceId)?.name ?? "" : "";
  }

  function workspaceIcon(row: TabIndexRow) {
    return row.workspaceId ? workspaceById.get(row.workspaceId)?.svgContent ?? "" : "";
  }

  function duplicateAge(row: TabIndexRow) {
    const created = Number.parseInt(row.domId.split("-")[0] || "", 10);
    return formatDuration(now - created);
  }
</script>

{#if !info}
  <div class="empty-state">No tab info available</div>
{:else}
  <div class="info-header">
    {#if info.favIconUrl}
      <img class="info-favicon" src={info.favIconUrl} alt="" />
    {:else}
      <span class="info-favicon-placeholder">○</span>
    {/if}
    <div class="info-header-text">
      <div class="info-header-title">{info.title || "Untitled"}</div>
      <div class="info-header-url">{domain}</div>
    </div>
  </div>

  <div class="info-grid">
    {#if createdAt() > 0}
      <div class="info-cell"><span class="info-label">Tab age</span><span class="info-value">{formatDuration(now - createdAt())}</span></div>
    {/if}
    {#if firstVisitTime() > 0}
      <div class="info-cell"><span class="info-label">First visited</span><span class="info-value">{formatDuration(now - firstVisitTime())} ago</span></div>
    {/if}
    <div class="info-cell"><span class="info-label">Memory</span><span class="info-value">{formatBytes(info.memory)}</span></div>
    {#if info.cpuTime != null}
      <div class="info-cell"><span class="info-label">CPU time</span><span class="info-value">{(info.cpuTime / 1e6).toFixed(0)} ms</span></div>
    {/if}
    {#if visits.length > 0}
      <div class="info-cell"><span class="info-label">Total visits</span><span class="info-value">{visits.length}</span></div>
    {/if}
    {#if hasDuplicates}
      <div class="info-cell"><span class="info-label">Duplicates</span><span class="info-value">{duplicates.length}</span></div>
    {/if}
    {#if stats?.focusCount}
      <div class="info-cell"><span class="info-label">Times focused</span><span class="info-value">{stats.focusCount}</span></div>
    {/if}
    {#if stats?.focusDurationSeconds}
      <div class="info-cell"><span class="info-label">Time focused</span><span class="info-value">{formatDuration(stats.focusDurationSeconds * 1000)}</span></div>
    {/if}
    {#if openerLabel()}
      <div class="info-cell"><span class="info-label">Opened from</span><span class="info-value">{openerLabel()}</span></div>
    {/if}
    {#if info.parentDomId && info.parentTitle}
      <button
        type="button"
        class="info-cell info-cell-clickable"
        data-parent-dom-id={info.parentDomId}
        onmouseenter={() => onpreview?.({ domId: info.parentDomId || "" })}
        onmouseleave={() => onclearpreview?.()}
        onclick={() => onactivate?.({ domId: info.parentDomId || "" })}
      >
        <span class="info-label">Parent tab</span>
        <span class="info-value">
          {#if info.parentFavIconUrl}
            <img class="info-cell-favicon" src={info.parentFavIconUrl} alt="" />
          {/if}
          {info.parentTitle}
        </span>
      </button>
    {/if}
  </div>

  {#if hasDuplicates}
    <div class="info-section info-duplicates-section">
      <div class="info-section-header">
        <span class="info-section-title">Duplicate tabs ({duplicates.length})</span>
        <button type="button" class="info-close-others" onclick={() => oncloseothers?.()}>Close others</button>
      </div>
      <div class="info-duplicates-grid">
        {#each duplicates as duplicate, index (duplicate.domId)}
          {@const isSelf = duplicate.domId === info.domId}
          <button
            type="button"
            class="info-duplicate-row"
            class:dup-self={isSelf}
            data-dom-id={duplicate.domId}
            onmouseenter={() => onpreview?.(duplicate)}
            onmouseleave={() => onclearpreview?.()}
            onclick={() => {
              if (!isSelf) onduplicateactivate?.(duplicate, index);
            }}
          >
            <span class="dup-index">{index + 1}</span>
            <span class="dup-workspace">
              {#if duplicate.essential}
                <span class="tab-indicator essential" title="Essential">{@html iconHtml("svg:star")}</span>
              {:else if duplicate.pinned}
                <span class="tab-indicator pinned" title="Pinned">{@html iconHtml("svg:pin")}</span>
              {/if}
              {#if workspaceIcon(duplicate)}
                <span class="dup-ws-icon">{@html workspaceIcon(duplicate)}</span>
              {/if}
              {workspaceName(duplicate)}
              {#if isSelf}
                <span class="dup-ws-note">(this tab)</span>
              {/if}
            </span>
            <span class="dup-age">open for {duplicateAge(duplicate)}</span>
            {#if !isSelf}
              <span
                role="button"
                tabindex="-1"
                class="dup-close"
                title="Close tab"
                onkeydown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onclose?.(duplicate);
                }}
                onclick={(event) => {
                  event.stopPropagation();
                  onclose?.(duplicate);
                }}
              >✕</span>
            {:else}
              <span></span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if groupedVisits.length > 0}
    <div class="info-section">
      <div class="info-section-title">History</div>
      {#each groupedVisits as group (group.label)}
        <details class="info-date-details" open>
          <summary class="info-date-group">{group.label}</summary>
          <div class="info-history-table">
            {#each group.visits as visit (visit.visitTime)}
              {@const time = formatVisitTime(visit.visitTime)}
              <div class="info-history-row">
                <span class="info-history-date">{time.date}</span>
                <span class="info-history-time">{time.time}</span>
                <span class="info-history-event">{formatTransition(visit.transition)}</span>
              </div>
            {/each}
          </div>
        </details>
      {/each}
    </div>
  {/if}
{/if}
