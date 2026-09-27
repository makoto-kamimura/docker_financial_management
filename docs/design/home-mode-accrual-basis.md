# 家庭モード 発生主義設計

家庭の収支管理に「発生主義（accrual basis）」の考え方を取り入れ、  
より実態に即した家計の可視化を実現するための設計をまとめます。

---

## 1. 現金主義と発生主義の違い（家庭における具体例）

| ケース | 現金主義（デフォルト） | 発生主義（取り込みたい概念） |
| ------ | ---------------------- | ---------------------------- |
| 火災保険（年払い4月に¥60,000支払） | 4月に¥60,000を計上 | 月¥5,000 × 12ヶ月で配分 |
| 電気代（12月分が1月に請求・引落） | 1月に計上 | 12月の費用として計上 |
| 給与（12月分が1月25日に振込） | 1月に計上 | 12月の収入として計上 |
| 固定資産税（年4回分割納付） | 各納付時に計上 | 月次で1/12ずつ計上 |
| 不動産収入（翌月末に入金） | 入金月に計上 | 賃貸期間の属する月に計上 |

> **方針**: 現金主義をデフォルトとし、ユーザーが任意に発生主義を適用できる設計とします。  
> 全科目に強制適用するのではなく、**発生ズレが大きい科目に限定**することで家庭ユーザーの負担を最小化します。

---

## 2. 経過勘定科目の追加

発生主義を支えるために、以下の4科目を家庭モードに追加します。

### H-5xxx: 経過勘定（ASSET / LIABILITY）

| コード | 勘定科目名 | カテゴリ | 説明 |
| ------ | ---------- | -------- | ---- |
| H-5001 | 前払費用   | ASSET    | 支払済みだがまだ費用化していない金額（保険料・年会費等の先払い分） |
| H-5002 | 未払費用   | LIABILITY | 費用は発生したがまだ支払っていない金額（光熱費・クレジット請求待ち等） |
| H-5003 | 未収収益   | ASSET    | 収益は発生したがまだ受け取っていない金額（給与・配当等の未入金分） |
| H-5004 | 前受収益   | LIABILITY | 受取済みだがまだ収益化していない金額（前受家賃・前払サービス料等） |

### 仕訳の流れ（例: 火災保険年払い）

```
【4月: 保険料支払時】
  普通預金  −¥60,000
  前払費用  +¥60,000   ← H-5001

【毎月末: 費用振替】
  前払費用  −¥5,000
  火災保険  +¥5,000    ← H-3028（月次自動振替）
```

### 仕訳の流れ（例: 12月分電気代が1月に請求）

```
【12月末: 発生計上】
  電気代    +¥12,000   ← H-3001
  未払費用  +¥12,000   ← H-5002（前月実績ベースで自動提案）

【1月: 実際の引落時】
  未払費用  −¥12,000
  普通預金  −¥12,500   ← 実際の金額
  電気代    +¥500      ← 見積と実績の差額調整
```

---

## 3. 発生主義が有効な科目と自動化方針

### 自動期間配分が有効な科目（年払い・半期払い）

| 科目コード | 科目名             | 自動配分方式           | 前払費用への振替タイミング |
| ---------- | ------------------ | ---------------------- | -------------------------- |
| H-3011     | 自動車保険         | 支払月数で均等割り     | 支払時に前払費用、月末に振替 |
| H-3027     | 生命保険           | 払込期間で均等割り     | 同上 |
| H-3028     | 火災保険・地震保険 | 保険期間で均等割り     | 同上 |
| H-3029     | 学資保険           | 払込期間で均等割り     | 同上 |
| H-3012     | 自動車税           | 12ヶ月で均等割り       | 課税年度の各月末に振替 |
| H-3013     | 固定資産税         | 4期で均等割り → 月次  | 課税年度の各月末に振替 |
| H-3030     | 所得税             | 12ヶ月で均等割り       | 翌年確定申告後に精算 |
| H-3014     | 住民税             | 12ヶ月（4期）で均等割り | 同上 |
| H-3032     | サブスクリプション費 | 支払サイクルで均等割り | 年払いの場合のみ |

