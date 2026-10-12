# 残タスク

主要な機能は Web・モバイルともに実装した（[readme 17章](../../readme.md#17-開発ロードマップ)の Phase 0〜7）。
ここには、残っている作業（不具合の修正・本番運用の準備・手作業・将来の機能）だけをまとめる。仕様は [readme.md](../../readme.md) を参照する。

## 1. 不具合（ドキュメントの整理のときにコードと突き合わせて見つかったもの）

- [ ] **仕訳の登録で決算書・総勘定元帳のキャッシュが消えない**
  - `app/web/src/app/api/journals/route.ts` が `closing:statements:${year}`・`reports:ledger:${year}:*` を消しているが、実際のキーには tenantId が入っている（`closing:statements:${tenantId}:${year}` など。readme 20.8節）。`closing/finalize` と同じキーに直す。
- [ ] **Holt / Holt-Winters の予測が線形回帰として保存される**
  - 画面と API は `holt`・`holt_winters` を受け付けるが、`ForecastMethod` の列挙型に値がなく、`src/lib/forecast.ts` の `toDbForecastMethod` で `LINEAR_REGRESSION` に変わる。列挙型に値を足すマイグレーションを作る。
- [ ] **開発環境のセッションの掃除（`session-cleanup`）が成功しない**
  - `session-cleanup` は `CLEANUP_SERVICE_KEY` の Bearer で呼ぶが、`web` にはこの値を渡していないので、admin のセッションを求められて失敗する。既定値 `local-cleanup-key` は、設定の検査の条件（32文字以上）も満たさない。
- [ ] **`/card-transactions` がページの保護の対象に入っていない**
  - `app/web/src/middleware.ts` の保護するパスの一覧と matcher に `/card-transactions` を足す（API はログインを求めるので、データは漏れない）。
- [ ] **設定の値が読まれていない**
  - `SESSION_IDLE_HOURS`・`SESSION_ABSOLUTE_DAYS`・`UPLOAD_MAX_BYTES` は `config-schema.ts` で検査するが、使われていない（`auth.ts` は24時間・7日を直接書いている）。使うか、消す。
- [ ] **文言と実際の動きのずれ**
  - 税理士ポータルの説明が「複数テナント横断」だが、`/api/portal` は自分のテナントだけを返す（readme 25章の未決事項と合わせて決める）。
  - `/card-transactions` の説明が「引き落とし自体の登録は銀行管理の『資金移動』で行います」だが、タブの名前は「振替」。
  - モバイルの `app.json` の `extra.apiBaseUrl` は、どこからも読まれていない（接続先は `EXPO_PUBLIC_API_BASE_URL`）。消すか、既定値として読む。
  - 言語の切り替え（日本語 / English）がログアウトの表記しか変えない。

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
