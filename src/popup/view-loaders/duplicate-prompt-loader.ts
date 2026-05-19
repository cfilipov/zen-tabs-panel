export type DuplicatePromptData = {
  url: string;
  domId: string | null;
  selectedIndex: number;
};

export type DuplicatePromptParams = URLSearchParams | Record<string, unknown>;

function paramValue(params: DuplicatePromptParams, key: "url" | "domId") {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  return typeof value === "string" ? value : null;
}

export function loadDuplicatePromptView(params: DuplicatePromptParams): DuplicatePromptData {
  return {
    url: paramValue(params, "url") || "",
    domId: paramValue(params, "domId"),
    selectedIndex: -1,
  };
}
