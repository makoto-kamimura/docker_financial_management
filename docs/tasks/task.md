# 残タスク

主要な機能は Web・モバイルともに実装した（[readme 17章](../../readme.md#17-開発ロードマップ)の Phase 0〜7）。
ここには、残っている作業（不具合の修正・本番運用の準備・手作業・将来の機能）だけをまとめる。仕様は [readme.md](../../readme.md) を参照する。

## 1. 不具合

今わかっているものはない。見つけたらここに書く。

## 2. 本番運用の準備

- [ ] **本番の compose を開発と揃える**（readme 18.6節・25章）
  - `redis` がないので、レート制限とキャッシュが使えない（ログインのレート制限はメモリで数える）。
  - `session-cleanup` がないので、期限切れのセッションが消えない。
  - 証憑のボリュームがないので、コンテナを入れ替えるとアップロードしたファイルが消える。
  - `APP_ORIGIN`・`REDIS_URL`・`CLEANUP_SERVICE_KEY` を web に渡す。
- [ ] **`platform/.env.example` を実際に読む環境変数に揃える**
  - 足りないもの：`REDIS_URL`・`CLEANUP_SERVICE_KEY`・`COOKIE_SECURE`・`APP_ORIGIN`・`FREEE_*`・`MF_*`・`OPENBANKING_*`・`BANK_SYNC_PROVIDER` など。
- [ ] **自動デプロイを有効にする**
  - 本番サーバーと GitHub Secrets を用意する（[runbooks/production-server-setup.md](../runbooks/production-server-setup.md)）。
  - 初期データのデモユーザーのパスワードを変えるか、消す。
- [ ] **ステージング環境**を作る。
- [ ] **Blue/Green デプロイ**など、止めずに入れ替える仕組み。
- [ ] **マネージド PostgreSQL**（接続のプーリングを含む）への移行。

## 3. 手作業での確認

- [ ] **実機のスクリーンショット**：`npm run screenshot`（ブラウザと起動したアプリ・DB が要る）で `docs/images/dashboard.png` を作り、readme から参照する（今はイメージ図の `docs/images/dashboard-demo.svg` のまま）。
- [ ] **E2E のローカルでの確認**：`npm run e2e:install` のあと、ローカルで `npm run e2e` を通す（CI の `e2e` ジョブでは実行している）。
- [ ] **結合テスト**：`npm run test:integration` を、実際の DB でときどき通す（CI では実行していない）。

## 4. 将来の機能

- [ ] **実際の銀行との連携**：`app/web/src/lib/banksync.ts` の取得先を、口座アグリゲーションの事業者（Plaid・Moneytree LINK など）の実装に差し替える。認証情報・契約が要る。今はモックと CSV の取り込みで代わりにしている。
- [ ] **有料の AI 科目変換**：[design/account-conversion-system.md](../design/account-conversion-system.md) の Phase 6（料金・キャッシュ・PDF の報告書）。テーブル（`ai_conversion_results`・`ai_conversion_usages`）だけがある。
- [ ] **勘定科目変換の結果を既存データに反映する**：実績・仕訳の科目を一括で付け替える（整合性と巻き戻しの設計が要る）。
- [ ] **発生主義の家計**：[design/home-mode-accrual-basis.md](../design/home-mode-accrual-basis.md)。
- [ ] **資金移動のカレンダーの拡張**：入出金の明細から、資金移動ルールと差額を自動で推定する。
- [ ] **資金フロー図の拡張**：キャッシュフロー計算書（営業 / 投資 / 財務）への対応、期間の比較。
- [ ] **Excel への出力**（今は CSV・グラフの PNG・印刷）。
- [ ] **既存の会計ソフトとの連携**：freee・マネーフォワードの OAuth は枠組みだけ。弥生なども調べる。
