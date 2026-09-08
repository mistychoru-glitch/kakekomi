// 構造化状態（kakekomi-counselor SKILL.md 4章）。
// すべて「埋まったら使う」任意項目。未回答のまま会話が進んでも構わない。

export type Category = "personal" | "business" | "unclear";
export type UrgencyLevel = "crisis" | "urgent" | "steady" | "unknown";
export type PsychologicalState = "panic" | "anxious" | "calm" | "unknown";

export type PersonalSubCategory =
  | "debt"
  | "housing"
  | "income_loss"
  | "tax_or_insurance_arrears"
  | "other";

export interface CommonHeader {
  category: Category;
  urgency_level: UrgencyLevel;
  psychological_state: PsychologicalState;
  already_consulted: string[]; // 既に相談済みの窓口とその結果
  presented_actions: string[]; // 提示済みの行動指針のログ（重複提示防止）
}

export interface PersonalState {
  sub_category: PersonalSubCategory[];
  notice_received: string | null; // 督促・差し押さえ予告の有無と期限
  monthly_income_estimate: string | null;
  income_type: string | null;
  debt_count: number | null;
  monthly_repayment_total: string | null;
  rent_amount: string | null;
  area: string | null;
  family_composition: string | null;
  has_children: boolean | null;
  // debt サブ状態の補助フラグ（ルールエンジンで参照）
  collection_fear_strong: boolean | null;
  already_consulted_no_resolution: boolean | null;
  checked_credit_bureau_total_unclear: boolean | null;
  // housing サブ状態の補助フラグ
  notice_type_unknown: boolean | null; // 大家督促か裁判所書面か不明
  legal_proceeding_confirmed: boolean | null; // 訴訟・強制執行段階
  welfare_rejected_due_to_capacity: boolean | null; // 稼働能力等を理由に生活保護却下
  rent_above_regional_cap_suspected: boolean | null;
  cannot_afford_moving_cost: boolean | null;
}

export interface BusinessState {
  cash_runway: string | null;
  critical_deadline: string | null;
  debt_types: string | null;
  revenue_trend: string | null;
  employee_count: number | null;
  payroll_urgency: boolean | null;
  existing_advisors: string | null;
  funding_prospects: string | null;
}

export interface StructuredState extends CommonHeader {
  personal: PersonalState;
  business: BusinessState;
}

export interface CandidateAction {
  id: string;
  action: string; // 提示する行動指針
  caveat: string; // 添える注意点
  priority: number; // 小さいほど優先度が高い
}

export function createInitialState(): StructuredState {
  return {
    category: "unclear",
    urgency_level: "unknown",
    psychological_state: "unknown",
    already_consulted: [],
    presented_actions: [],
    personal: {
      sub_category: [],
      notice_received: null,
      monthly_income_estimate: null,
      income_type: null,
      debt_count: null,
      monthly_repayment_total: null,
      rent_amount: null,
      area: null,
      family_composition: null,
      has_children: null,
      collection_fear_strong: null,
      already_consulted_no_resolution: null,
      checked_credit_bureau_total_unclear: null,
      notice_type_unknown: null,
      legal_proceeding_confirmed: null,
      welfare_rejected_due_to_capacity: null,
      rent_above_regional_cap_suspected: null,
      cannot_afford_moving_cost: null,
    },
    business: {
      cash_runway: null,
      critical_deadline: null,
      debt_types: null,
      revenue_trend: null,
      employee_count: null,
      payroll_urgency: null,
      existing_advisors: null,
      funding_prospects: null,
    },
  };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  message: string;
  history: ChatTurn[];
  state: StructuredState;
}

export interface ChatResponseBody {
  reply: string;
  state: StructuredState;
  candidateActions: CandidateAction[];
  safetyTriggered: boolean;
}
