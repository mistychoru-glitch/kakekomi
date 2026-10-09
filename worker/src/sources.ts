// 「次の一歩」ごとの根拠（公式ページへのリンクと、確認した日）。
// 確認日は、そのページが存在し、内容がその一歩に関係することを、人が確かめた日。
// 根拠を確かめられていない一歩には、載せない（空欄のままにする）。内容を足すときは、必ず公式で確かめること。

export interface Source {
  label: string;
  url: string;
  verifiedAt: string; // YYYY-MM-DD
}

const VERIFIED = "2026-10-09";

const MHLW_KONKYUSHA: Source = {
  label: "厚生労働省「生活困窮者自立支援制度」",
  url: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000059425.html",
  verifiedAt: VERIFIED,
};
const HOUTERASU: Source = {
  label: "法テラス（日本司法支援センター）",
  url: "https://www.houterasu.or.jp/",
  verifiedAt: VERIFIED,
};
const NTA: Source = {
  label: "国税庁「納期限までに納付することが困難な方へ」",
  url: "https://www.nta.go.jp/taxes/nozei/nofu_konnan.htm",
  verifiedAt: VERIFIED,
};
const NENKIN: Source = {
  label: "日本年金機構「国民年金保険料の免除制度・納付猶予制度」",
  url: "https://www.nenkin.go.jp/service/kokunen/menjo/20150428.html",
  verifiedAt: VERIFIED,
};
const MHLW_KOKUHO: Source = {
  label: "厚生労働省「国民健康保険の保険料・保険税について」",
  url: "https://www.mhlw.go.jp/stf/newpage_21517.html",
  verifiedAt: VERIFIED,
};
const JHF: Source = {
  label: "住宅金融支援機構「返済方法の変更」（フラット35などをご利用の方）",
  url: "https://www.jhf.go.jp/hensai/hensai/index.html",
  verifiedAt: VERIFIED,
};
const JFC: Source = {
  label: "日本政策金融公庫",
  url: "https://www.jfc.go.jp/",
  verifiedAt: VERIFIED,
};
const YOROZU: Source = {
  label: "よろず支援拠点（全国本部）",
  url: "https://yorozu.smrj.go.jp/",
  verifiedAt: VERIFIED,
};

export const SOURCES: Record<string, Source> = {
  housing_consult_jiritsu: MHLW_KONKYUSHA,
  housing_alt_program: MHLW_KONKYUSHA,
  housing_moving_cost_support: MHLW_KONKYUSHA,
  housing_legal_urgent: HOUTERASU,
  mortgage_auction_urgent: HOUTERASU,
  mortgage_acceleration_contact: HOUTERASU,
  mortgage_consult_legal: HOUTERASU,
  mortgage_consult_lender: JHF,
  debt_consult_houterasu: HOUTERASU,
  tax_seizure_contact_now: NTA,
  tax_national_consult: NTA,
  tax_health_insurance_consult: MHLW_KOKUHO,
  tax_pension_exemption: NENKIN,
  tax_consult_jiritsu: MHLW_KONKYUSHA,
  business_cashflow_urgent: JFC,
  business_free_consultation: YOROZU,
};

export function sourceFor(id: string): Source | undefined {
  return SOURCES[id];
}
