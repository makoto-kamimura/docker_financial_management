# 開発タスク（task.md）

決算管理システムの開発タスクを管理する。`[ ]` 未着手 / `[x]` 完了。
最終更新: 2026-06-21

---

## ✅ 完了済み

### Phase 0〜4: プロジェクト基盤・基本機能・セキュリティ

- [x] ディレクトリ構成・Docker / docker-compose・Prisma 導入
- [x] マスタ管理 API + 画面（勘定科目・部門・会計期間）
- [x] 実績データ手入力・CSVインポート・月次/四半期/年次集計
- [x] 推移グラフ（Recharts）・KPI ダッシュボード（利益率・YoY・MoM・YTD）
- [x] 将来予測（移動平均・線形回帰・Holt・Holt-Winters・シナリオ比較）
- [x] 予実対比レポート（CSV / PNG / PDF 出力）・構成比グラフ
- [x] RBAC（admin / editor / accountant / viewer）・MFA（TOTP）・監査ログ
- [x] ユーザー管理画面（`/admin/users`）・監査ログ画面（`/admin/audit`）
- [x] 予算登録・編集 UI（`/budget`）
- [x] 銀行口座・クレジットカード連携（`/linked-accounts`）
- [x] 実績入力履歴（`FinancialRecordHistory` テーブル）
- [x] モバイルアプリ（ダッシュボード・資産管理・予算・実績入力・純資産グラフ）
- [x] 単体テスト（Vitest 35 ケース）・E2E テスト（Playwright）・ESLint / Prettier
- [x] CI（typecheck / test / build / migrate-check / e2e）
- [x] CD（GHCR build & push・自動デプロイ・自動ロールバック・メール通知）
- [x] バックアップ / リストアスクリプト（保持ポリシー対応）

### 個人事業主・確定申告支援（F001〜F015）

- [x] **F001** 事業者情報管理（`business_profiles`）
- [x] **F002** 仕訳入力・複式簿記（`journal_entries` / `journal_details`）
- [x] **F003** 個人事業主向け初期勘定科目 seed
- [x] **F005** 証憑ファイルアップロード（`receipts`、Docker volume）
- [x] **F006** 棚卸管理（`inventories` / `inventory_items`、itemType / valuationMethod）
- [x] **F007** 固定資産管理（`fixed_assets`）
- [x] **F008** 減価償却計算（定額法・定率法、`depreciations`）
- [x] **F009** 家事按分管理（`apportionments`）
- [x] **F010** 売掛金管理（`receivables`、入金時仕訳自動生成）
- [x] **F011** 買掛金管理（`payables`、支払時仕訳自動生成）
- [x] **F012** 消費税設定（`tax_settings`、免税/原則課税/簡易課税）
- [x] **F013** 決算処理・年度締め（`fiscal_year_closes`）
- [x] **F014** 青色申告決算書 印刷（`/closing/print`）
- [x] **F015** 確定申告資料出力

### 法人・統合会計（フェーズ 1〜8）

- [x] マルチテナント（`tenants`）・会計年度管理（`fiscal_years`）・`accountant` ロール
- [x] テンプレート仕訳・AI 仕訳提案（`POST /api/journals/suggest`）
- [x] 総勘定元帳（`/reports/ledger`、JSON / CSV）
- [x] 試算表（`/api/reports/trial-balance`、JSON / CSV）
- [x] 在庫管理の高度化（`valuationMethod` / `itemType` 追加）
- [x] 未収金・未払金管理（`accrued_revenues` / `accrued_expenses`）
- [x] 銀行・資金管理（`bank_accounts` / `bank_transactions`）
- [x] 借入金管理（`loans` / `loan_repayments`）
- [x] 適格請求書（インボイス）発行（`invoices` / `invoice_lines`）
- [x] 仕入税額控除管理（`taxCreditEligible`、`GET /api/tax-credit`）
- [x] 法人向け決算書出力（`/closing/corporate-print`：P/L・B/S・S/S・法人税概算）
- [x] 財務分析指標（流動比率・ROA/ROE 等、`/closing` 財務分析タブ）
- [x] 法人ガバナンス（役員・株主総会・配当・決算公告、`/governance`）
- [x] 電子帳簿保存法対応（`journal_approvals`、承認ワークフロー、`/api/journals/approve`）
- [x] Redis 導入（Docker Compose、`src/lib/redis.ts`、TTL 1h キャッシュ）
- [x] MFA リカバリーコード（`mfaRecoveryCodes`、発行 API `POST /api/auth/mfa/recovery`、ログイン時リカバリーコード認証対応）
- [x] Redis キャッシュ無効化（`finalize` / `journals` POST 時に `invalidateCache()` で当該年度を削除）
- [x] API 結合テスト（Vitest 15 ケース、100% パス）
- [x] セッションの定期削除ジョブ（`/api/admin/cleanup` + docker-compose cron コンテナ）

