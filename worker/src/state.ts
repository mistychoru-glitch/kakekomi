import type { StructuredState } from "./types";

const PERSONAL_KEYS = new Set([
  "has_children",
  "debt_count",
  "notice_type_unknown",
  "legal_proceeding_confirmed",
  "welfare_rejected_due_to_capacity",
  "rent_above_regional_cap_suspected",
  "cannot_afford_moving_cost",
  "collection_fear_strong",
  "already_consulted_no_resolution",
  "checked_credit_bureau_total_unclear",
]);

const BUSINESS_KEYS = new Set(["payroll_urgency", "existing_advisors"]);

const COMMON_KEYS = new Set([
  "category",
  "urgency_level",
  "psychological_state",
]);

/**
 * LLMの抽出結果（差分）を既存の構造化状態にマージする。
 * 未回答項目はキー自体が来ないので、既存値を上書きしない（null化しない）。
 */
export function mergeStatePatch(
  state: StructuredState,
  patch: Record<string, unknown>
): StructuredState {
  const next: StructuredState = structuredClone(state);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;

    if (COMMON_KEYS.has(key)) {
      (next as Record<string, unknown>)[key] = value;
    } else if (key === "sub_category" && Array.isArray(value)) {
      const merged = new Set([...next.personal.sub_category, ...value]);
      next.personal.sub_category = Array.from(merged) as typeof next.personal.sub_category;
    } else if (PERSONAL_KEYS.has(key)) {
      (next.personal as unknown as Record<string, unknown>)[key] = value;
    } else if (BUSINESS_KEYS.has(key)) {
      (next.business as unknown as Record<string, unknown>)[key] = value;
    }
  }

  return next;
}

export function markActionsPresented(
  state: StructuredState,
  actionIds: string[]
): StructuredState {
  const next: StructuredState = structuredClone(state);
  const merged = new Set([...next.presented_actions, ...actionIds]);
  next.presented_actions = Array.from(merged);
  return next;
}
