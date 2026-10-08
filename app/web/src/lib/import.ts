// S-11: 行数上限・ファイルサイズ上限。超過はルートハンドラ側で 400 として拒否する。
// 明細の CSV（実績管理の CSV インポート・銀行・カード）に同じ上限を適用する（詳細設計書 §7）。
// 科目×月の実績を直接取り込む CSV（importRows）は、実績を明細から作るようにしたためなくした。
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5MB