---

## ⚠️ 手動実行が必要（ネットワーク制約により未実施）

本リポジトリの開発環境では外部ネットワークが制限されており、以下は **CDN/ブラウザへ到達できる環境（ローカル PC や GitHub Actions 等）で手動実行**する必要がある。コード／設定の変更自体は完了済み。

- [ ] **xlsx の lockfile 更新**: `package.json` は公式 SheetJS CDN 版（`https://cdn.sheetjs.com/...`）に変更済み。`cdn.sheetjs.com` へ到達できる環境で `cd app/web && npm install` を実行し、更新後の `package-lock.json` をコミットする。
  - ⚠️ 未実施の間は `package.json` と `package-lock.json` が不一致のため **CI の `npm ci` が失敗**する。
- [ ] **実機スクリーンショットの生成**: `npm run screenshot`（要ブラウザ + 起動中アプリ + DB）で `docs/images/dashboard.png` を生成し、README のデモ画像参照を SVG イメージ図から差し替える（任意。現状は SVG イメージ図のままで運用）。
- [ ] **E2E のローカル検証**: Playwright のブラウザ取得が制限されサンドボックスでは未実行。`npm run e2e:install` 後にローカル、または CI の `e2e` ジョブで実行・確認する。
- [ ] **自動デプロイ（SSH + Docker Compose）の有効化**: CD の `deploy` ジョブは実装済み。動作には GitHub Secrets（`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH`、必要に応じ `DEPLOY_PORT` / `GHCR_USER` / `GHCR_PAT`）の登録と、本番サーバー側の準備（Docker、`DEPLOY_PATH` への `.env` 配置、初回 DB 起動）が必要。詳細は `docs/operation.md` 11 章。
- [ ] **銀行入出金の実自動取得**: `lib/banksync.ts` のプロバイダを実アグリゲーション事業者（Plaid / Moneytree LINK 等）の API 実装に差し替え。OAuth 等の認証情報・外部接続・利用契約が必要。現状はモック＋CSV取込で代替。
- [ ] **xlsx の package-lock.json 更新**: `cdn.sheetjs.com` 到達可能な環境で `cd app/web && npm install` を実行し `package-lock.json` をコミット。未実施の間 **CI の `npm ci` が失敗**する。
- [ ] **E2E のローカル実機検証**: `npm run e2e:install` 後にローカル or CI `e2e` ジョブで実行・確認。
- [ ] **本番自動デプロイの有効化**: GitHub Secrets（`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH`）を登録し、本番サーバーを用意する。詳細は `docs/deploy.md`。

---

## 🔴 優先度: 高（早めに対応推奨）

- [x] **マスタの編集・削除 UI** — 勘定科目・部門・会計期間のインライン編集・削除（`/masters` ページ実装済み）。

### B. データ・機能の拡充
- [ ] マスタの編集・削除（現状は追加・一覧のみ）／会計期間 UI
- [ ] 部門別・セグメント別のドリルダウン集計
- [ ] 予算の登録・編集 UI（現状はシード投入のみ）
- [ ] 構成比グラフ（円 / 積み上げ棒）
- [x] 資金フロー図（Sankey、勘定科目集計から自動生成）
- [x] 口座間 資金移動フロー（銀行口座・振込/引き落とし日を登録しフロー図を自動生成）
- [x] 残高推移シミュレーション（期首残高＋振込/引き落とし日から残高不足を検出）
- [x] 外部入出金（給与入金/支出）・クレジットカード引き落としを資金移動として一般化
- [x] 銀行入出金の自動取得（プロバイダ抽象＋モック）・CSV 取込・入出金明細画面
- [ ] 実銀行アグリゲーション API 連携（Plaid / Moneytree 等。認証情報・外部接続が必要）※手動設定項目
- [ ] 資金移動のカレンダー表示（月次の入出金イベント一覧）
- [ ] 入出金明細から資金移動ルール/期首残高の自動推定
- [ ] 資金フロー図のキャッシュフロー計算書（営業/投資/財務 CF）対応・期間比較
- [ ] 勘定科目の階層・連結（売上総利益等の自動算出ルール）
- [ ] Excel エクスポート（現状 CSV / PNG / PDF）
- [ ] 既存会計システム連携（freee / 弥生 等）の調査・実装
---

