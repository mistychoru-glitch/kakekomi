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
  out.push({
    id: "housing_consult_jiritsu",
    action: "お住まいの市区町村の「自立相談支援機関」に、家賃のことを相談する",
    caveat:
      "支援員が状況を聞いて、家賃を支える住居確保給付金など使える制度を一緒に探してくれます。制度には要件があるため、使えるかどうかは窓口で確認してください。",
    priority: 5,
  });
  return out;
}

function mortgageCandidates(state: StructuredState): CandidateAction[] {
  const p = state.personal;
  const out: CandidateAction[] = [];

  if (p.mortgage_auction_started) {
    out.push({
      id: "mortgage_auction_urgent",
      action: "至急、法テラスや弁護士に相談する（競売の手続きが始まっている場合）",
      caveat:
        "競売は手続きが進み続けるため、時間が限られます。取れる手段や期限は個別の状況で変わるので、断定はできません。早いほど選択肢が残ります。",
      priority: 1,
    });
  }
  if (p.notice_type_unknown) {
    out.push({
      id: "mortgage_confirm_notice_type",
      action: "届いた書面の種類を確認する（督促状／催告書／一括返済の通知／競売の通知）",
      caveat:
        "書面によって、残された時間と取れる手段が大きく変わります。送り主（借入先か、保証会社か、裁判所か）も一緒に確認してください。",
      priority: 1,
    });
  }
  if (p.mortgage_acceleration_notified && !p.mortgage_auction_started) {
    out.push({
      id: "mortgage_acceleration_contact",
      action: "借入先と保証会社に、今の状況と今後の手続きの見通しを確認する。あわせて法テラスなどにも相談する",
      caveat:
        "一括返済を求められる段階では、そのあと保証会社が代わりに払い、競売の申立てに進むことが多いとされています（期間は契約や会社で異なります）。連絡を避けるより、早く動いた方が選択肢が残ります。",
      priority: 2,
    });
  }
  if (!p.mortgage_acceleration_notified && !p.mortgage_auction_started) {
    out.push({
      id: "mortgage_consult_lender",
      action: "借入先（銀行など）に、返済条件の変更を早めに相談する",
      caveat:
        "返済期間の延長や、一定期間の返済額の見直しに応じてくれる場合があります。応じるかどうかは金融機関の判断で、総返済額が増えることもあります。滞納が長引くほど、選べる方法は減ります。",
      priority: 2,
    });
  }
  out.push({
    id: "mortgage_consult_legal",
    action: "法テラスなどで、住宅ローンの整理の方法（任意売却・個人再生など）を相談する",
    caveat:
      "任意売却は、競売より高く売れる場合がありますが、合意や条件が必要です。個人再生は、要件を満たせば住宅を残せる場合があります。どれが合うかは弁護士に確認してください。任意売却を扱う不動産会社は、費用と契約内容を必ず確かめ、中立の専門家にも相談してから選んでください。",
    priority: 3,
  });
  return out;
}

function hasTaxArrears(state: StructuredState): boolean {
  const p = state.personal;
  return (
    p.sub_category.includes("tax_or_insurance_arrears") ||
    !!(p.arrears_national_tax || p.arrears_local_tax || p.arrears_health_insurance || p.arrears_pension)
  );
}

