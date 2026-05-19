export type DuplicatePromptData = {
  url: string;
  domId: string | null;
  selectedIndex: number;
};

export function loadDuplicatePromptView(params: URLSearchParams): DuplicatePromptData {
  return {
    url: params.get("url") || "",
    domId: params.get("domId"),
    selectedIndex: -1,
  };
}
