// AIに送る前に、個人情報に見える部分を、自動で伏せる。
// 画面側（frontend/mask.js）と同じ規則。サーバー側にも入れているのは、画面を通さずにAPIを使われても、
// AIの事業者へ、生の番号を送らないための二重の守り。完全ではない（名前などは、見分けられない）。

export const MASK_LABELS: Record<string, string> = {
  email: "メールアドレス",
  birthday: "生年月日",
  card: "カード番号",
  mynumber: "12桁の番号",
  phone: "電話番号",
  postal: "郵便番号",
  account: "口座番号",
  address: "番地",
};

const SEP = "[-‐‑–−ー\\s]";

// 順番が大事（長いもの・特定しやすいものを先に）
const RULES: Array<{ kind: string; re: RegExp; replace?: (m: string, ...g: string[]) => string }> = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "birthday", re: /(?:昭和|平成)\d{1,2}年\d{1,2}月\d{1,2}日|(?:19\d{2}|200\d)年\d{1,2}月\d{1,2}日/g },
  { kind: "card", re: /(?<!\d)(?:\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{3,4}|\d{13,19})(?!\d)/g },
  { kind: "mynumber", re: new RegExp(`(?<!\\d)\\d{4}${SEP}\\d{4}${SEP}\\d{4}(?!\\d)|(?<!\\d)\\d{12}(?!\\d)`, "g") },
  {
    kind: "phone",
    re: new RegExp(
      `(?<!\\d)(?:\\+81${SEP}?|0)\\d{1,4}${SEP}\\d{1,4}${SEP}\\d{3,4}(?!\\d)|(?<!\\d)0[789]0\\d{8}(?!\\d)|(?<!\\d)0\\d{9}(?!\\d)`,
      "g"
    ),
  },
  { kind: "postal", re: /〒\s?\d{3}-?\d{4}(?!\d)|(?<!\d)\d{3}-\d{4}(?![\d-])/g },
  {
    kind: "account",
    re: /(口座(?:番号)?|普通|当座)(\s*[:：は]?\s*)(\d{6,8})(?!\d)/g,
    replace: (_m, head, gap) => `${head}${gap}`,
  },
  { kind: "address", re: /\d+丁目(?:\d+番)?(?:\d+号?)?|\d+番地(?:\d+号?)?|(?<![\d-])\d{1,3}-\d{1,3}-\d{1,3}(?![\d-])/g },
];

export interface MaskResult {
  text: string;
  found: Record<string, number>;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** keepDigits: 伏せない電話番号（確認済みの窓口の番号など）。数字だけにして渡す */
export function maskPersonalInfo(input: string, keepDigits: Set<string> = new Set()): MaskResult {
  let text = input.normalize("NFKC");
  const found: Record<string, number> = {};
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args) => {
      const m = args[0] as string;
      if (rule.kind === "phone" && keepDigits.has(digitsOnly(m))) return m;
      found[rule.kind] = (found[rule.kind] ?? 0) + 1;
      const label = `〔${MASK_LABELS[rule.kind]}〕`;
      if (rule.replace) {
        const groups = args.slice(1, -2) as string[];
        return `${rule.replace(m, ...groups)}${label}`;
      }
      return label;
    });
  }
  return { text, found };
}
