// 銀行入出金の自動取得（アグリゲーション）の抽象化。
//
// 実運用ではオープンバンキング / 口座アグリゲーション事業者
// （例: Plaid, Moneytree LINK, MoneyForward 等）の API をここに実装する。
// それらは OAuth 等の認証情報と外部接続が必要なため、本リポジトリでは
// プロバイダ差し替え可能なインターフェースと、開発用のモックを提供する。

export type FetchedTxn = {
  date: string; // ISO 日付
  description: string;
  amount: number; // +入金 / -出金
  balance?: number;
  externalId: string; // 重複取込防止のための一意ID
};

export interface BankSyncProvider {
  readonly name: string;
  // 指定口座の入出金を取得する（since 以降）。
  fetchTransactions(account: { id: number; bankName: string }, since?: Date): Promise<FetchedTxn[]>;
}

// 開発用モック: 給与入金・カード引き落とし等のサンプル明細を返す。
export class MockBankSyncProvider implements BankSyncProvider {
  readonly name = "mock";

  async fetchTransactions(account: { id: number; bankName: string }): Promise<FetchedTxn[]> {
    const base = [
      { day: 25, description: "給与振込", amount: 450_000 },
      { day: 27, description: "クレジットカード引き落とし", amount: -120_000 },
      { day: 27, description: "家賃 口座振替", amount: -90_000 },
      { day: 5, description: "水道光熱費", amount: -18_000 },
    ];
    return base.map((b) => ({
      date: `2025-01-${String(b.day).padStart(2, "0")}`,
      description: b.description,
      amount: b.amount,
      externalId: `mock-${account.id}-2025-01-${b.day}-${b.description}`,
    }));
  }
}

// 環境変数 BANK_SYNC_PROVIDER で実プロバイダへ差し替える想定。
// 例: "plaid" → new PlaidSyncProvider(...) を返す。現状は mock のみ。
export function getBankSyncProvider(): BankSyncProvider {
  // const kind = process.env.BANK_SYNC_PROVIDER ?? "mock";
  return new MockBankSyncProvider();
}