### 月次未払計上が有効な科目（当月使用・翌月請求）

| 科目コード | 科目名             | 発生タイミング | 確定タイミング |
| ---------- | ------------------ | -------------- | -------------- |
| H-3001     | 電気代             | 使用月末       | 請求書到着・引落時 |
| H-3002     | ガス代             | 使用月末       | 同上 |
| H-3003     | 水道代             | 使用月末（2ヶ月ごと） | 同上 |
| H-3004     | 固定ネット回線     | 使用月末       | 翌月引落時 |
| H-3005     | モバイルネット回線 | 使用月末       | 翌月引落時 |

### 収入側で発生認識が有効な科目

| 科目コード | 科目名   | 発生タイミング    | 入金タイミング     |
| ---------- | -------- | ----------------- | ------------------ |
| H-1001     | 給与     | 勤務月の末日      | 翌月25日前後       |
| H-1002     | 賞与     | 支給決定日        | 支払日             |
| H-1003     | 株式配当 | 権利確定日        | 支払日（数ヶ月後） |
| H-1006     | 不動産所得 | 賃貸期間の各月末 | 翌月末等           |

---

## 4. システム設計

### 4-1. 既存モデルの拡張方針

既存の `AccruedRevenue` / `AccruedExpense` を家庭モードにも適用します。  
`mode` フィールドを追加してモードを区別します。

```prisma
model AccruedRevenue {
  // 既存フィールド（変更なし）
  id          Int      @id @default(autoincrement())
  description String
  amount      Decimal  @db.Decimal(18, 2)
  accrualDate DateTime
  account     Account  @relation(fields: [accountId], references: [id])
  accountId   Int
  fiscalYear  Int
  status      String   @default("pending") // pending / posted / adjusted

  // 追加フィールド
  mode        String   @default("HOME")    // HOME / SOLE_PROP / CORPORATE
  settledAmount Decimal? @db.Decimal(18, 2) // 確定時の実績金額（見積との差額計算用）
  settledAt   DateTime?                     // 実際の入金日
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model AccruedExpense {
  // 既存フィールド（変更なし）
  id          Int      @id @default(autoincrement())
  description String
  amount      Decimal  @db.Decimal(18, 2)
  accrualDate DateTime
  account     Account  @relation(fields: [accountId], references: [id])
  accountId   Int
  fiscalYear  Int
  status      String   @default("pending") // pending / posted / adjusted

  // 追加フィールド
  mode          String   @default("HOME")
  settledAmount Decimal? @db.Decimal(18, 2) // 確定時の実績金額
  settledAt     DateTime?                   // 実際の支払日
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 4-2. 期間配分テーブル（新規）

年払い・半期払い等の自動期間配分を管理します。

```prisma
model PrepaidAllocation {
  id             Int      @id @default(autoincrement())
  userId         Int
  user           User     @relation(fields: [userId], references: [id])
  accountId      Int
  account        Account  @relation(fields: [accountId], references: [id])
  description    String
  totalAmount    Decimal  @db.Decimal(18, 2) // 支払総額
  periodMonths   Int      // 配分月数（例: 12）
  startMonth     DateTime // 配分開始月
  monthlyAmount  Decimal  @db.Decimal(18, 2) // 月次配分額
  remainingAmount Decimal @db.Decimal(18, 2) // 未配分残高
  status         String   @default("active") // active / completed / cancelled
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  allocations    PrepaidAllocationEntry[]
}

