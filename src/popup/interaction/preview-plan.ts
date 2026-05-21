import type { ViewId } from "../../shared/types";

export type PreviewPlanContext = {
  view: ViewId;
  selectedTabDomId?: string | null;
  selectedDuplicateTabDomId?: string | null;
  selectedDuplicatePromptDomId?: string | null;
};

export type PreviewPlan =
  | { kind: "preview"; domId: string }
  | { kind: "clear" }
  | { kind: "none" };

export function previewPlan(context: PreviewPlanContext): PreviewPlan {
  if (context.selectedTabDomId) return { kind: "preview", domId: context.selectedTabDomId };
  if (context.selectedDuplicateTabDomId) return { kind: "preview", domId: context.selectedDuplicateTabDomId };
  if (context.selectedDuplicatePromptDomId) return { kind: "preview", domId: context.selectedDuplicatePromptDomId };
  if (context.view === "duplicates" || context.view === "duplicate-prompt" || context.view === "actions") {
    return { kind: "clear" };
  }
  return { kind: "none" };
}
