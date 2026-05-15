import type { ViewId } from "../../shared/types";

export type WorkspaceFilter = "all" | string;

export type WorkspaceInfo = {
  name: string;
  svgContent?: string;
};

export type RowItem = {
  id?: string;
  domId?: string;
  sessionId?: string;
  domain?: string;
  uuid?: string;
  hotkey?: string;
  disabled?: boolean;
  [key: string]: unknown;
};

export type HeaderState = {
  title: string;
  hint: string | null;
};

export type PopupState = {
  currentView: ViewId;
  selectedIndex: number;
  items: RowItem[];
  sectionStarts: number[];
  sidebarFocused: boolean;
  sidebarSelectedIndex: number;
  currentPage: number;
  pageCount: number;
  pageBounds: Array<[number, number]>;
  header: HeaderState;
  workspaceMap: Record<string, WorkspaceInfo>;
  activeWorkspaceId: string | null;
  workspaceFilter: WorkspaceFilter;
};