function taxCandidates(state: StructuredState): CandidateAction[] {
  const p = state.personal;
  const out: CandidateAction[] = [];

  if (p.tax_seizure_notice) {
    out.push({
      id: "tax_seizure_contact_now",
      action: "至急、届いた書面の送り主（税務署・市区町村・年金事務所など）に連絡して、分割や猶予の相談をする",
      caveat:
        "差押えは、給与や預金などに及ぶことがあります。連絡して事情を伝えると、納める方法を一緒に考えてもらえる場合があります。要件があり、断定はできませんが、早いほど選択肢が残ります。",
      priority: 1,
    });
  }
  if (p.notice_type_unknown) {
    out.push({
      id: "tax_confirm_notice_type",
      action: "届いた書面の種類と送り主を確認する（納付書／督促状／差押えの予告、税務署か市区町村か年金事務所か）",
      caveat: "書面によって、残された時間と相談先が変わります。書面の連絡先に書かれた担当窓口が、最初の相談先です。",
      priority: 1,
    });
  }
  if (p.arrears_national_tax) {
    out.push({
      id: "tax_national_consult",
      action: "税務署に、納税の猶予・分割納付（換価の猶予）の相談をする",
      caveat:
        "事業や生活の維持が難しくなる場合などに、要件を満たせば、待ってもらえたり分割で納められたりすることがあります。申請できる期間が決まっているものがあるので、早めに。使えるかは税務署で確認してください。",
      priority: 2,
    });
  }
  if (p.arrears_local_tax) {
    out.push({
      id: "tax_local_consult",
      action: "お住まいの市区町村の税の窓口（納税課・収納課など）に、分割や猶予の相談をする",
      caveat: "制度や運用は自治体ごとに異なります。滞納が続くと、給与や預金の差押えに進むことがあります。",
      priority: 2,
    });
  }
  if (p.arrears_health_insurance) {
    out.push({
      id: "tax_health_insurance_consult",
      action: "市区町村の国民健康保険の窓口に、保険料の減免や分割などを相談する",
      caveat:
        "特別な事情があるときは、減免や納付の猶予が受けられる場合があります。滞納が続くと、保険証の扱いや、医療費の自己負担に影響が出ることがあります。",
      priority: 2,
    });
  }
  if (p.arrears_pension) {
    out.push({
      id: "tax_pension_exemption",
      action: "年金事務所か、市区町村の国民年金の窓口で、保険料の免除・納付猶予を申請する",
      caveat:
        "申請して承認されると、納付が免除・猶予されます。さかのぼって申請できる期間には限りがあります。本人の所得だけでなく、世帯主や配偶者の所得も審査されます。猶予の期間は、年金額には反映されません。",
      priority: 2,
    });
  }
  const kindKnown =
    p.arrears_national_tax || p.arrears_local_tax || p.arrears_health_insurance || p.arrears_pension;
  if (!kindKnown && !p.tax_seizure_notice && !p.notice_type_unknown) {
    out.push({
      id: "tax_consult_office",
      action: "届いた書面の送り主の窓口（税務署・市区町村・年金事務所）に、分割や猶予の相談をする",
      caveat:
        "どの税金や保険料かで窓口が変わります。書面に書かれた担当窓口に、まず連絡してください。連絡を避けるほど、選べる方法は減ります。",
      priority: 2,
    });
  }
  out.push({
    id: "tax_not_discharged",
    action: "税金や保険料は、借金の整理（自己破産など）では、一般に免除されないことを知っておく",
    caveat:
      "借金と同じ方法では消えないのが一般的です。だからこそ、窓口で分割や猶予を早めに相談することが大切です。個別の扱いは、弁護士などに確認してください。",
    priority: 3,
  });
  out.push({
    id: "tax_consult_jiritsu",
    action: "生活全体が苦しいときは、市区町村の自立相談支援機関にも相談する",
    caveat: "支援員が家計や暮らし全体を一緒に整理してくれます。税や保険料の窓口への相談と、並行して使えます。",
    priority: 4,
  });
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
  out.push({
    id: "debt_consult_houterasu",
    action: "法テラス（0570-078374）に電話して、借金について相談できる窓口を案内してもらう",
    caveat:
      "収入などの要件を満たせば、無料の法律相談や弁護士費用の立替を受けられることがあります。どの方法が合うかは、専門家に確認してから決めます。",
    priority: 5,
  });
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
    if (state.personal.sub_category.includes("mortgage")) {
      all = all.concat(mortgageCandidates(state));
    }
    if (state.personal.sub_category.includes("debt")) {
      all = all.concat(debtCandidates(state));
    }
  } else if (state.category === "business") {
    all = all.concat(businessCandidates(state));
  }
  // 税・保険料の滞納は、個人でも事業でも、同じ窓口と制度になる
  if (hasTaxArrears(state)) {
    all = all.concat(taxCandidates(state));
  }

  // 既出の候補は除外（presented_actions と id で重複判定）
  const fresh = all.filter((c) => !state.presented_actions.includes(c.id));
  fresh.sort((a, b) => a.priority - b.priority);

  const limit = state.psychological_state === "panic" ? 1 : 3;
  return fresh.slice(0, limit);
}
