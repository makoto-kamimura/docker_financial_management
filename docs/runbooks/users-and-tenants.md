# ユーザーとテナント

ユーザーとテナントの作成、勘定科目の初期データの投入の手順。仕様は [readme 3章](../../readme.md#3-ユーザー種別と権限)・[6.3節](../../readme.md#63-ユーザーとテナントの作成)を参照。

## 1. 初期データのアカウント

`npm run db:seed`（空の DB なら web の起動時に自動で実行）で、デモテナント（id=1、株式会社テックソリューション）と、次のユーザーを作る。パスワードはいずれも `password`。

| メール | ロール |
|---|---|
| `admin@example.com` | admin |
| `editor@example.com` | editor |
| `viewer@example.com` | viewer |
| `demo@example.com` | editor |

accountant のロールは、`/admin/users` でロールを変えて使う。実際に使うアカウントは初期データに含まれないので、DB を作り直したら作り直す。

## 2. ユーザーを作る

1. admin で `/admin/users` を開く。
2. メールアドレス・名前・パスワード・ロールを入れて作る。
   - 既定では、自分と同じテナントに所属する（同じデータを共有する）。
   - 別の家庭・事業として始めるときは「専用の新規テナントを作成する」を選ぶ。空のテナントを作り、家計の既定の勘定科目（76科目）と予算配分の目安を登録する。**作ったユーザーは、自分のユーザー管理には表示されなくなる。**
3. 作ったユーザーでログインし、必要なら多要素認証を設定する。

## 3. 既存のテナントに既定の勘定科目を入れる

既定の勘定科目の自動登録より前に作ったテナントには、科目が入っていない。`seedDefaultAccountsForTenant` を一度呼んで入れる（登録済みのコードは上書きしない）。

```bash
cd app/web
npx tsx -e 'import { PrismaClient } from "@prisma/client"; import { seedDefaultAccountsForTenant } from "./src/lib/default-accounts"; const p = new PrismaClient(); seedDefaultAccountsForTenant(p, <tenantId>).finally(() => p.$disconnect());'
```

## 4. 勘定科目変換を試すための初期データ

`npm run db:seed` だけでは、変換に使う法人の科目・家計の科目・変換ルールは入らない。`/account-conversion` を試すときは、次を追加で実行する（デモテナント向け）。

```bash
cd app/web
npm run db:seed:business-accounts   # 法人・個人事業主の勘定科目
npm run db:seed:home-accounts       # 家計の勘定科目（H-、76件。モード別の表示名つき）
npm run db:seed:account-mapping     # 家計 → 法人の変換ルール（76件、システム定義）
```

表示名の出典は [design/account-master-mapping.md](../design/account-master-mapping.md)。入れたあとは `/settings` の「科目名設定」で編集できる。
