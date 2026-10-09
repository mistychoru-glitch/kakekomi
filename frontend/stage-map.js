// 「いまここ」の段階図。滞納が進む一般的な流れの上に、いまの位置の目安と、その段階で取れる手を出す。
// 位置と文面は、状況（構造化状態）から、コード側の決まったルールで作る（AIは使わない）。
// 期間や手続きは、契約や会社、自治体で異なるので、すべて「目安」「一般に」と添える。通信はしない。

(function (root) {
  const MAPS = {
    mortgage: {
      title: "住宅ローンの滞納が進む、一般的な流れ（目安）",
      stages: [
        { label: "返済が遅れ始める", note: "督促の連絡や、督促状が届く" },
        { label: "催告書が届く", note: "督促状より強い言葉の、最後の通告" },
        { label: "一括返済の請求（期限の利益の喪失）", note: "滞納がおおむね半年ほど続くと、残りの全額を一括で求められる" },
        { label: "保証会社が代わりに払う（代位弁済）", note: "請求先が、保証会社に変わる" },
        { label: "競売の申立て・開始", note: "代位弁済のあと、早ければ半月〜1か月ほどで申し立てられることがある" },
        { label: "入札・売却、立ち退き", note: "市場の価格より低く売れることが多く、残った借金は払い続ける" },
      ],
      options: [
        ["借入先に、返済条件の変更を相談する。この段階が、選べる方法がいちばん多い", "応じるかどうかは金融機関の判断。総返済額が増えることもある"],
        ["借入先に、返済条件の変更を、すぐ相談する。あわせて、法テラスなどの専門家にも相談する", "遅れが長引くほど、選べる方法は減る"],
        ["借入先と保証会社に、今後の手続きの見通しを確認する", "法テラスや弁護士に、任意売却・個人再生などを相談する"],
        ["弁護士・法テラスに、早めに相談する", "手続きには、期限があるものがある。個別の状況は、専門家に確認する"],
        ["至急、弁護士・法テラスに相談する", "任意売却を考えるなら、競売が進む前に動くことが重要とされる"],
        ["弁護士・法テラスに相談する。売却のあとに残る借金の扱いも、確認する", "状況は、個別に違う。早く相談するほど、確認できることが多い"],
      ],
      foot: "期間や手続きは、契約や会社で異なります。実際の状況は、借入先や専門家に確認してください。",
    },
    housing: {
      title: "家賃の滞納が進む、一般的な流れ（目安）",
      stages: [
        { label: "支払いが遅れる", note: "大家さんや管理会社から、連絡が来る" },
        { label: "督促状・催告書が届く", note: "支払いを求める書面" },
        { label: "契約の解除の通知", note: "内容証明郵便などで、契約を解除すると伝えられることがある" },
        { label: "明渡しを求める裁判", note: "裁判所から書面が届く。無視しない" },
        { label: "判決・強制執行", note: "裁判の結果にしたがって、明渡しの手続きが進む" },
      ],
      options: [
        ["大家さん・管理会社に、早めに事情を伝えて、払える時期を相談する", "市区町村の自立相談支援機関で、家賃を支える制度（住居確保給付金など）を相談する"],
        ["書面の送り主に連絡して、払える時期と方法を相談する", "自立相談支援機関に、制度を相談する。使えるかは要件による"],
        ["至急、法テラスや自立相談支援機関に相談する", "通知の内容と期限を確認する。書面は、捨てずに取っておく"],
        ["至急、法テラスに相談する。裁判所からの書面は、無視しない", "期限内に対応しないと、不利になることがある"],
        ["法テラスや、弁護士に相談する", "手続きは、個別の状況で変わる"],
      ],
      foot: "家賃の滞納で、すぐに追い出されるとは限りません。手続きや期間は、契約や状況で異なるので、専門家や窓口に確認してください。",
    },
    tax: {
      title: "税金・保険料の滞納が進む、一般的な流れ（目安）",
      stages: [
        { label: "納期限を過ぎる", note: "納付書や、納付の案内が届く" },
        { label: "督促状が届く", note: "督促を受けても払わないと、差押えに進むことがある" },
        { label: "差押えの予告", note: "財産を差し押さえる前の、最後の連絡" },
        { label: "差押え", note: "給与や預金などが、差し押さえられる" },
        { label: "取り立て・売却", note: "差し押さえられた財産が、取り立てや売却にあてられる" },
      ],
      options: [
        ["書面の送り主（税務署・市区町村・年金事務所）に連絡して、分割や猶予を相談する", "猶予の制度には、申請できる期間があるものがある。早いほど、選べる方法が多い"],
        ["すぐに、書面の送り主に連絡して、分割や猶予を相談する", "連絡せずに待つほど、差押えに近づく"],
        ["至急、書面の送り主に連絡して、分割や猶予を相談する", "差押えの前に動くと、選べる方法が多い"],
        ["書面の送り主に連絡して、今後の納め方を相談する。法テラスなどにも相談する", "どの財産が、どの範囲で差し押さえられたかを、書面で確認する"],
        ["書面の送り主と、法テラスなどの専門家に、早く相談する", "状況は、個別に違う。確認できることが、多い順に、まず連絡する"],
      ],
      foot: "税金や保険料は、借金の整理（自己破産など）では、一般に免除されません。だから、早く窓口に連絡することが大切です。手続きや期間は、税の種類や自治体で異なります。",
    },
  };

  function pickMapKey(state) {
    if (!state) return null;
    const p = state.personal || {};
    const subs = p.sub_category || [];
    if (subs.includes("mortgage")) return "mortgage";
    const hasTax =
      subs.includes("tax_or_insurance_arrears") ||
      p.arrears_national_tax ||
      p.arrears_local_tax ||
      p.arrears_health_insurance ||
      p.arrears_pension;
    if (hasTax && p.tax_seizure_notice) return "tax";
    if (subs.includes("housing")) return "housing";
    if (hasTax) return "tax";
    return null;
  }

  // いまの位置（0始まり）と、目安かどうか
  function hereFor(key, state) {
    const p = state.personal || {};
    const text = String(p.notice_received || "");
    let index = 0;
    let approx = false;

    if (key === "mortgage") {
      if (p.mortgage_auction_started || /競売/.test(text)) index = 4;
      else if (/代位弁済/.test(text)) index = 3;
      else if (p.mortgage_acceleration_notified || /一括|期限の利益/.test(text)) index = 2;
      else if (/催告/.test(text)) index = 1;
      else if (p.mortgage_months_behind >= 6) {
        index = 1;
        approx = true; // 半年ほどで、一括返済の請求に進むことがある
      } else if (p.mortgage_months_behind >= 3) index = 1;
      else index = 0;
    } else if (key === "housing") {
      if (p.legal_proceeding_confirmed || /訴訟|裁判|訴状|支払督促/.test(text)) index = 3;
      else if (/解除|内容証明/.test(text)) index = 2;
      else if (/督促|催告/.test(text)) index = 1;
      else index = 0;
    } else if (key === "tax") {
      if (/差押(え)?(を)?受け|差し押さえられ|差押えられ|差押えがあ/.test(text)) index = 3;
      else if (p.tax_seizure_notice || /差押/.test(text)) index = 2;
      else if (/督促/.test(text)) index = 1;
      else index = 0;
    }
    const known = key === "mortgage" ? p.mortgage_months_behind || p.mortgage_acceleration_notified || p.mortgage_auction_started || text : text || p.tax_seizure_notice || p.legal_proceeding_confirmed;
    if (!known) approx = true;
    return { index, approx };
  }

  function buildStageMap(state) {
    const key = pickMapKey(state);
    if (!key) return null;
    const map = MAPS[key];
    const { index, approx } = hereFor(key, state);
    const stages = map.stages.map((s, i) => ({
      label: s.label,
      note: s.note,
      status: i < index ? "past" : i === index ? "here" : "future",
    }));
    return {
      topic: key,
      title: map.title,
      stages,
      hereIndex: index,
      approx,
      hereLabel: approx ? "いまここ（目安）" : "いまここ",
      options: map.options[index],
      foot: map.foot,
    };
  }

  const api = { buildStageMap, pickMapKey, MAPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KakekomiStageMap = api;
})(typeof window !== "undefined" ? window : globalThis);
