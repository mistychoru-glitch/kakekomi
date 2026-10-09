// 相談窓口の一覧（AIの案内と画面表示の唯一の情報源）。
// 電話番号は公式ページで確認できたものだけを載せる。確認できていない番号は載せず、
// 自治体ごとに異なる窓口は「探し方」で案内する。内容を変えるときは必ず公式情報で再確認すること。
// 最終確認: 2026-10

export interface Resource {
  id: string;
  name: string;
  phone?: string;
  hours?: string;
  forWhom: string;
  whatTheyDo: string; // 「電話（相談）すると何をしてくれるか」
  howToFind?: string; // 電話番号が自治体ごとに異なる窓口の探し方
  link?: { label: string; url: string }; // 画面に出す公式の探し方ページ（https のみ）
}

export const RESOURCES: Resource[] = [
  {
    id: "jiritsu-soudan",
    name: "自立相談支援機関（お住まいの市区町村の窓口）",
    forWhom: "家賃・生活費・借金など、お金や暮らしのことで困っている人（誰でも）",
    whatTheyDo:
      "支援員が状況を聞き、何から手をつけるかを一緒に整理して支援プランを作ってくれる。家賃を支える住居確保給付金など、使える制度の案内や申請の相談もできる。",
    howToFind:
      "電話番号は自治体ごとに違う。①画面の「お住まいの地域の窓口を探す」リンクから、都道府県ごとの窓口一覧を見る ②「（市区町村名） 自立相談支援機関」で検索する ③市区町村の役所の福祉窓口（福祉課・生活支援課など）に電話して「生活困窮者の自立相談の窓口はどこですか」と聞く。名称は自治体により「くらしのサポートセンター」などと異なる。",
    link: {
      label: "お住まいの地域の窓口を探す（都道府県ごとの一覧・厚生労働省委託の情報サイト）",
      url: "https://minna-tunagaru.jp/ichiran/",
    },
  },
  {
    id: "houterasu",
    name: "法テラス（日本司法支援センター）サポートダイヤル",
    phone: "0570-078374",
    hours: "平日9:00〜21:00 / 土曜9:00〜17:00",
    forWhom: "借金・督促・家賃トラブルなど、法的な問題で困っている人",
    whatTheyDo:
      "状況に合う相談窓口を案内してくれる。収入などの要件を満たせば、無料の法律相談や、弁護士・司法書士の費用の立替（民事法律扶助）を受けられることがある。",
  },
  {
    id: "fsa-user-soudan",
    name: "金融庁 金融サービス利用者相談室",
    phone: "0570-016811",
    hours: "平日10:00〜17:00（IP電話は 03-5251-6811）",
    forWhom: "金融機関や貸金業者への対応で困っている人",
    whatTheyDo: "金融サービスに関する一般的な質問・相談を受け付けてくれる。",
  },
  {
    id: "shohisha-188",
    name: "消費者ホットライン",
    phone: "188",
    hours: "窓口により異なる",
    forWhom: "悪質な業者や契約のトラブルにあった人",
    whatTheyDo: "全国共通の番号で、最寄りの消費生活相談窓口につないでくれる。",
  },
  {
    id: "jfc-jigyo",
    name: "日本政策金融公庫 事業資金相談ダイヤル",
    phone: "0120-154-505",
    hours: "平日9:00〜17:00（個人企業・小規模企業の人、創業予定の人は19:00まで）",
    forWhom: "資金繰りに困っている事業者・個人事業主",
    whatTheyDo: "事業資金の相談を受け付けてくれる。",
  },
  {
    id: "shokokai-yorozu",
    name: "商工会議所・商工会 / よろず支援拠点",
    forWhom: "経営や資金繰りに悩む事業者・個人事業主",
    whatTheyDo: "経営の相談に無料で乗ってくれる窓口。融資制度の使い方や、資金繰り表の整理なども相談できる。",
    howToFind: "「（市区町村名） 商工会議所」または「（都道府県名） よろず支援拠点」で検索する。",
  },
  {
    id: "yorisoi",
    name: "よりそいホットライン",
    phone: "0120-279-338",
    hours: "24時間・無料・匿名可",
    forWhom: "つらい気持ちが強いとき、誰かに話を聞いてほしいとき",
    whatTheyDo:
      "専門の相談員が話を聞き、必要に応じて次の支援先を一緒に考えてくれる。何かを決めなくても、話すだけで大丈夫。",
  },
];

export function formatResourcesForPrompt(): string {
  return RESOURCES.map((r) => {
    const lines = [`■ ${r.name}`];
    if (r.phone) lines.push(`  電話: ${r.phone}${r.hours ? `（${r.hours}）` : ""}`);
    lines.push(`  対象: ${r.forWhom}`);
    lines.push(`  かけると: ${r.whatTheyDo}`);
    if (r.howToFind) lines.push(`  探し方: ${r.howToFind}`);
    return lines.join("\n");
  }).join("\n");
}
