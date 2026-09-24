# app/mobile

カケイカイケイ（決算管理システム）の **モバイルアプリ**（Expo / React Native）。
Web と共通のバックエンド API (`/api/*`) を参照する。

## 開発

```bash
npm install
npm run start          # Expo Dev Server
npm run typecheck      # 型チェック
npm run format:check   # 整形チェック（npm run format で整形）
```

API の接続先は環境変数 `EXPO_PUBLIC_API_BASE_URL`（例: `http://192.168.x.x:3000/api`）で指定する。
未設定のときは Expo 開発サーバーのホスト（`http://<host>:3000/api`）に自動で接続する。

## Web 版との関係

- 予算・実績・銀行・カード・資産・借入の各画面は、Web 版と同じ表示内容・計算・操作を持つ。
- 仕訳帳・インボイス・決算・ガバナンス・設定は閲覧のみ。変更は Web 版で行う。
- CSV インポート、帳票の出力・印刷、Web 版だけにある画面（仕訳テンプレート・総勘定元帳など）は非対応。

### Web と共有するロジック（`src/shared/`）

表示ラベル・モード別の用語・借入の償還計算などは、Web の `app/web/src/lib/` にある同名ファイルを
そのまま複製して使う（計算結果や文言が Web とずれないようにするため）。

- `src/shared/` のファイルは直接編集しない。Web 側を直してから、`app/web` で `npm run sync:mobile` を実行する。
- 共有する対象は `app/web/src/lib/shared-with-mobile.ts` の一覧で管理する。
- 複製がずれていると Web の単体テスト（`shared-with-mobile.test.ts`）が失敗する。
