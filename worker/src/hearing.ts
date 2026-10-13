// ヒアリングの段階を、コードで決める（AIの気分に任せない）。
// 状況が十分に分かるまでは、窓口・電話番号・リンクを出さず、質問を1つずつ聞く。
// 聞きすぎて負担にならないよう、相談者の3通目では、必ず次の一歩を伝える。
// 期限や差押えが迫っているときと、相談先を教えてほしいと言われたときは、すぐに伝える。

import type { StructuredState } from "./types.ts";

export interface HearingPlan {
  ready: boolean; // true なら、窓口や次の一歩を出してよい
  reason: string; // 判断の理由（テスト・ログ用）
  focus: string | null; // ready でないとき、次に1つだけ聞くこと
}

// 相談者の何通目で、必ず次の一歩を出すか
export const MAX_LISTENING_USER_TURNS = 3;
// 状況が分かったとみなす、聞けた項目の数。1通目は2つ、2通目以降は1つ分かれば出す
// （同じことを繰り返し聞かない。質問は多くても1〜2回で済ませる）
const ENOUGH_FACTS_FIRST = 2;
const ENOUGH_FACTS_AFTER = 1;

// 「窓口を教えて」「どこに電話すればいい？」など、相談先をはっきり求めている言い回し
const CONTACT_REQUEST =
  /(窓口|電話番号|連絡先|相談先|番号).{0,10}(教え|知りたい|どこ)|どこに(連絡|電話|相談|行け|かけ)|どこへ(連絡|電話|相談)|どこで相談|誰に(相談|連絡|電話)|どうなる|どうなっ|どうなり|現実的|見通し|可能性|取り戻せ|戻ってくる|戻る(の|可能)/;

function isKnown(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

type Field = [known: unknown, ask: string];

// 迫っている状況（遅らせると不利になる）。この場合は、聞き取りより先に伝える。
function isUrgent(s: StructuredState): boolean {
  const p = s.personal;
  return (
    p.mortgage_auction_started === true ||
    p.mortgage_acceleration_notified === true ||
    p.legal_proceeding_confirmed === true ||
    p.tax_seizure_notice === true ||
    s.business.payroll_urgency === true
  );
}

// どれか1つでも分かっていれば true、どれも分かっていなければ null（false は「分かった」の扱いになるため）
function anyKnown(...vs: unknown[]): true | null {
  return vs.some(isKnown) ? true : null;
}

// 話題ごとに「次に聞くこと」を、聞く順に並べる。
function hearingFields(s: StructuredState): Field[] {
  const p = s.personal;
  const b = s.business;
  const income: Field = [
    anyKnown(p.income_type, p.monthly_income_estimate),
    "いまの収入の状況（働けているか、収入が減ったか）。金額まで聞かなくてよい",
  ];
  const area: Field = [p.area, "お住まいの市区町村（相談できる窓口を案内するため）"];

  if (s.category === "business") {
    return [
      [b.critical_deadline, "いちばん近い支払いや返済の期限と、その内容"],
      [b.cash_runway, "手元の資金で、あとどのくらいもちそうか"],
      [b.revenue_trend, "売上が最近どう動いているか"],
    ];
  }
  const subs = p.sub_category;
  if (subs.includes("mortgage")) {
    return [
      [p.mortgage_months_behind, "住宅ローンを、何か月くらい遅れているか"],
      [p.mortgage_acceleration_notified, "銀行から、全額を一括で返すよう求める書面が届いているか"],
      income,
    ];
  }
  if (subs.includes("tax_or_insurance_arrears")) {
    return [
      [
        anyKnown(p.arrears_national_tax, p.arrears_local_tax, p.arrears_health_insurance, p.arrears_pension),
        "遅れているのが、どの税金や保険料か（住民税、国民健康保険、年金など）",
      ],
      [p.tax_seizure_notice, "差押えの予告や通知が届いているか"],
      area,
    ];
  }
  if (subs.includes("housing")) {
    return [
      [p.notice_received, "届いている書面の差出人（大家さん・管理会社か、裁判所など）と、期限があるか"],
      income,
      area,
    ];
  }
  if (subs.includes("debt")) {
    return [
      [anyKnown(p.debt_count, p.monthly_repayment_total), "借入先がいくつあるか（金額は、言いにくければ聞かなくてよい）"],
      [p.notice_received, "督促や通知が届いているか、期限があるか"],
      income,
    ];
  }
  return [
    [p.income_type, "いまの収入の状況（働けているか、収入が減ったか）"],
    area,
  ];
}

export function planHearing(
  state: StructuredState,
  userTurns: number,
  latestUserMessage: string,
  topicNotesAvailable = false
): HearingPlan {
  if (state.presented_actions.length > 0) {
    return { ready: true, reason: "already_presented", focus: null };
  }
  if (isUrgent(state)) return { ready: true, reason: "urgent", focus: null };
  // 確かな一般知識がある話題（給料の未払いなど）は、状況の聞き取りより先に、見通しを伝える
  if (topicNotesAvailable) return { ready: true, reason: "asked_for_contact", focus: null };
  if (CONTACT_REQUEST.test(latestUserMessage)) return { ready: true, reason: "asked_for_contact", focus: null };
  if (userTurns >= MAX_LISTENING_USER_TURNS) {
    return { ready: true, reason: "enough_turns", focus: null };
  }

  const topicKnown =
    state.category === "business" ||
    (state.category === "personal" && state.personal.sub_category.length > 0);
  if (!topicKnown) {
    return {
      ready: false,
      reason: "topic_unknown",
      focus: "どんなことで困っているか（家賃、住宅ローン、借金、税金、事業など）。ざっくりで大丈夫",
    };
  }

  const fields = hearingFields(state);
  const known = fields.filter(([v]) => isKnown(v)).length;
  const needed = userTurns >= 2 ? ENOUGH_FACTS_AFTER : ENOUGH_FACTS_FIRST;
  if (known >= needed) return { ready: true, reason: "enough_facts", focus: null };
  const next = fields.find(([v]) => !isKnown(v));
  return { ready: false, reason: "need_facts", focus: next ? next[1] : null };
}
