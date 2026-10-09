// 経営者向けの「資金繰りチェック」の計算と、次の一歩のルール。
// 計算は、すべてコード側（AIは使わない）。入力した数字は、ブラウザの中だけで扱い、サーバーには送らない。
// 単位は万円。法的・税務の判断はしない（優先順位は「一般に」と添えて、確認は専門家に委ねる）。

(function (root) {
  const MONTHS = 3;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // 12 → "12"、12.5 → "12.5"
  function formatMan(n) {
    const r = round1(n);
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  function compute(input) {
    const cash = num(input.cash);
    const out = {
      payroll: num(input.payroll),
      rent: num(input.rent),
      debt: num(input.debt),
      tax: num(input.tax),
      other: num(input.other),
    };
    const outTotal = round1(out.payroll + out.rent + out.debt + out.tax + out.other);
    const inflows = [num(input.in1), num(input.in2), num(input.in3)];

    let balance = cash;
    const months = [];
    for (let i = 0; i < MONTHS; i++) {
      balance = round1(balance + inflows[i] - outTotal);
      months.push({ month: i + 1, inflow: inflows[i], outflow: outTotal, balance });
    }

    const firstNeg = months.findIndex((m) => m.balance < 0);
    const minBalance = Math.min(...months.map((m) => m.balance));
    const nothing = cash === 0 && outTotal === 0 && inflows.every((v) => v === 0);

    let severity = "ok";
    if (nothing) severity = "empty";
    else if (months[0].balance < 0) severity = "critical";
    else if (firstNeg !== -1) severity = "warning";

    return {
      cash,
      out,
      outTotal,
      inflows,
      months,
      severity,
      firstShortageMonth: firstNeg === -1 ? null : firstNeg + 1,
      shortage: round1(Math.max(0, -minBalance)),
      nextMonthShortage: round1(Math.max(0, -months[0].balance)),
      // 手元の資金と来月の入金をすべて給与にまわしても、給与が足りない
      payrollAtRisk: out.payroll > 0 && cash + inflows[0] < out.payroll,
    };
  }

  // まだ入金されていない売上: 遅れている日数が多い順、同じなら金額が大きい順
  function rankReceivables(list) {
    return (list || [])
      .map((r, idx) => ({
        idx,
        name: String(r.name || "").trim() || "（名前なし）",
        amount: num(r.amount),
        lateDays: Math.max(0, Math.floor(num(r.lateDays))),
      }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.lateDays - a.lateDays || b.amount - a.amount)
      .slice(0, 5);
  }

  // 主な支払い先: どこに「支払いの猶予」を相談するかの優先順位。
  // 給与・税金や社会保険料・借入の返済は、取引先への猶予の対象にしない（専用の窓口や専門家へ）。
  const KIND_LABELS = {
    supplier: "仕入・外注",
    rent: "家賃・リース",
    other: "その他の支払い",
    loan: "借入の返済",
    tax: "税金・社会保険料",
    payroll: "給与",
  };
  const NEGOTIABLE = ["supplier", "rent", "other"];
  const ROUTED_ADVICE = {
    loan: "借入先の銀行に、返済スケジュールの見直しを相談する（取引先への猶予とは別の相談です）",
    tax: "期限の前に、税務署・年金事務所などの窓口に、猶予や分割を相談する",
    payroll: "給与は、取引先のように後回しにする前提では考えず、専門家（社会保険労務士・弁護士）に相談する",
  };
  const APPROACH = {
    supplier:
      "期日の前に、事情と、いつ払えるかの見通しを伝えて、支払い時期の延長や分割（一部だけ先に支払う形など）を相談する",
    rent: "大家さん・管理会社・リース会社に、期日の前に、払える時期の見通しを添えて、猶予や分割を相談する",
    other: "期日の前に、事情と払える時期の見通しを伝えて、支払い時期の延長や分割を相談する",
  };

  function normalizePayable(p, idx) {
    const kind = KIND_LABELS[p.kind] ? p.kind : "other";
    const rel = ["good", "normal", "hard"].includes(p.rel) ? p.rel : "normal";
    const impact = p.impact === "critical" ? "critical" : "replaceable";
    return {
      idx,
      name: String(p.name || "").trim() || "（名前なし）",
      amount: num(p.amount),
      dueDays: num(p.dueDays),
      kind,
      rel,
      impact,
    };
  }

  function rankPayables(list, result) {
    const items = (list || []).map(normalizePayable).filter((p) => p.amount > 0);
    const negotiable = items.filter((p) => NEGOTIABLE.includes(p.kind));
    const total = negotiable.reduce((s, p) => s + p.amount, 0);

    const ranked = negotiable
      .map((p) => {
        const share = total > 0 ? p.amount / total : 0;
        const amountScore = share >= 0.4 ? 3 : share >= 0.2 ? 2 : share >= 0.1 ? 1 : 0;
        const dueScore = p.dueDays <= 7 ? 3 : p.dueDays <= 14 ? 2 : p.dueDays <= 30 ? 1 : 0;
        const relScore = p.rel === "good" ? 2 : p.rel === "normal" ? 1 : 0;
        const penalty = p.impact === "critical" ? 2 : 0;
        const reasons = [];
        if (amountScore >= 2) reasons.push("金額が大きい");
        if (dueScore >= 2) reasons.push("期日が近い");
        if (p.rel === "good") reasons.push("相談しやすい");
        if (p.impact === "replaceable") reasons.push("止まっても代わりがある");
        return {
          idx: p.idx,
          name: p.name,
          amount: p.amount,
          dueDays: p.dueDays,
          kind: p.kind,
          kindLabel: KIND_LABELS[p.kind],
          score: amountScore + dueScore + relScore - penalty,
          reasons,
          approach: APPROACH[p.kind],
          caution:
            p.impact === "critical"
              ? "止まると事業が回らない相手です。全額ではなく、一部や分割で、早めに事情を伝えて相談してください。"
              : p.rel === "hard"
                ? "相談しにくい相手です。期日の前に、書面やメールで事情と見通しを伝える形が現実的です。"
                : "",
        };
      })
      .sort((a, b) => b.score - a.score || b.amount - a.amount);

    const routed = items
      .filter((p) => !NEGOTIABLE.includes(p.kind))
      .map((p) => ({
        idx: p.idx,
        name: p.name,
        amount: p.amount,
        kindLabel: KIND_LABELS[p.kind],
        advice: ROUTED_ADVICE[p.kind],
      }));

    // 不足額を、上位から順に猶予してもらうと、何件で埋まりそうか（最大の見込み）
    const target =
      result.severity === "critical" ? result.nextMonthShortage : result.severity === "warning" ? result.shortage : 0;
    let cumulative = 0;
    let count = 0;
    for (const r of ranked) {
      if (cumulative >= target) break;
      cumulative = round1(cumulative + r.amount);
      count += 1;
    }
    return {
      ranked,
      routed,
      coverage: { target, cumulative, count, enough: target > 0 && cumulative >= target, total: round1(total) },
    };
  }

  function headline(result) {
    switch (result.severity) {
      case "critical":
        return `来月の支払いで、資金が約${formatMan(result.nextMonthShortage)}万円足りなくなる見込みです`;
      case "warning":
        return `${result.firstShortageMonth}か月後に、資金が足りなくなる見込みです（最大で約${formatMan(result.shortage)}万円の不足）`;
      case "ok":
        return `3か月先まで、資金は足りる見込みです（3か月後の残高は約${formatMan(result.months[MONTHS - 1].balance)}万円）`;
      default:
        return "数字を入れてください";
    }
  }

  // resources: /api/resources の一覧（電話番号は、ここにあるものだけを使う）
  // 取引先名を伏せるための呼び名（売掛先A、支払先B…）
  function labelOf(kind, idx) {
    const letter = idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1);
    return (kind === "recv" ? "売掛先" : "支払先") + letter;
  }

  // opts.nameOf(kind, item): 画面に出す名前（初期は本名）。伏せるときは labelOf を使う
  function buildPlan(result, receivablesInput, resources, payablesInput, opts) {
    const nameOf = (opts && opts.nameOf) || ((kind, item) => item.name);
    const steps = [];
    const sev = result.severity;
    if (sev === "empty") {
      return { severity: sev, headline: headline(result), steps, collect: [], defer: { ranked: [], routed: [], coverage: null } };
    }

    const collect = rankReceivables(receivablesInput);
    const defer = rankPayables(payablesInput, result);
    const jfc = (resources || []).find((r) => r.id === "jfc-jigyo");
    const jfcPhone = jfc && jfc.phone ? `（${jfc.phone}）` : "";

    if (sev === "critical" && result.payrollAtRisk) {
      steps.push({
        id: "cashflow_payroll_expert",
        action: "給与の支払いが足りなくなる見込みです。社会保険労務士・弁護士など、専門家に早めに相談する",
        caveat:
          "給与は、支払いの優先度が特に高いお金です。支払いを遅らせる前に、必ず専門家に確認してください。このツールでは、断定的なことはお伝えできません。",
        priority: 1,
      });
    }
    if (result.out.debt > 0 && sev !== "ok") {
      steps.push({
        id: "cashflow_bank_reschedule",
        action: "借入先の銀行に、返済スケジュール（返済額・期間）の見直しを、足りなくなる前に相談する",
        caveat:
          "条件の変更に応じるかは金融機関の判断で、総返済額が増えることもあります。申し込みから決まるまで時間がかかるので、早いほど選択肢が残ります。",
        priority: sev === "critical" ? 1 : 2,
      });
    }
    if (sev !== "ok" || collect.some((c) => c.lateDays > 0)) {
      if (collect.length > 0) {
        steps.push({
          id: "cashflow_collect_receivables",
          action: `入金を早められる取引先から連絡する（${collect
            .slice(0, 3)
            .map((c) => nameOf("recv", c))
            .join("、")}の順）`,
          caveat:
            "すでに遅れているもの、金額が大きいものを先にしています。取引先との関係もあるので、「お願い」として相談する形が現実的です。",
          priority: sev === "ok" ? 3 : 2,
        });
      } else if (sev !== "ok") {
        steps.push({
          id: "cashflow_collect_generic",
          action: "請求済みで、まだ入金されていない売上を洗い出して、入金を早められないか確認する",
          caveat: "画面の「まだ入金されていない売上」に入れると、連絡する順番を出せます。",
          priority: 2,
        });
      }
    }
    if (sev !== "ok") {
      steps.push({
        id: "cashflow_financing",
        action: `日本政策金融公庫の事業資金相談ダイヤル${jfcPhone}や、お住まいの地域のよろず支援拠点に、資金調達の相談をする`,
        caveat: "使える融資や制度には、要件があります。使えるかどうかは、窓口で確認してください。",
        priority: 2,
      });
      if (defer.ranked.length > 0) {
        const cov = defer.coverage;
        const top = defer.ranked.slice(0, 3).map((r) => nameOf("pay", r)).join("、");
        steps.push({
          id: "cashflow_defer_priority",
          action: `支払いの猶予は、${top}の順に相談する`,
          caveat:
            (cov.target > 0
              ? cov.enough
                ? `上位${cov.count}件で、不足の約${formatMan(cov.target)}万円分（合計約${formatMan(cov.cumulative)}万円）に届く見込みです。ただし、全額の猶予が認められるとは限りません。`
                : `猶予の対象にできる支払いは、合計約${formatMan(cov.total)}万円で、不足の約${formatMan(cov.target)}万円には届きません。借入や調達の相談も、並行して進めてください。`
              : "") +
            "相手の事情もあるので、断られることもあります。給与・税金・社会保険料・借入の返済は、取引先への猶予の対象にしていません。",
          priority: 2,
        });
      } else {
        steps.push({
          id: "cashflow_review_payments",
          action: "支払いを遅らせたり、減らしたりできる先を、取引先ごとに確認する（家賃・リース・外注費・仕入など）",
          caveat:
            "一般に、給与・税金・社会保険料を後回しにして助かる、とは限りません。それらの納付が難しいときは、期限の前に窓口へ相談してください。画面の「主な支払い先」に入れると、相談する順番を出せます。",
          priority: 3,
        });
      }
      if (result.out.tax > 0) {
        steps.push({
          id: "cashflow_tax_defer",
          action: "税金や社会保険料の納付が難しいときは、期限の前に、税務署や年金事務所に、猶予や分割を相談する",
          caveat: "期限を過ぎてからより、前の方が、使える方法が多いです。要件があるので、窓口で確認してください。",
          priority: 3,
        });
      }
    } else {
      steps.push({
        id: "cashflow_prepare",
        action: "余裕があるうちに、借入先や公庫の相談窓口と、借入の枠を確認しておく",
        caveat: "資金に余裕があるうちの方が、条件のよい相談ができる場合があります。",
        priority: 4,
      });
    }

    steps.sort((a, b) => a.priority - b.priority);
    return { severity: sev, headline: headline(result), steps, collect, defer };
  }

  // スプレッドシートからコピーした行（タブ区切り、またはカンマ区切り）を読み取る。通信はしない。
  const MAX_IMPORT = 20;

  // タブ区切り・カンマ区切りの1行を、引用符（"..."）に対応して分ける
  function splitLine(line) {
    const sep = line.includes("\t") ? "\t" : ",";
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === sep) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  // 見出しの行（金額などの列名がある）なら、列の位置を見出しから判断する。なければ、位置で読む
  function headerColumns(cells, kind) {
    const find = (re) => cells.findIndex((c) => re.test(c));
    const amount = find(/金額|額/);
    if (amount === -1) return null;
    const name = find(/名|取引先|支払先|相手/);
    const days = find(kind === "recv" ? /遅|日数/ : /期日|日数|まで/);
    const k = find(/種類|区分|科目/);
    return { name: name === -1 ? 0 : name, amount, days: days === -1 ? 2 : days, kind: k === -1 ? 3 : k };
  }

  // ファイルのバイト列を文字にする（UTF-8 を試し、だめなら Shift_JIS。ExcelのCSVに多い）
  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    } catch (e) {
      /* UTF-8 ではない */
    }
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch (e) {
      return new TextDecoder().decode(bytes);
    }
  }

  function toMan(text, unit) {
    const raw = String(text || "").replace(/[,，\s円]/g, "");
    const hasMan = raw.includes("万");
    const n = Number(raw.replace("万", ""));
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (hasMan) return n;
    return unit === "yen" ? n / 10000 : n;
  }

  function kindFromText(t) {
    const s = String(t || "");
    if (/給与|給料|賃金|人件費/.test(s)) return "payroll";
    if (/税|保険/.test(s)) return "tax";
    if (/借入|返済|ローン/.test(s)) return "loan";
    if (/家賃|リース|賃料/.test(s)) return "rent";
    if (/仕入|外注|材料|委託/.test(s)) return "supplier";
    return "other";
  }

  // kind: "recv"（名前, 金額, 遅れの日数） / "pay"（名前, 金額, 期日までの日数, 種類）
  function parsePasted(text, kind, unit) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const rows = [];
    let ignored = 0;
    let cols = { name: 0, amount: 1, days: 2, kind: 3 };
    let first = true;
    for (const line of lines) {
      const cells = splitLine(line);
      if (first) {
        first = false;
        const h = toMan(cells[1], unit) === 0 ? headerColumns(cells, kind) : null;
        if (h) {
          cols = h;
          continue; // 見出しの行は、読み飛ばす
        }
      }
      const amount = toMan(cells[cols.amount], unit);
      if (amount <= 0) continue; // 金額がない行は読み飛ばす
      if (rows.length >= MAX_IMPORT) {
        ignored += 1;
        continue;
      }
      if (kind === "recv") {
        rows.push({
          name: cells[cols.name] || "",
          amount: round1(amount),
          lateDays: Math.max(0, Math.floor(num(cells[cols.days]))),
        });
      } else {
        rows.push({
          name: cells[cols.name] || "",
          amount: round1(amount),
          dueDays: Math.max(0, Math.floor(num(cells[cols.days]))),
          kind: kindFromText(cells[cols.kind]),
          rel: "normal",
          impact: "replaceable",
        });
      }
    }
    return { rows, ignored };
  }

  const api = { labelOf, parsePasted, decodeText, MAX_IMPORT, compute, rankReceivables, rankPayables, buildPlan, formatMan, headline, KIND_LABELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KakekomiCashflow = api;
})(typeof window !== "undefined" ? window : globalThis);
