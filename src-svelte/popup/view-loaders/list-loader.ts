import type {
  DomainIndexRow,
  TabIndexRow,
  TabIndexView,
  ViewWindow,
  createTabIndexClient,
} from "../runtime/tab-index-client";

export type NativeListRow = TabIndexRow | DomainIndexRow;
export type TabIndexClient = ReturnType<typeof createTabIndexClient>;

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
  return client.getWindow<Row>(
    request.view,
    request.offset,
    request.limit,
    request.params ?? {},
  );
}
