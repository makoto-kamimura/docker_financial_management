# 残タスク

主要な機能は Web・モバイルともに実装した（[readme 17章](../../readme.md#17-開発ロードマップ)の Phase 0〜7）。
ここには、残っている作業（不具合の修正・本番運用の準備・手作業・将来の機能）だけをまとめる。仕様は [readme.md](../../readme.md) を参照する。

## 1. 不具合

readme とコードの突き合わせ（2026-10）で見つかったもの。

- [ ] **仕訳テンプレートの画面で科目を読み込めない**
  - `app/web/src/app/journal-templates/page.tsx` が、存在しない `/api/masters/accounts` を呼んでいる（`/api/accounts` に直す）。仕訳帳から雛形を呼び出す操作も無い。
- [ ] **インボイスの「印刷」が 404 になる**
  - `app/web/src/app/invoices/page.tsx` が `/invoices/print?id=` を開くが、その画面が無い。
- [ ] **インボイスの「入金」が必ず 400 になる**
  - 発行すると売掛金を作るので、`PUT /api/invoices/[id]` は入金済みへの直接の変更を断る（売掛金の入金登録で切り替わる作り）。ボタンを売掛金の入金へ案内するか、消す。
- [ ] **accountant ロールを付けられない**
  - 権限の判定は accountant に対応しているが、`/api/admin/users`（作成・変更）の Zod と、ユーザー管理の画面の選択肢が admin / editor / viewer だけ。
- [ ] **決算のキャッシュが消えない操作がある**
  - 決算確定の取り消し（`DELETE /api/closing/finalize`）と、自動で作る仕訳（減価償却・棚卸の確定・売掛金と買掛金の消込）で、`invalidateClosingCaches` を呼んでいない。
- [ ] **実績を確定した月でも振替の組を解除できる**
  - `DELETE /api/bank-transfers/link` が実績の確定を確かめていない（チャージの紐付けは確かめている）。解除すると、確定した月に未割り当ての明細が増える。
- [ ] **空白だけの摘要を学習すると、全明細に当たるルールができるおそれ**
  - CSV の摘要は空でないことだけを確かめる。空白だけの摘要に科目を付けると、`normalizeKeyword` が空のキーワードを保存し、`classifyByRules` で全明細に当たる（実際に起きるかは未確認）。
- [ ] **使っていない残り物**
  - スキーマの `RecurringSuggestionDismissal`（`recurring_suggestion_dismissals`）と `BankAccount.role`、借入金管理の画面の「資金繰り」という文言、`app/web/sample-data/financials.csv`（廃止した科目×月の CSV の見本）。

## 2. 本番運用の準備

- [ ] **自動デプロイを有効にする**
  - 本番サーバーと GitHub Secrets を用意する（[runbooks/production-server-setup.md](../runbooks/production-server-setup.md)）。
  - 初期データのデモユーザーのパスワードを変えるか、消す。
- [ ] **ステージング環境**を作る。
- [ ] **Blue/Green デプロイ**など、止めずに入れ替える仕組み。
- [ ] **マネージド PostgreSQL**（接続のプーリングを含む）への移行。

## 3. 手作業での確認

ときどき、次の確認を通す（CI では結合テストを流していない）。手順は readme の「開発でよく使うコマンド」と同じ。

- 使い捨ての DB（例：`docker run -p 55432:5432 postgres:16-alpine`）に `prisma migrate deploy` と `npm run db:seed` を流し、`DATABASE_URL` をそこに向けて `npm run test:integration` を通す。
- `npm run build` のあと `npm run start` で起動し、`npm run e2e`（初回は `npm run e2e:install`）を通す。画面を変えたら `npm run screenshot` で `docs/images/dashboard.png` を撮り直す。

## 4. 将来の機能

- [ ] **実際の銀行との連携**：`app/web/src/lib/ledger/banksync.ts` の取得先を、口座アグリゲーションの事業者（Plaid・Moneytree LINK など）の実装に差し替える。認証情報・契約が要る。今はモックと CSV の取り込みで代わりにしている。
- [ ] **有料の AI 科目変換**：[design/account-conversion-system.md](../design/account-conversion-system.md) の Phase 6（料金・キャッシュ・PDF の報告書）。テーブル（`ai_conversion_results`・`ai_conversion_usages`）だけがある。
- [ ] **勘定科目変換の結果を既存データに反映する**：実績・仕訳・予算・ルールの科目を一括で付け替える。予算など「テナント × 科目 × 月」で一意の表は、複数の科目が 1 つに集まるときに合算が要る。確定済みの月の扱いと、行ごとの変更記録による巻き戻しの設計が要る（明細の科目の付け直し `lib/ledger/ledger-auto-process.ts` が参考になる）。
- [ ] **発生主義の家計**：[design/home-mode-accrual-basis.md](../design/home-mode-accrual-basis.md)。
- [ ] **資金移動の推定**：入出金の明細から、毎月の資金移動ルールと差額を推定して提案する。以前の資金移動のカレンダーと定期の入出金の検出は削除したので、作るなら画面から作り直す（検出の考え方は削除前の `recurring-suggestions.ts` が参考になる）。
- [ ] **キャッシュフロー計算書**：営業 / 投資 / 財務の区分と期間の比較。以前の資金フロー図（Sankey）は削除したので、一から作る。科目に区分を持たせる必要がある（家計の科目はコードの範囲で区分できない）。
- [ ] **Excel への出力**：今は総勘定元帳・試算表の CSV と、決算書類の印刷だけ。
- [ ] **既存の会計ソフトとの連携**：freee・マネーフォワードの OAuth は枠組みだけ。弥生なども調べる。
