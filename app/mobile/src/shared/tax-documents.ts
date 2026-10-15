// 控除・確定申告で集める書類の一覧（id・名前・置き場所）。「必要な書類」（tax-estimate.ts の documents）の名前と、
// 証明書の画像の撮影・アップロードのボタンを置く場所をここで決める。Web とモバイルで同じ内容を持つ（shared-with-mobile.ts）。

/**
 * 書類を撮影・アップロードする場所。
 * income = 給与（給与明細・所得の給与の欄）、business = 事業所得・予定納税、disability = 障害者控除、
 * deduction:<控除> = 所得控除の各控除、housing = 住宅ローン控除、filing = 提出のときに用意するもの
 */
export type TaxDocumentPlace =
  | "income"
  | "business"
  | "disability"
  | "deduction:socialInsurance"
  | "deduction:smallBusinessMutualAid"
  | "deduction:lifeInsurance"
  | "deduction:earthquake"
  | "deduction:medical"
  | "deduction:casualty"
  | "deduction:donation"
  | "housing"
  | "filing";

export type TaxDocumentDef = {
  label: string;
  place: TaxDocumentPlace;
  /** 画像を保存できるか（マイナンバーは扱わない） */
  uploadable: boolean;
};

export const TAX_DOCUMENTS = {
  withholdingSlip: { label: "源泉徴収票", place: "income", uploadable: true },
  businessStatement: {
    label: "青色申告決算書（または収支内訳書）",
    place: "business",
    uploadable: true,
  },
  prepaidTaxNotice: {
    label: "予定納税額の通知書（または納付の控え）",
    place: "business",
    uploadable: true,
  },
  socialInsuranceCert: {
    label: "社会保険料（国民年金保険料）控除証明書",
    place: "deduction:socialInsurance",
    uploadable: true,
  },
  mutualAidCert: {
    label: "小規模企業共済等掛金払込証明書",
    place: "deduction:smallBusinessMutualAid",
    uploadable: true,
  },
  lifeInsuranceCert: {
    label: "生命保険料控除証明書",
    place: "deduction:lifeInsurance",
    uploadable: true,
  },
  earthquakeCert: {
    label: "地震保険料控除証明書",
    place: "deduction:earthquake",
    uploadable: true,
  },
  medicalStatement: {
    label: "医療費控除の明細書（領収書・医療費通知）",
    place: "deduction:medical",
    uploadable: true,
  },
  selfMedicationStatement: {
    label: "セルフメディケーション税制の明細書（対象医薬品のレシート）",
    place: "deduction:medical",
    // レシートは実績のカレンダーで撮影したものを使う（証憑のセルフメディケーションの額）
    uploadable: false,
  },
  healthCheckProof: {
    label: "健康診断・予防接種などの結果通知や領収書",
    place: "deduction:medical",
    uploadable: true,
  },
  casualtyProof: {
    label: "罹災証明書・災害関連支出の領収書",
    place: "deduction:casualty",
    uploadable: true,
  },
  donationReceipt: {
    label: "寄附金受領証明書（または寄附金控除に関する証明書）",
    place: "deduction:donation",
    uploadable: true,
  },
  housingCalc: {
    label: "住宅借入金等特別控除額の計算明細書",
    place: "housing",
    uploadable: true,
  },
  housingBalanceCert: {
    label: "住宅取得資金に係る借入金の年末残高等証明書",
    place: "housing",
    uploadable: true,
  },
  housingContract: {
    label: "売買契約書・請負契約書の写し、登記事項証明書",
    place: "housing",
    uploadable: true,
  },
  housingEnergyCert: {
    label: "住宅の省エネ性能などの証明書",
    place: "housing",
    uploadable: true,
  },
  disabilityProof: { label: "障害者手帳など", place: "disability", uploadable: true },
  myNumber: {
    label: "マイナンバーカード（または通知カードと本人確認書類）",
    place: "filing",
    uploadable: false,
  },
} as const satisfies Record<string, TaxDocumentDef>;

export type TaxDocumentId = keyof typeof TAX_DOCUMENTS;

export function isTaxDocumentId(id: string): id is TaxDocumentId {
  return Object.prototype.hasOwnProperty.call(TAX_DOCUMENTS, id);
}

/** 置き場所ごとの書類の id */
export function documentsAt(place: TaxDocumentPlace): TaxDocumentId[] {
  return (Object.keys(TAX_DOCUMENTS) as TaxDocumentId[]).filter(
    (id) => TAX_DOCUMENTS[id].place === place,
  );
}

export type DocumentState = {
  id: string;
  /** 保存したファイルの枚数（セルフメディケーションの明細書は保存したレシートの枚数） */
  count: number;
  uploadable: boolean;
};

/** 必要な書類ごとの保存の状態 */
export function documentStatus(
  documents: { id: string }[],
  files: { docId: string }[],
  selfMedicationReceipts: number,
): DocumentState[] {
  return documents.map((d) => ({
    id: d.id,
    count:
      d.id === "selfMedicationStatement"
        ? selfMedicationReceipts
        : files.filter((f) => f.docId === d.id).length,
    uploadable: isTaxDocumentId(d.id) && TAX_DOCUMENTS[d.id].uploadable,
  }));
}

/**
 * 置き場所に撮影・アップロードのボタンを出すか。今の入力で要るか、すでにファイルがあるとき
 * （要らなくなっても、保存したものを見たり消したりできるように）
 */
export function showDocument(
  id: TaxDocumentId,
  documents: { id: string }[],
  files: { docId: string }[],
): boolean {
  return documents.some((d) => d.id === id) || files.some((f) => f.docId === id);
}