## 🟡 優先度: 中（中期バックログ）

- [x] **勘定科目の階層連結** — 親子科目ロールアップを試算表 API に追加（`rollup=true`）。
- [x] **部門別・セグメント別ドリルダウン集計** — `closing/statements?departmentId=` クエリパラメータ追加。
- [x] **監査ログの before/after 差分記録** — `audit_logs.before/after` カラム追加、`writeAudit()` 拡張。
- [x] **パスワードポリシー・アカウントロック・レート制限** — 5回失敗で15分ロック、`loginAttempts`/`lockedUntil` カラム。
- [x] **予測精度の評価指標（MAPE / RMSE）表示** — `/api/forecasts` レスポンスに `accuracy.mape/rmse` 追加（ホールドアウトバックテスト）。
- [x] **予測結果の永続化** — ダッシュボードに「予測を保存」ボタン追加。`POST /api/forecasts` へ送信、`forecasts` テーブルにスナップショット保存。精度指標（MAPE/RMSE）も常時表示。

---

## 🟢 優先度: 低（将来対応）

- [x] **e-Tax / eLTAX 連携** — `GET /api/closing/etax?type=blue_return|corporate|consumption_tax` で XML 生成。決算画面にドロップダウンダウンロードボタン追加。
- [x] **税理士ポータル** — `/portal` ページ（accountant 以上）+ `GET /api/portal` でテナント横断財務サマリ表示。
- [x] **freee / マネーフォワード API 連携** — OAuth 2.0 skeleton: `/api/integrations/freee`・`/api/integrations/moneyforward`（環境変数設定で本番稼働可能）。
- [x] **オープンバンキング API 連携** — `GET/POST /api/integrations/openbanking`（OPENBANKING_API_KEY 設定で稼働）。`/integrations` 連携管理ページ追加。
- [ ] **Blue/Green デプロイ** — ゼロダウンタイムデプロイ対応。
- [ ] **マネージド PostgreSQL** — 本番環境での接続プーリング・マネージド移行。
- [ ] **ステージング環境の構築** — 本番相当の検証環境。
- [x] **UI デザイン整備** — a11y 対応（スキップリンク・aria-current・role 属性・フォーカスリング・reduced-motion）。モバイルレスポンシブ対応（サイドバートグル）。グローバル CSS に `.badge`・`.btn-danger`・`.table-scroll` クラス追加。
- [x] **国際化（i18n）** — `src/lib/i18n.ts`・`src/locales/ja.ts`・`src/locales/en.ts`・`src/hooks/useLocale.ts` を追加。AppShell サイドバーに日本語/English 切り替えボタン追加（localStorage 永続化）。
- [x] **季節周期・平滑化パラメータのチューニング UI** — ダッシュボードに「パラメータ調整」パネル追加（window / α / β / γ / 周期 L のスライダー）。`/api/forecasts` クエリパラメータ対応。`forecast()` に `ForecastParams` オプション追加。



# 追加項目（完了）
- [x] **勘定科目文言の変更機能** — マスタ編集モーダルにコード・名称の両方を変更可能なフィールドを追加。PATCH API にも `code` フィールド対応（重複チェック付き）。
- [x] **Excel インポート削除** — `entry/page.tsx` を CSV 専用に変更、`import.ts` から `xlsx` 依存を削除、import API も CSV のみに整理。
- [x] **年月日のデフォルトを今年度に** — `entry/page.tsx` のデフォルト年月を `new Date()` ベースに変更。仕訳帳・予実レポートの年選択リストも動的年リストに変更。
- [x] **観点切り替え機能** — AppShell サイドバーに「家計 / 個人 / 法人」3モード switcher を追加。モードに応じてナビ項目をフィルタ、localStorage で永続化。