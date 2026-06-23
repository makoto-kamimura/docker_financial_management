# 開発タスク（task.md）

決算管理システムの開発タスクを管理する。`[ ]` 未着手 / `[x]` 完了。
最終更新: 2026-06-17（Phase 0〜4 完了。以降は今後のバックログ）。

---

## ✅ 完了済み（Phase 0〜4）

### Phase 0: プロジェクト基盤
- [x] ディレクトリ構成の作成（app/web, app/mobile, platform, docs）
- [x] バックエンド方針の決定（Next.js Route Handlers）
- [x] Web (Next.js) / Mobile (Expo) の雛形作成
- [x] Docker / docker-compose の整備
- [x] Prisma 導入と PostgreSQL スキーマ定義
- [x] ドキュメント整備（design / history / task / operation）
- [x] CI（GitHub Actions: typecheck / build / migrate-check）

### Phase 1: データ管理・基本集計・推移グラフ
- [x] マスタ管理 API + 画面（勘定科目・部門・会計期間）
- [x] 実績データの手入力フォーム
- [x] CSV / Excel(xlsx) インポート
- [x] 月次 / 四半期 / 年次の集計（Prisma）
- [x] 推移グラフ（Recharts）
- [x] 認証基盤（ログイン / セッション / ミドルウェア）

### Phase 2: 将来予測・ダッシュボード
- [x] 予測 API（移動平均 / 線形回帰 / 成長率）
- [x] 予測手法・シナリオ・期間の切替 UI
- [x] KPI ダッシュボード（利益率・YoY・MoM・YTD）
- [x] モバイルアプリのダッシュボード

### Phase 3: 高度な予測・レポート
- [x] 季節性を考慮した予測（Holt / Holt-Winters）
- [x] シナリオ比較（楽観・標準・悲観）
- [x] 予実対比レポートの自動生成
- [x] エクスポート（CSV / PNG / PDF）

### Phase 4: 運用・セキュリティ強化
- [x] RBAC（admin / editor / viewer）
- [x] 多要素認証（MFA / TOTP）
- [x] 監査ログ（記録 + admin 閲覧画面）
- [x] バックアップ / リストアスクリプト + 保持ポリシー
- [x] CD ワークフロー（GHCR への build & push）+ 本番 Compose

---

## ⚠️ 手動実行が必要な項目（開発サンドボックスのネットワーク制約により未実施）

本リポジトリの開発環境では外部ネットワークが制限されており、以下は **CDN/ブラウザへ到達できる環境（ローカル PC や GitHub Actions 等）で手動実行**する必要がある。コード／設定の変更自体は完了済み。

- [ ] **xlsx の lockfile 更新**: `package.json` は公式 SheetJS CDN 版（`https://cdn.sheetjs.com/...`）に変更済み。`cdn.sheetjs.com` へ到達できる環境で `cd app/web && npm install` を実行し、更新後の `package-lock.json` をコミットする。
  - ⚠️ 未実施の間は `package.json` と `package-lock.json` が不一致のため **CI の `npm ci` が失敗**する。
- [ ] **実機スクリーンショットの生成**: `npm run screenshot`（要ブラウザ + 起動中アプリ + DB）で `docs/images/dashboard.png` を生成し、README のデモ画像参照を SVG イメージ図から差し替える（任意。現状は SVG イメージ図のままで運用）。
- [ ] **E2E のローカル検証**: Playwright のブラウザ取得が制限されサンドボックスでは未実行。`npm run e2e:install` 後にローカル、または CI の `e2e` ジョブで実行・確認する。
- [ ] **自動デプロイ（SSH + Docker Compose）の有効化**: CD の `deploy` ジョブは実装済み。動作には GitHub Secrets（`DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH`、必要に応じ `DEPLOY_PORT` / `GHCR_USER` / `GHCR_PAT`）の登録と、本番サーバー側の準備（Docker、`DEPLOY_PATH` への `.env` 配置、初回 DB 起動）が必要。詳細は `docs/operation.md` 11 章。

---

## 🔜 今後のバックログ（洗い出し）

### A. テスト・品質
- [x] 単体テスト（集計 / 予測 / KPI / 予実 / TOTP）の整備（Vitest）
- [x] CI に test ジョブを追加
- [x] CI/CD 説明資料（`docs/cicd.md`）の作成
- [x] E2E テスト（Playwright：認証ガード + ログイン〜ダッシュボード〜レポート〜入力）+ CI 組込み
- [ ] API の結合テスト（route handlers）
- [ ] ESLint / Prettier の設定と CI 組み込み

### B. データ・機能の拡充
- [ ] マスタの編集・削除（現状は追加・一覧のみ）／会計期間 UI
- [ ] 部門別・セグメント別のドリルダウン集計
- [ ] 予算の登録・編集 UI（現状はシード投入のみ）
- [ ] 構成比グラフ（円 / 積み上げ棒）
- [x] 資金フロー図（Sankey、勘定科目集計から自動生成）
- [ ] 資金フロー図のキャッシュフロー計算書（営業/投資/財務 CF）対応・期間比較
- [ ] 勘定科目の階層・連結（売上総利益等の自動算出ルール）
- [ ] Excel エクスポート（現状 CSV / PNG / PDF）
- [ ] 既存会計システム連携（freee / 弥生 等）の調査・実装

### C. 予測の高度化
- [ ] 予測精度の評価指標（MAPE / RMSE）の表示
- [ ] 季節周期・平滑化パラメータのチューニング UI
- [ ] 予測結果の保存（`forecasts` テーブルへの永続化）

### D. セキュリティ・運用の強化
- [ ] MFA リカバリーコード / バックアップコード
- [ ] パスワードポリシー・アカウントロック・レート制限
- [ ] セッションの定期削除（期限切れクリーンアップのジョブ）
- [ ] ユーザー管理画面（admin によるユーザー / ロール管理）
- [ ] 監査ログの変更前後差分（before/after）記録
- [x] デプロイ後ヘルスチェック（Compose healthcheck + CD のリリース後検証 + 任意の外形監視）
- [ ] 監視・アラート（外形監視の常時化、エラートラッキング、通知連携）
- [ ] 構造化ログ / 監査ログの外部保管

### E. インフラ・デプロイ
- [x] CD の deploy ジョブ実装（SSH + Docker Compose による自動デプロイ）
- [x] 失敗時の自動ロールバック（直前イメージへ復帰）
- [x] デプロイ結果のメール通知
- [ ] Blue/Green・カナリア等のゼロダウンタイムデプロイ
- [ ] マイグレーション後方互換ガイドライン / DB スナップショット復元手順
- [ ] IaC（Terraform 等）でのインフラ定義
- [ ] ステージング環境の構築
- [ ] マネージド PostgreSQL の採用・接続プーリング
- [ ] バックアップの定期実行（cron / スケジューラ）と復旧訓練

### F. UX / アクセシビリティ
- [ ] UI デザイン整備（Tailwind / shadcn-ui の導入）
- [ ] ログアウトボタン・共通ナビゲーション・ロール表示
- [ ] ローディング / エラー状態の改善
- [ ] レスポンシブ対応・アクセシビリティ（a11y）対応
- [ ] 国際化（i18n）の検討
