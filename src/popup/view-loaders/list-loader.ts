import type {
  DomainIndexRow,
  RecentsViewModel,
  TabIndexRow,
  TabIndexView,
  ViewWindow,
  createTabIndexClient,
} from "../runtime/tab-index-client";

export type NativeListRow = TabIndexRow | DomainIndexRow;
export type TabIndexClient = ReturnType<typeof createTabIndexClient>;
const FAVICON_REF_PREFIX = "ztt-favicon:";

export type ListWindowRequest = {
  view: TabIndexView;
  offset: number;
  limit: number;
  params?: Record<string, unknown>;
};

export async function loadNativeListWindow<Row extends NativeListRow = NativeListRow>(
  client: TabIndexClient,
  request: ListWindowRequest,
): Promise<ViewWindow<Row>> {
  await client.ensureStarted();
  const win = await client.getWindow<Row>(
    request.view,
    request.offset,
    request.limit,
    request.params ?? {},
  );
  if (!win.favicons) return win;
  return {
    ...win,
    rows: resolveWindowFavicons(win.rows, win.favicons) as Row[],
  };
}

export async function loadRecentsViewModelWindow(
  client: TabIndexClient,
  request: Omit<ListWindowRequest, "view">,
): Promise<RecentsViewModel> {
  await client.ensureStarted();
  const win = await client.getRecentsViewModel(
    request.offset,
    request.limit,
    request.params ?? {},
  );
  return {
    ...win,
    rows: resolveWindowFavicons(win.rows, win.favicons) as TabIndexRow[],
  };
}

function resolveWindowFavicons<Row extends NativeListRow>(
  rows: readonly Row[],
  favicons?: Record<string, string>,
) {
  if (!favicons) return rows.slice();
  return rows.map((row) => {
    if (!("favIconUrl" in row) || typeof row.favIconUrl !== "string") return row;
    if (!row.favIconUrl.startsWith(FAVICON_REF_PREFIX)) return row;
    const key = row.favIconUrl.slice(FAVICON_REF_PREFIX.length);
    const favIconUrl = favicons[key];
    return favIconUrl ? { ...row, favIconUrl } : { ...row, favIconUrl: "" };
  });
}