model PrepaidAllocationEntry {
  id             Int                @id @default(autoincrement())
  allocationId   Int
  allocation     PrepaidAllocation  @relation(fields: [allocationId], references: [id])
  targetMonth    DateTime           // 配分対象月
  amount         Decimal            @db.Decimal(18, 2)
  status         String             @default("pending") // pending / posted
  postedAt       DateTime?
  createdAt      DateTime           @default(now())
}
```

### 4-3. エントリー入力への発生主義フィールド追加

収支入力時に以下フィールドを追加します。

| フィールド | 型 | 説明 |
| ---------- | -- | ---- |
| `accrualDate` | DateTime? | 発生日（空欄の場合は支払日 = 発生日として現金主義で扱う） |
| `isSplit` | Boolean | 期間配分フラグ |
| `splitMonths` | Int? | 配分月数（isSplit=true の場合） |

---

## 5. UI設計

### 5-1. 収支入力画面への発生主義オプション

```
┌──────────────────────────────────────────┐
│  支出を記録                               │
│                                          │
│  科目:   [火災保険・地震保険 ▼]          │
│  金額:   ¥60,000                         │
│  支払日: 2026-04-01                      │
│                                          │
│  ┌─ 発生主義オプション ─────────────┐   │
│  │ □ 期間配分する                   │   │← チェックで展開
│  │   配分期間: [12] ヶ月             │   │
│  │   開始月:   2026年4月             │   │
│  │   月次配分: ¥5,000 / 月          │   │
│  └──────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

### 5-2. 月次未払費用の自動提案

月末に以下の提案通知を表示します。

```
┌──────────────────────────────────────────────────┐
│  📋 12月の発生費用を確認してください              │
│                                                  │
│  以下の費用が12月に発生していますが、            │
│  まだ未計上の可能性があります。                  │
│                                                  │
│  • 電気代: 前月実績 ¥12,000（推定）  [計上する] │
│  • ガス代: 前月実績 ¥8,500（推定）   [計上する] │
│  • 水道代: 偶数月請求のためスキップ              │
│                                                  │
│  ※ 実際の金額は請求書到着時に調整されます       │
│                                       [後で確認] │
└──────────────────────────────────────────────────┘
```

### 5-3. ダッシュボードの表示切り替え

```
月次収支サマリー
  表示モード: [現金主義 ●] [発生主義 ○]

  発生主義モードでは：
  - 光熱費が「使用月」に表示されます
  - 給与が「勤務月」に表示されます
  - 保険料が「保険期間」に月次配分されます
```

---

## 6. 個人事業主・法人モードとの連携

発生主義の経過勘定（H-5xxx）は、モード切替時に以下のように変換されます。

| 家庭コード | 家庭科目名 | 個人事業主科目名 | 法人科目名   | 調整区分 |
| ---------- | ---------- | ---------------- | ------------ | -------- |
| H-5001     | 前払費用   | 前払費用         | 前払費用     | ✅       |
| H-5002     | 未払費用   | 未払費用         | 未払費用     | ✅       |
| H-5003     | 未収収益   | 未収収益         | 未収収益     | ✅       |
| H-5004     | 前受収益   | 前受収益         | 前受収益     | ✅       |

> 経過勘定科目は家庭・個人事業主・法人で名称が同じため、**変換不要の唯一のカテゴリ**です。  
> 法人モードでは発生主義が原則必須となるため、家庭モードで発生主義を使っていたデータはそのまま引き継げます。

---

## 7. 実装フェーズ

| フェーズ | 内容 |
| -------- | ---- |
| **Phase A** | AccruedRevenue / AccruedExpense に `mode` / `settledAmount` / `settledAt` を追加する migration |
| **Phase B** | PrepaidAllocation / PrepaidAllocationEntry テーブルの追加 migration |
| **Phase C** | 経過勘定4科目（H-5001〜H-5004）を家庭モード科目マスタに追加 |
| **Phase D** | 収支入力画面に「期間配分」オプション追加（フロントエンド） |
| **Phase E** | 月次未払費用の自動提案ロジック（前月実績ベースの推定計上） |
| **Phase F** | ダッシュボードの現金主義 / 発生主義 表示切り替え |

---

## 関連ドキュメント

- [家庭モード 勘定科目一覧](./home-mode-accounts.md)
- [勘定科目変換マスタ](./account-master-mapping.md)
- [勘定科目変換システム仕様](./account-conversion-system.md)
