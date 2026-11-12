// レシートの読み取りで、読めなかった項目があるときに出す撮り直しの案内（web とモバイルで同じ文言）。
// 画質の警告は、無料プランの OCR サービスが返す（app/ocr の image.quality）。読めていれば案内は出さない。

/** 画質の警告（OCR サービスの image.quality の warnings） */
export const RECEIPT_QUALITY_WARNINGS = [
  "blurry",
  "too_dark",
  "uneven_lighting",
  "too_bright",
  "low_resolution",
] as const;
export type ReceiptQualityWarning = (typeof RECEIPT_QUALITY_WARNINGS)[number];

// 並びは案内する順（先に直したほうが効くもの）
const HINTS: Record<ReceiptQualityWarning, string> = {
  blurry: "写真がぼやけています。ピントを合わせ、手を止めて撮り直すと読み取りやすくなります。",
  too_dark: "写真が暗いようです。明るい場所で撮り直すと読み取りやすくなります。",
  uneven_lighting: "影がかかっています。影が入らない向きで撮り直すと読み取りやすくなります。",
  too_bright:
    "照明が映り込んでいるようです。光が反射しない向きで撮り直すと読み取りやすくなります。",
  low_resolution: "レシートが小さく写っています。近づいて撮り直すと読み取りやすくなります。",
};

/**
 * 撮り直しの案内。日付か合計を読めなかったときだけ、画質の警告から 1 つ選んで返す
 * （読めているのに撮り直しを勧めない）。知らない警告は無視する（サーバーが先に新しい警告を返しても壊れない）。
 */
export function retakeHint(
  warnings: readonly string[] | null | undefined,
  draft: { date: string | null; total: number | null },
): string | null {
  if (draft.date !== null && draft.total !== null) return null;
  const known = new Set(warnings ?? []);
  const first = RECEIPT_QUALITY_WARNINGS.find((w) => known.has(w));
  return first ? HINTS[first] : null;
}
