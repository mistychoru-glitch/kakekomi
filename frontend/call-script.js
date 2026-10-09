// 「電話で話す内容」の台本を、いまの状況（構造化状態）から組み立てる。
// 文面はコード側の決まった型に、状況の値を当てはめるだけ（AIは使わない）。
// そのため、即座に出て、事実にない内容が混ざらない。電話番号は、確認済みの窓口の一覧にあるものだけを使う。

(function (root) {
  const TOPICS = {
    housing: {
      phrase: "家賃の滞納",
      target: "お住まいの市区町村の自立相談支援機関（役所の福祉窓口でも、場所を教えてもらえます）",
      resourceId: "jiritsu-soudan",
      asks: [
        "家賃の滞納で使える制度（住居確保給付金など）はありますか",
        "自分の収入で対象になるか、どんな書類が必要ですか",
        "大家さんや管理会社には、いつ、どう連絡するのがよいですか",
      ],
      prepare: ["届いた督促状などの書面", "賃貸借契約書", "収入が分かるもの（給与明細など）", "本人確認書類"],
    },
    mortgage: {
      phrase: "住宅ローンの返済",
      target: "住宅ローンの借入先（銀行など）の返済相談窓口",
      resourceId: "mortgage-lender",
      asks: [
        "返済条件の変更（返済期間の延長、一定期間の減額など）はできますか",
        "変更を申し込むとき、何が必要で、どれくらいかかりますか",
        "保証会社から連絡が来る見込みはありますか。来るとしたら、いつ頃ですか",
      ],
      prepare: ["届いた書面すべて", "住宅ローンの契約書・返済予定表", "収入と毎月の支出が分かるもの"],
    },
    mortgage_urgent: {
      phrase: "住宅ローンの滞納",
      target: "法テラス（サポートダイヤル）。あわせて、借入先と保証会社にも状況を確認します",
      resourceId: "houterasu",
      asks: [
        "住宅ローンの滞納で、一括返済の請求や競売の手続きが来ています。どんな方法が考えられますか（任意売却・個人再生など）",
        "無料の法律相談は使えますか。条件は何ですか",
        "今、急いでやるべきことは何ですか",
      ],
      prepare: [
        "届いた書面すべて（特に、裁判所や保証会社からのもの）",
        "住宅ローンの契約書",
        "収入・資産・ほかの借入が分かる一覧",
      ],
    },
    debt: {
      phrase: "借金の返済",
      target: "法テラス（サポートダイヤル）",
      resourceId: "houterasu",
      asks: [
        "借入が複数あって返済が苦しい場合、どんな整理の方法がありますか",
        "無料の法律相談や、費用の立替は使えますか",
        "今、貸金業者からの連絡には、どう対応すればよいですか",
      ],
      prepare: ["借入先と残高が分かるもの", "届いた督促状などの書面", "収入が分かるもの"],
    },
    business: {
      phrase: "事業の資金繰り",
      target: "日本政策金融公庫の事業資金相談ダイヤル、またはお住まいの地域のよろず支援拠点",
      resourceId: "jfc-jigyo",
      asks: [
        "資金繰りが厳しいときに使える融資や制度はありますか",
        "すでにある借入の、返済条件の変更は相談できますか",
        "資金繰り表は、どのように作ればよいですか",
      ],
      prepare: ["直近の売上と入出金が分かるもの", "借入の一覧", "今後2〜3か月の支払い予定"],
    },
  };

  function pickTopic(state) {
    if (!state) return null;
    const p = state.personal || {};
    const subs = p.sub_category || [];
    if (state.category === "business") return "business";
    if (subs.includes("mortgage")) {
      return p.mortgage_auction_started || p.mortgage_acceleration_notified ? "mortgage_urgent" : "mortgage";
    }
    if (subs.includes("housing")) return "housing";
    if (subs.includes("debt")) return "debt";
    return null;
  }

  function factLines(topic, state) {
    const p = state.personal || {};
    const b = state.business || {};
    const out = [];
    const add = (text) => {
      if (text) out.push(`・${text}`);
    };
    const income = [p.monthly_income_estimate, p.income_type].filter(Boolean).join("、");

    if (topic === "housing") {
      add(p.rent_amount && `家賃は${p.rent_amount}です`);
      add(p.area && `住んでいるのは${p.area}です`);
      add(p.notice_received && `届いているのは、${p.notice_received}です`);
      add(income && `収入は、${income}です`);
      add(p.family_composition && `家族は、${p.family_composition}です`);
    } else if (topic === "mortgage" || topic === "mortgage_urgent") {
      add(p.mortgage_months_behind && `住宅ローンを${p.mortgage_months_behind}か月、滞納しています`);
      add(p.notice_received && `届いているのは、${p.notice_received}です`);
      // 届いた書面の説明にすでに「一括」が入っているときは、同じことを2回書かない
      add(p.mortgage_acceleration_notified && !String(p.notice_received || "").includes("一括") && "一括で返すよう求める通知が届いています");
      add(p.mortgage_auction_started && "競売の手続きが始まっています");
      add(income && `収入は、${income}です`);
      add(p.family_composition && `家族は、${p.family_composition}です`);
    } else if (topic === "debt") {
      add(p.debt_count && `借入は${p.debt_count}件あります`);
      add(p.monthly_repayment_total && `毎月の返済は、${p.monthly_repayment_total}です`);
      add(p.notice_received && `届いているのは、${p.notice_received}です`);
      add(income && `収入は、${income}です`);
    } else if (topic === "business") {
      add(b.employee_count && `従業員は${b.employee_count}人です`);
      add(b.cash_runway && `資金の見通しは、${b.cash_runway}です`);
      add(b.critical_deadline && `差し迫っているのは、${b.critical_deadline}です`);
      add(b.revenue_trend && `売上は、${b.revenue_trend}です`);
      add(b.debt_types && `借入は、${b.debt_types}です`);
    }
    return out;
  }

  // resources: /api/resources の一覧（電話番号つきの確認済みの窓口）
  function buildCallScript(state, resources) {
    const topicKey = pickTopic(state);
    if (!topicKey) return null;
    const topic = TOPICS[topicKey];
    const resource = (resources || []).find((r) => r.id === topic.resourceId);

    const lines = [];
    lines.push("【電話をかける先】");
    lines.push(topic.target);
    if (resource && resource.phone) {
      lines.push(`電話番号: ${resource.phone}${resource.hours ? `（${resource.hours}）` : ""}`);
    } else {
      lines.push("電話番号は、届いた書面や、お住まいの役所の案内で確認してください。");
    }
    lines.push("");
    lines.push("【最初の一言】");
    lines.push(
      `「お忙しいところ失礼します。${topic.phrase}で困っていて、相談したくて電話しました。担当の方につないでいただけますか。」`
    );
    lines.push("");
    lines.push("【伝えること】");
    const facts = factLines(topicKey, state);
    if (facts.length > 0) {
      lines.push(...facts);
    } else {
      lines.push("・まだ状況がうまく整理できていなければ、「状況を整理したい」とだけ伝えれば大丈夫です");
    }
    lines.push("");
    lines.push("【聞くこと】");
    topic.asks.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push("");
    lines.push("【手元に用意するもの】");
    topic.prepare.forEach((x) => lines.push(`・${x}`));
    lines.push("");
    lines.push("【こう考えて大丈夫です】");
    lines.push("うまく話せなくても大丈夫です。メモを読み上げるだけでも、「状況を整理したくて電話しました」とだけ伝えても、相談は始められます。");
    lines.push("相手の名前と、言われたことは、メモしておくと、次につながります。");

    return { topic: topicKey, title: `電話の台本（${topic.phrase}）`, text: lines.join("\n") };
  }

  const api = { buildCallScript, pickTopic };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KakekomiCallScript = api;
})(typeof window !== "undefined" ? window : globalThis);
