// "YYYY-MM" または日付文字列を月初日（UTC）の Date に正規化する（不正なら undefined）
export function parseYearMonth(input: string): Date | undefined {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
