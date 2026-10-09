import type { StructuredState } from "./types";

type FieldType = "boolean" | "integer" | "string";

const PERSONAL_FIELDS: Record<string, FieldType> = {
  has_children: "boolean",
  debt_count: "integer",
  notice_type_unknown: "boolean",
  legal_proceeding_confirmed: "boolean",
  welfare_rejected_due_to_capacity: "boolean",
  rent_above_regional_cap_suspected: "boolean",
  cannot_afford_moving_cost: "boolean",
  mortgage_months_behind: "integer",
  mortgage_acceleration_notified: "boolean",
  mortgage_auction_started: "boolean",
  arrears_national_tax: "boolean",
  arrears_local_tax: "boolean",
  arrears_health_insurance: "boolean",
  arrears_pension: "boolean",
  tax_seizure_notice: "boolean",
  collection_fear_strong: "boolean",
  already_consulted_no_resolution: "boolean",
  checked_credit_bureau_total_unclear: "boolean",
  rent_amount: "string",
  area: "string",
  notice_received: "string",
  monthly_income_estimate: "string",
  income_type: "string",
  monthly_repayment_total: "string",
  family_composition: "string",
};

const BUSINESS_FIELDS: Record<string, FieldType> = {
  payroll_urgency: "boolean",
  employee_count: "integer",
  existing_advisors: "string",
  cash_runway: "string",
  critical_deadline: "string",
  debt_types: "string",
  revenue_trend: "string",
  funding_prospects: "string",
};

const COMMON_ENUMS: Record<string, readonly string[]> = {
  category: ["personal", "business", "unclear"],
  urgency_level: ["crisis", "urgent", "steady", "unknown"],
  psychological_state: ["panic", "anxious", "calm", "unknown"],
};

const SUB_CATEGORIES = [
  "debt",
  "housing",
  "mortgage",
  "income_loss",
  "tax_or_insurance_arrears",
  "other",
];

const MAX_TEXT = 80;

// LLMの出力は信用せず、型・長さ・選択肢を確かめた値だけを採用する
// （画面やプロンプトにそのまま戻る値なので、想定外の内容が入り込まないようにする）。
function coerce(type: FieldType, value: unknown): boolean | number | string | undefined {
  switch (type) {
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "integer":
      return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;
    case "string": {
      if (typeof value !== "string") return undefined;
      const text = value.trim().slice(0, MAX_TEXT);
      return text ? text : undefined;
    }
  }
}

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

    if (key in COMMON_ENUMS) {
      if (typeof value === "string" && COMMON_ENUMS[key].includes(value)) {
        (next as unknown as Record<string, unknown>)[key] = value;
      }
    } else if (key === "sub_category") {
      if (Array.isArray(value)) {
        const valid = value.filter((v) => typeof v === "string" && SUB_CATEGORIES.includes(v));
        const merged = new Set([...next.personal.sub_category, ...valid]);
        next.personal.sub_category = Array.from(merged) as typeof next.personal.sub_category;
      }
    } else if (key in PERSONAL_FIELDS) {
      const v = coerce(PERSONAL_FIELDS[key], value);
      if (v !== undefined) (next.personal as unknown as Record<string, unknown>)[key] = v;
    } else if (key in BUSINESS_FIELDS) {
      const v = coerce(BUSINESS_FIELDS[key], value);
      if (v !== undefined) (next.business as unknown as Record<string, unknown>)[key] = v;
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
