// Web とモバイル（app/mobile/src/shared/）で同じ内容を持つ lib ファイルの一覧。
// 画面の計算・表示ラベルを両方で同じにするため、ここに挙げたファイルは Web 側を正本とし、
// モバイル側へそのまま複製する（npm run sync:mobile）。複製に差分が無いことは
// shared-with-mobile.test.ts が検査する。挙げるファイルは lib 内の相対 import だけに依存させること。
export const SHARED_WITH_MOBILE = [
  "debt-schedule.ts",
  "display-name.ts",
  "financial-matrix.ts",
  "forecast-methods.ts",
  "labels.ts",
  "linked-account-type.ts",
  "loan-schedule.ts",
  "mode-labels.ts",
  "rate-forecast.ts",
  "step-checklist.ts",
] as const;

/** web/src/lib から見たモバイル側の複製先 */
export const MOBILE_SHARED_DIR = "../../../mobile/src/shared";
