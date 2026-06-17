# 開発タスク（task.md）

決算管理システムの開発タスクを管理する。`[ ]` 未着手 / `[x]` 完了。

---

## Phase 0: プロジェクト基盤
- [x] ディレクトリ構成の作成（app/web, app/mobile, platform, docs）
- [x] バックエンド方針の決定（Next.js Route Handlers）
- [x] Web (Next.js) の雛形作成
- [x] Mobile (Expo) の雛形作成
- [x] Docker / docker-compose の整備
- [x] ドキュメント整備（design / history / task）
- [ ] CI（GitHub Actions: lint / typecheck / build）の追加
- [ ] Prisma 導入と PostgreSQL スキーマ定義

## Phase 1: データ管理・基本集計・推移グラフ
- [ ] マスタ管理（勘定科目・部門・会計期間）API + 画面
- [ ] 実績データの手入力フォーム
- [ ] CSV / Excel インポート機能
- [ ] 月次 / 四半期 / 年次の集計（Prisma クエリへ置き換え）
- [ ] 推移グラフ（Recharts）の実装
- [ ] 認証基盤（ログイン）

## Phase 2: 将来予測・ダッシュボード
- [ ] 予測 API の本実装（移動平均・線形回帰・成長率）
- [ ] 予測手法・期間の切り替え UI
- [ ] KPI ダッシュボード（実績＋予測の複合グラフ）
- [ ] モバイルアプリでのダッシュボード表示

## Phase 3: 高度な予測・レポート
- [ ] 季節性を考慮した時系列予測（指数平滑法 / Holt-Winters 等）
- [ ] シナリオ比較（楽観・標準・悲観）
- [ ] 予実対比レポートの自動生成
- [ ] レポート/グラフのエクスポート（PNG/PDF/CSV）

## Phase 4: 運用・セキュリティ強化
- [ ] RBAC（ロールベースアクセス制御）
- [ ] 多要素認証（MFA）
- [ ] 監査ログ
- [ ] バックアップ / データ保持ポリシー
- [ ] 本番デプロイ（クラウド）
