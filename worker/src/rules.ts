// 優先順位付けロジック（SKILL.md 5章）。ルールベース（if/else）で判断し、
// LLMには言い回しの生成だけを担わせる。MVPでは個人/housing・個人/debt・
// 事業（簡易版）のみ実装する。

import type { CandidateAction, StructuredState } from "./types";

function housingCandidates(state: StructuredState): CandidateAction[] {
  const p = state.personal;
  const out: CandidateAction[] = [];

  if (p.notice_type_unknown) {
    out.push({
      id: "housing_confirm_notice_type",
      action: "まず通知の種類を確認する",
      caveat: "督促状＝即退去義務ではないことが多いです。",
      priority: 1,
    });
  }
  if (p.legal_proceeding_confirmed) {
    out.push({
      id: "housing_legal_urgent",
      action: "至急、法テラス／自治体の居住支援窓口へ相談する",
      caveat: "訴訟・強制執行の段階にある場合、早期の専門家介入が必須です。",
      priority: 1,
    });
  }
  if (p.welfare_rejected_due_to_capacity) {
    out.push({
      id: "housing_alt_program",
      action: "住居確保給付金など、生活保護とは要件の異なる制度を検討する",
      caveat:
        "住居確保給付金は「離職・廃業」または「本人の責によらない収入減少で離職と同程度の状況」が対象です。単に収入が低いだけでは対象外の可能性があり、断定はできません。",
      priority: 2,
    });
  }
  if (p.has_children) {
    out.push({
      id: "housing_school_support",
      action: "就学援助制度も選択肢として検討する",
      caveat: "断定はできないので、あくまで検討材料としてお伝えします。",
      priority: 3,
    });
  }
  if (p.rent_above_regional_cap_suspected) {
    out.push({
      id: "housing_rent_negotiation",
      action: "家賃減額交渉や住み替え支援も選択肢に含める",
      caveat:
        "「今の住まいを維持したまま」の解決が難しい場合があることも、あわせて正直にお伝えします。",
      priority: 3,
    });
  }
  if (p.cannot_afford_moving_cost) {
    out.push({
      id: "housing_moving_cost_support",
      action:
        "自治体によっては住居確保給付金の「転居費用補助」が使える場合がある（家計改善支援の利用が前提）",
      caveat: "自治体ごとに制度の有無・要件が異なるため、要確認です。",
      priority: 4,
    });
  }
  return out;
}

function debtCandidates(state: StructuredState): CandidateAction[] {
  const p = state.personal;
  const out: CandidateAction[] = [];

  if (p.collection_fear_strong) {
    out.push({
      id: "debt_collection_rules",
      action:
        "取り立てには法律上のルールがあり、弁護士等の介入ですぐ止められることを伝える",
      caveat: "貸金業法上の規制が土台です。個別の状況で対応は変わります。",
      priority: 1,
    });
  }
  if ((p.debt_count ?? 0) >= 2 || p.monthly_repayment_total) {
    out.push({
      id: "debt_options_comparison",
      action:
        "任意整理・個人再生・自己破産の違いを、メリットとデメリット両方でフラットに提示する",
      caveat:
        "各手法の条件は個別事情で変わります。特定の選択肢が自動的に優れているような印象は与えません。最終判断は専門家との相談に委ねます。",
      priority: 2,
    });
  }
  if (p.already_consulted_no_resolution) {
    out.push({
      id: "debt_alternate_channel",
      action: "同じ窓口ではなく、別の切り口（FP相談等）を提案する",
      caveat: "同じ場所に何度も足を運ばせない配慮です。",
      priority: 2,
    });
  }
  if (p.checked_credit_bureau_total_unclear) {
    out.push({
      id: "debt_bureau_limitation",
      action:
        "JICC/CIC等の開示は貸金業者中心で、家賃の未払い・個人間の借金・税金滞納等は反映されないことがあると伝え、当時の管理会社等への直接確認を案内する",
      caveat: "全ての負債を網羅するとは限らないという限界を明示します。",
      priority: 3,
    });
  }
  return out;
}

function businessCandidates(state: StructuredState): CandidateAction[] {
  const b = state.business;
  const out: CandidateAction[] = [];

  if (b.payroll_urgency) {
    out.push({
      id: "business_cashflow_urgent",
      action:
        "資金繰り表の緊急整理と、セーフティネット貸付等の緊急融資制度の確認を最優先に行う",
      caveat: "給与支払い等の期限が迫っている場合、最優先で動く必要があります。",
      priority: 1,
    });
  }
  if (!b.existing_advisors) {
    out.push({
      id: "business_free_consultation",
      action: "商工会議所・よろず支援拠点など、無料相談窓口につなぐ",
      caveat: "既存の相談先がない場合にまず検討する選択肢です。",
      priority: 2,
    });
  }
  return out;
}

/**
 * 心理状態がパニック寄りなら候補を1つだけ、落ち着いていれば最大3つまでに絞る。
 * （SKILL.md 5章）
 */
export function selectCandidateActions(
  state: StructuredState
): CandidateAction[] {
  let all: CandidateAction[] = [];
  if (state.category === "personal") {
    if (state.personal.sub_category.includes("housing")) {
      all = all.concat(housingCandidates(state));
    }
    if (state.personal.sub_category.includes("debt")) {
      all = all.concat(debtCandidates(state));
    }
  } else if (state.category === "business") {
    all = all.concat(businessCandidates(state));
  }

  // 既出の候補は除外（presented_actions と id で重複判定）
  const fresh = all.filter((c) => !state.presented_actions.includes(c.id));
  fresh.sort((a, b) => a.priority - b.priority);

  const limit = state.psychological_state === "panic" ? 1 : 3;
  return fresh.slice(0, limit);
}
