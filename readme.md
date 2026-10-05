# カケイカイケイ

> **家計簿から、決算書まで。ひとつの帳簿で。**

家庭の家計管理から、個人事業主の青色申告、法人の決算までを、**同じデータ・同じ画面**で扱う会計アプリ。銀行口座とカードの実際のお金の流れを中心に、予算と実績を比べ、将来の残高と資金繰りを先回りして確かめられる。Web とモバイル（iOS / Android）から使える。

呼称の「カケイカイケイ」は、家計の「カケイ」と会計の「カイケイ」を掛け合わせたもの（旧称：決算管理システム）。リポジトリ名・パッケージ名・Docker のサービス名などの識別子は `financial-management` のままにしている。

## コンセプト

家計簿アプリと会計ソフトは、別々の道具として作られている。そのため、副業を始めたり法人を作ったりすると、家計簿のデータを会計ソフトに入れ直すことになり、銀行口座やカードの明細も、それぞれのアプリに取り込み直すことになる。

カケイカイケイは、**一家庭を一法人に見立てる**ことで、この入れ直しをなくす。

| 考え方 | 内容 |
|---|---|
| 家計も会計も、同じ帳簿で | 家計の「収入・固定費・貯蓄」を、会計の「売上・販管費・利益」と同じ仕組みで記録する。家計 → 個人 → 法人と、使い方が変わってもデータを作り直さない |
| 見る人に合わせて、言葉を変える | 表示モード（家計 / 個人 / 法人）を切り替えると、科目名・用語・メニューがそのモードのものになる。データはそのまま |
| お金の流れは、口座とカードから | 銀行とカードの明細を取り込み、科目を付けて実績に転記する。口座間の振替やチャージは、収支から除いて二重計上を防ぐ |
| 先の残高を、先に知る | 毎月の給与・引き落とし・振替を資金移動ルールとして登録すると、残高推移と、残高が足りなくなる日（資金繰り）が自動で出る |
| 学びながら、使う | 自分の家計データを教材に、複式簿記・決算・申告書の作り方を学べる |

| 項目 | 内容 |
|---|---|
| ステータス | **主要機能は実装済み**（Web・モバイル。[ロードマップ](#17-開発ロードマップ)の Phase 0〜7 完了）。本番運用に向けた設定と、見つかった不具合の修正が残る（[25. 未決事項](#25-未決事項)） |
| リリース日 | 未定 |
| 作成者 | **Makoto Kamimura** — [@makoto-kamimura](https://github.com/makoto-kamimura) |

このREADMEは、プロジェクト紹介と仕様書を兼ね、次の2部と付録で構成する。

| 部 | 内容 | 主な読者 |
|---|---|---|
| [第1部 概要説明](#第1部-概要説明) | サービスの目的、機能と画面の仕様、ロードマップ | すべての人 |
| [第2部 技術説明](#第2部-技術説明) | 技術スタック、システム構成、クイックスタート、実装方針、データモデル、API、非機能要件 | 開発者 |
| [付録](#付録) | 決定事項、未決事項 | すべての人 |

設計の詳細資料・運用手順書・タスクは [docs/](docs/README.md) に置いている。

## 目次

- [コンセプト](#コンセプト)
- [第1部 概要説明](#第1部-概要説明)
  - [特徴](#特徴) / [使い方のイメージ](#使い方のイメージ)
  - [1. 概要](#1-概要) / [2. 用語](#2-用語) / [3. ユーザー種別と権限](#3-ユーザー種別と権限) / [4. 基本フロー](#4-基本フロー) / [5. 画面一覧](#5-画面一覧)
  - [6. 認証とアカウント](#6-認証とアカウント) / [7. ダッシュボードと予測](#7-ダッシュボードと予測) / [8. 予算](#8-予算) / [9. 実績](#9-実績)
  - [10. 銀行管理](#10-銀行管理) / [11. カード・電子マネー](#11-カード電子マネー) / [12. 資産と借入金](#12-資産と借入金)
  - [13. 会計帳簿](#13-会計帳簿) / [14. 決算と申告](#14-決算と申告) / [15. 法人管理](#15-法人管理) / [16. 勘定科目変換・学習ガイド・外部連携](#16-勘定科目変換学習ガイド外部連携)
  - [17. 開発ロードマップ](#17-開発ロードマップ)
- [第2部 技術説明](#第2部-技術説明)
  - [18. 技術スタックとシステム構成](#18-技術スタックとシステム構成)（[クイックスタート](#187-クイックスタート)を含む）
  - [19. 認証の実装](#19-認証の実装) / [20. 機能ごとの実装方針](#20-機能ごとの実装方針) / [21. データモデル](#21-データモデル) / [22. API](#22-api) / [23. 非機能要件](#23-非機能要件)
- [付録](#付録)
  - [24. 決定事項](#24-決定事項) / [25. 未決事項](#25-未決事項)

---

# 第1部 概要説明

サービスの目的・機能・画面の仕様をまとめる。技術的な内容は[第2部](#第2部-技術説明)に分ける。

## 特徴

| 特徴 | 内容 |
|---|---|
| 3つの表示モード | 家計 / 個人 / 法人 を切り替えると、メニュー・科目名・KPIの呼び方（貯蓄率 ⇔ 営業利益率 など）が変わる。データは共通 |
| 予算と実績 | 科目×月の表で予算と実績を管理する。収入に対する配分の目安（適正額）を示し、借入金の返済額は予算に自動で反映する。月ごとに科目別の予実を比べ、差額の扱いを選んで翌月の予算を確定する |
| 銀行管理 | 口座ごとに明細を CSV で取り込み、科目を付けて実績に転記する。口座間の振替は、収支から除いて残高だけに反映する |
| 残高推移と資金繰り | 毎月の給与・引き落とし・振替を資金移動ルールとして登録すると、過去の実績と先の見込みの残高推移、3か月先までの資金不足（入金の期限と金額）が自動で出る |
| カード・電子マネー | クレジット・デビット・プリペイドカード・電子マネーの明細を取り込み、チャージや固定決済（サブスクリプションなど）を管理する |
| 資産と借入金 | 口座・実物資産・借入金から総資産（純資産）を出す。変動金利の見直しや残価のある借入にも対応した返済スケジュールを作る |
| 複式簿記の帳簿 | 仕訳帳（承認のワークフローつき）、仕訳テンプレート、総勘定元帳、試算表、売掛金・買掛金、インボイス、棚卸、固定資産と減価償却、家事按分 |
| 決算と申告 | 損益計算書・貸借対照表・株主資本等変動計算書・財務分析。青色申告決算書・法人決算書類の印刷、e-Tax 向け XML の出力 |
| 法人管理 | 法人・事業者情報、会計年度、役員・株主総会・配当・決算公告 |
| 勘定科目変換 | 家計の科目を法人の科目へ対応付ける候補を自動で出し、確認して確定する |
| 学習ガイド | 自分のデータを教材に、複式簿記・決算書の読み方・申告書の選び方を学べる |
| 安全性 | 多要素認証（TOTP）、4段階のロール、テナント単位のデータ分離、監査ログ |

## 使い方のイメージ

```mermaid
flowchart LR
  A["口座・カードを登録して<br/>明細を取り込む"] --> B["科目を付けて<br/>実績に転記する"]
  B --> C["予算と実績を<br/>ダッシュボードで比べる"]
  A --> D["資金移動ルールから<br/>残高推移と資金繰りを見る"]
  B --> E["個人・法人モードで<br/>仕訳・決算・申告書へ"]
```

## 1. 概要

### 1.1 ポジショニング

家計簿アプリと、個人事業主・中小法人向けの会計ソフトの中間に位置付ける。

| 取り込み元 | 取り込む要素 | 本サービスでの形 |
|---|---|---|
| 家計簿アプリ | 口座・カードの明細の取り込み、予算と実績、資産の推移 | **予算・実績・銀行・カード・資産**（[第8〜12章](#8-予算)） |
| 会計ソフト | 複式簿記、帳簿、決算書、申告書類 | **会計帳簿・決算と申告**（[第13〜14章](#13-会計帳簿)） |
| 独自 | 家計と会計を同じデータで扱う表示モード、資金繰りの見通し、学習ガイド | **表示モード・勘定科目変換・学習ガイド**（[3.3節](#33-表示モード)・[第16章](#16-勘定科目変換学習ガイド外部連携)） |

### 1.2 原則

**データは1つ、見え方は3つ。** 家計・個人・法人のどのモードで入力しても、同じ科目・同じ実績として保存する。モードは見え方（メニュー・科目名・用語）だけを変える。

### 1.3 想定ユースケース

| ユースケース | 使うモード | 主な機能 |
|---|---|---|
| 共働き世帯の家計管理 | 家計 | 予算配分、銀行・カードの明細、残高推移、住宅ローン |
| 副業・フリーランスの確定申告 | 個人 | 仕訳帳、家事按分、減価償却、青色申告決算書 |
| 小さな法人の経理 | 法人 | インボイス、売掛金・買掛金、法人決算書類、ガバナンス |
| 税理士による確認 | 個人・法人 | accountant ロールでの閲覧・仕訳の承認・申告書類の出力 |
| 家計から法人成り | 家計 → 法人 | 勘定科目変換、学習ガイド |

## 2. 用語

| 用語 | 意味 |
|---|---|
| テナント | データを分ける単位。1つの家庭・個人事業主・法人を表す（種別は個人事業主 / 法人）。1つのテナントに複数のユーザーが所属でき、ユーザーは所属するテナントのデータだけを扱える |
| ロール | ユーザーの権限。admin > editor > accountant > viewer の4段階（[3.1節](#31-ロール)） |
| 表示モード | 家計 / 個人 / 法人。ユーザーごとの見え方の設定で、データは分けない（[3.3節](#33-表示モード)） |
| 勘定科目 | 収入・支出・資産・負債などの分類。家計の科目名を基本とし、個人・法人モードでの表示名を別に持てる。家計の科目のコードは `H-` で始まる |
| 予算配分・適正額 | 収入に対する各費目の割合の目安（固定費・生活費・その他）。「適正 ¥…」は、その月の収入×目安の割合で、予算そのものは変えない |
| 自動反映 | 借入金の月々の返済額などを、予算の表示に上乗せすること。予算のデータは変えない |
| 予算の確定・期ズレ | 確定は、月の予算を予実対比の基準として固定すること。確定した月の予算は変えられない。期ズレは、支払いや入金の時期がずれただけの差で、翌月の予算に移す |
| 実績・転記 | 実績は科目×月の金額。銀行・カードの明細に科目を付けて実績に計上することを転記という。転記は利用者が行い、自動では行わない |
| 資金移動ルール | 毎月決まった日に発生するお金の動き（給与・収入 / 支出 / 銀行振込 / 銀行引き落とし / カード引き落とし）。出金元・入金先のどちらかは「外部」にできる。明細から登録したものを固定入出金と呼ぶ |
| 振替 | 自分の口座どうしのお金の移動。2つの明細を組にして、収支から除き、残高だけに反映する |
| 引き落とし | 口座から決まった日に引き落とされるもの。銀行引き落としと、カードの利用分をまとめて引き落とすカード引き落としがある |
| カード払いの固定決済 | サブスクリプションなど、カードで決まった日に支払うもの。お金はカード引き落としで口座から出るので、銀行の資金繰りには含めない（二重計上を防ぐため） |
| チャージ | デビットカード・プリペイドカード・電子マネーへの入金。お金の置き場所が変わるだけなので、収支から除く。クレジットカードはチャージ先にできない |
| 差額（残高調整） | 口座の残高 ＝ 取り込んだ明細の合計 ＋ 差額。明細を取り込み始める前の残高（期首残高）や、取り込めていない明細の分を差額で合わせる |
| 残高推移 | 実績の残高（実線）と、資金移動ルールから見込んだ先の残高（破線） |
| 資金繰り | 今の残高と資金移動ルールから、残高が初めてマイナスになる日（入金の期限）と、入金が必要な金額を出したもの。3か月先まで |
| 実物資産 | 土地・建物・車・金・現金・預金・有価証券など。借入金をひも付けられる |
| 総資産サマリ | 口座 ＋ 実物資産 − 借入金 で出す純資産 |
| 家事按分 | 経費の科目ごとの事業で使った割合。個人モードだけで使う |
| 決算確定 | 会計年度を締めること。取り消して開き直せる |

## 3. ユーザー種別と権限

### 3.1 ロール

| ロール | 段階 | できること |
|---|---|---|
| viewer | 1 | すべての画面の閲覧 |
| accountant | 2 | viewer ＋ 仕訳の承認、e-Tax XML の出力、税理士ポータル |
| editor | 3 | accountant ＋ データの登録・編集・削除 |
| admin | 4 | editor ＋ ユーザー管理・監査ログ・テナントの作成と削除 |

各 API は必要な最低のロールを持ち、それより低いロールのユーザーには 403 を返す（[22章](#22-api)）。

### 3.2 テナント

- すべての財務データはテナントに属し、ユーザーは自分のテナントのデータだけを読み書きできる。
- ユーザー管理（`/admin/users`）も、自分のテナントのユーザーだけが対象になる。
- テナントの種別は個人事業主 / 法人。屋号・法人名、法人番号、資本金、決算月を持つ。
- テナントを作ると、家計の既定の勘定科目（76科目。モード別の表示名つき）と予算配分の目安が自動で登録される。

### 3.3 表示モード

表示モードは、ブラウザ（モバイルはアプリの起動中）ごとの設定で、データは分けない。切り替えると次が変わる。

| 変わるもの | 家計 | 個人 | 法人 |
|---|---|---|---|
| システム名 | 家計管理システム | 個人会計システム | 法人会計システム |
| 損益の用語 | 収入 / 変動費 / 収支差額 / 固定費 / 手残り | 売上 / 仕入・変動費 / 粗利 / 経費 / 事業利益 | 売上高 / 売上原価 / 売上総利益 / 販管費 / 営業利益 |
| KPI の呼び方 | 貯蓄額・貯蓄率 | 事業利益・事業利益率 | 営業利益・営業利益率 |
| 科目名 | 家計の科目名 | 個人事業主の表示名 | 法人の表示名 |

メニューはモードごとに出し分ける（○＝表示）。

| グループ | 項目 | 家計 | 個人 | 法人 |
|---|---|:-:|:-:|:-:|
| 基本 | ダッシュボード・予算管理・実績管理 | ○ | ○ | ○ |
| 会計帳簿 | 仕訳帳・仕訳テンプレート・総勘定元帳・売掛金管理・買掛金管理・インボイス発行 | | ○ | ○ |
| 資産・経費管理 | 棚卸管理・固定資産 | | ○ | ○ |
| | 家事按分 | | ○ | |
| | 資産管理・借入金管理・銀行管理・カード・電子マネー管理 | ○ | ○ | ○ |
| | 外部サービス連携 | | ○ | ○ |
| 決算・申告 | 決算処理 | | ○ | ○ |
| 法人管理 | 法人・事業者情報・ガバナンス管理 | | | ○ |
| | 会計年度管理 | | ○ | ○ |
| 設定・管理 | 勘定科目変換・学習ガイド・税理士ポータル | | ○ | ○ |
| | 設定・ユーザー管理・監査ログ | ○ | ○ | ○ |

- メニューの出し分けは表示だけで、URL を直接開けばどの画面も使える。
- 家計から法人へ直接切り替えると、勘定科目変換の画面を開くかを確認する。

## 4. 基本フロー

### 4.1 はじめて使う

1. admin が `/admin/users` でユーザーを作る（新しい家庭・事業として始めるときは「専用の新規テナントを作成する」を選ぶ）。自分で登録する画面はない。
2. `/login` でログインする（多要素認証を有効にしていれば、続けて確認コードを入れる）。
3. ダッシュボードの「ステップ進捗」に沿って進める。6つの手順を終えると、進捗の表示は消える。
   1. 収入の予算を入れる（予算管理）
   2. 予算配分のタブで支出の予算を割り振る
   3. 銀行口座を登録する（銀行管理）
   4. 実物資産を登録する（資産管理）
   5. 借入金を登録する（借入金管理。予算に自動で反映される）
   6. 表示モードを一度切り替える

### 4.2 銀行口座とお金の流れを登録する

1. 銀行管理のサマリで口座を追加する。実際の残高と合わないときは、口座の編集から差額を入れる。
2. 明細を CSV で取り込み、明細ごとに科目を付けて実績に転記する。チャージや固定入出金としても登録できる。
3. 振替のタブで、毎月の資金移動ルール（給与・引き落とし・振込など）を登録する。一度きりの振替や、取り込んだ明細どうしの振替の組み合わせもここで行う。
4. サマリで残高推移と資金繰りを確かめる。

### 4.3 カード・電子マネーを登録する

1. カード・電子マネー管理で、カードや電子マネーを登録する。
2. 明細を CSV で取り込み、科目を付けて転記する。
3. チャージの明細は、チャージ先の入金の明細と組にする。
4. サブスクリプションなどは、明細から固定決済として登録する。
5. カードの利用分の引き落とし自体は、銀行管理の振替でカード引き落としとして登録する。

### 4.4 予算を立てて実績と比べる

1. 予算管理で、科目×月の予算を入れる（予算配分の目安や CSV の取り込みを使える）。
2. 実績は、銀行・カードからの転記、仕訳、手入力・CSV で集まる。
3. ダッシュボードで KPI・構成比・予測を確かめる。赤字の月は赤で表示する。
4. 月が終わったら、ダッシュボードの「予実と確定」（KPI の下）でその月を選び、科目ごとの予算と実績の差を確かめる。
5. 差額の扱い（何もしない・期ズレとして翌月へ・回し先へ）を科目ごとに選ぶと、翌月の予算案ができる。必要なら案の金額を直す（流用）。
6. 「確定」を押すと、案が翌月の予算になり、翌月は確定済みになる。翌月が終わったら、その月を選んで 4 から繰り返す。

### 4.5 借入金を管理する

1. 借入金管理で借入を登録する（種類・金利・残価・予算に反映する科目）。
2. 変動金利が見直されたら「金利変更の登録」で新しい金利（通知された返済額があればそれも）を入れる。見直し前後の比較が出る。
3. 返済を登録する。月々の返済額は予算に「自動反映」として上乗せされる。

### 4.6 帳簿をつけて決算・申告する（個人・法人モード）

1. 仕訳帳で取引を記録する（テンプレートを使える）。承認のワークフローを通す。
2. 売掛金・買掛金・インボイスを管理する。
3. 期末に、棚卸・固定資産の減価償却・家事按分（個人のみ）を済ませる。
4. 決算処理で決算書を確かめ、決算を確定する。
5. 青色申告決算書（または収支内訳書）・法人決算書類を印刷し、必要なら e-Tax 向けの XML を出力する。

### 4.7 家計から法人会計へ切り替える

1. 表示モードを家計から法人へ切り替えると、勘定科目変換を開くかを確認する。
2. 家計の科目ごとに、法人の科目の候補が自動で出る。確かめて確定する。手で直した対応は、次からの候補に使われる。
3. 学習ガイドで、家計と法人会計の対応や決算の流れを学べる。

## 5. 画面一覧

### 5.1 Web

`/login` と印刷用の2画面を除き、すべての画面は共通のサイドバー（表示モードの切り替えを含む）の中に表示する。

| URL | 画面 | 内容 |
|---|---|---|
| `/login` | ログイン | メールアドレスとパスワード。多要素認証を有効にしていれば、確認コードかリカバリーコードを入れる |
| `/dashboard` | ダッシュボード | ステップ進捗、KPI、予実と確定、予測手法の選択、カテゴリ構成比、月別カテゴリ内訳、月別の表 |
| `/budget` | 予算管理 | 明細一覧 / 予算配分 / CSV インポート / 履歴 |
| `/entry` | 実績管理 | 明細一覧 / カレンダー / CSV インポート / 履歴 |
| `/bank-accounts` | 銀行管理 | サマリ（口座・残高推移・資金繰り） / 明細一覧 / CSV インポート / 振替（資金フロー図・資金移動スケジュール） |
| `/bank-transactions` | — | `/bank-accounts?tab=transactions` へ転送する（以前の URL） |
| `/card-transactions` | カード・電子マネー管理 | サマリ（フロー図・引き落としと固定決済のスケジュール） / 明細一覧 / カレンダー / CSV インポート |
| `/assets` | 資産管理 | 総資産サマリ、実物資産 |
| `/loans` | 借入金管理 | 返済スケジュール、借入の追加・編集、金利変更、返済の登録 |
| `/journals` | 仕訳帳 | 仕訳の入力、証憑の添付、承認 |
| `/journal-templates` | 仕訳テンプレート | よく使う仕訳の雛形 |
| `/reports/ledger` | 総勘定元帳 | 年・科目ごとの取引の一覧、CSV 出力 |
| `/receivables` | 売掛金管理 | 入金の管理 |
| `/payables` | 買掛金管理 | 支払の管理 |
| `/invoices` | インボイス発行 | 適格請求書の発行 |
| `/inventories` | 棚卸管理 | 期末の棚卸の入力と確定 |
| `/fixed-assets` | 固定資産 | 固定資産台帳、減価償却 |
| `/apportionments` | 家事按分 | 科目ごとの事業の割合 |
| `/integrations` | 外部サービス連携 | freee・マネーフォワード・オープンバンキング |
| `/closing` | 決算処理 | 損益計算書 / 貸借対照表 / 月別収支 / 試算表 / 財務分析、決算確定、e-Tax XML |
| `/closing/print` | 青色申告決算書・収支内訳書 | 個人事業主向けの印刷 |
| `/closing/corporate-print` | 法人決算書類 | 法人向けの印刷 |
| `/corporate` | 法人・事業者情報 | テナントの情報 |
| `/fiscal-years` | 会計年度管理 | 会計年度の登録と開閉 |
| `/governance` | ガバナンス管理 | 役員 / 株主総会 / 配当 / 決算公告 |
| `/account-conversion` | 勘定科目変換 | 家計 → 法人の科目の対応を確かめて確定する |
| `/account-conversion/history` | 変換履歴 | 過去の変換 |
| `/learning` | 学習ガイド | 学習の話題と既読の管理 |
| `/portal` | 税理士ポータル | 財務の要約（accountant 以上） |
| `/settings` | 設定 | 基本設定（事業者情報） / 消費税設定 / 科目名設定 / 部門・担当 / セキュリティ（多要素認証） |
| `/admin/users` | ユーザー管理 | ユーザーの作成・ロールの変更（admin） |
| `/admin/audit` | 監査ログ | 操作の履歴（admin） |

### 5.2 モバイルアプリ

画面の下に4つのタブ（ホーム・予算・実績・その他）を置き、「その他」から残りの画面を開く。

| 画面 | 内容 | Web との違い |
|---|---|---|
| ログイン | パスワード、確認コード・リカバリーコード | 同じ |
| ホーム | ダッシュボードと同じ内容（予実と確定を含む） | 予実と確定は、予実と翌月の予算案を科目ごとに 1 つのブロックにまとめて表示する |
| 予算 | 明細一覧（1か月ずつ） / 予算配分 / 履歴 | CSV インポートなし。確定済みの月の予算はモバイルからも変えられない |
| 実績 | 明細一覧 / カレンダー / 履歴 | CSV インポートなし。仕訳と連動する実績は仕訳帳から直す |
| 銀行管理 | サマリ（口座・差額・残高推移・資金繰り） / 明細一覧 / 振替 | CSV インポートなし |
| カード・電子マネー管理 | サマリ / 明細一覧 / カレンダー。チャージ先・固定決済の登録 | CSV インポートなし |
| 資産管理 | 総資産サマリ、実物資産 | 同じ |
| 借入金管理 | 返済スケジュール、金利変更、返済 | 同じ |
| 仕訳帳・インボイス発行・決算処理（個人・法人） | 閲覧のみ | 変更は Web で行う |
| ガバナンス管理（法人） | 閲覧のみ | 変更は Web で行う |
| 設定 | 閲覧のみ | 変更は Web で行う |

仕訳テンプレート・総勘定元帳・売掛金・買掛金・棚卸・固定資産・家事按分・外部サービス連携・会計年度・法人情報・勘定科目変換・学習ガイド・管理者の画面・税理士ポータル・帳票の印刷は、モバイルにはない。

## 6. 認証とアカウント

### 6.1 ログイン

- メールアドレスとパスワードでログインする。ログインのあとは常にダッシュボードへ進む。
- パスワードを5回続けて間違えると、そのアカウントは15分ロックされる。
- セッションは、最後の操作から24時間、またはログインから7日で切れる。切れたら、ログイン画面に理由を表示して戻す。

### 6.2 多要素認証

- 設定のセキュリティで、認証アプリ（TOTP）を登録して有効にする。
- 有効にすると、ログインの2段階目で6桁の確認コードを求める。確認コードを入れられないときのために、使い捨てのリカバリーコードを発行できる。

### 6.3 ユーザーとテナントの作成

- ユーザーは admin が `/admin/users` で作る。既定では作った人と同じテナントに所属する。
- 「専用の新規テナントを作成する」を選ぶと、空のテナントを作ってそこに所属させる。
- 手順は [runbooks/users-and-tenants.md](docs/runbooks/users-and-tenants.md) にまとめている。

### 6.4 監査ログ

ログインと、データの登録・変更・削除を、変更前後の内容とともに記録する。パスワードなどの秘密の値は伏せて記録する。admin が `/admin/audit` で見られる。

## 7. ダッシュボードと予測

### 7.1 ステップ進捗

[4.1節](#41-はじめて使う)の6つの手順の進み具合を表示する。すべて終えると消える。

### 7.2 KPI

最新月の利益率・前年同月比（YoY）・前月比（MoM）・年初からの累計（YTD）を、表示モードの用語で表示する（家計なら貯蓄額・貯蓄率）。

KPI の下に、月ごとの予実を確かめて翌月の予算を確定する「予実と確定」を置く（[8.5節](#85-予実と確定)）。

### 7.3 予測

- 予測手法を、移動平均（既定）・線形回帰・成長率・Holt・Holt-Winters から選ぶ。
- 実績の終わった月の先を予測し、グラフでは予測の月を薄く表示する。
- 予測の精度（MAPE・RMSE）を、過去のデータで検証して出せる（API）。

### 7.4 グラフと月別の表

- カテゴリ構成比（円グラフ）と、月別カテゴリ内訳（積み上げ棒グラフ）。既定は対象月の前後6か月。グラフは PNG で保存できる。
- 月別の表では、赤字の月を赤で表示する。

## 8. 予算

### 8.1 明細一覧

科目×月の表で予算を入力・編集する。

### 8.2 予算配分

収入に対する費目ごとの割合の目安（予算配分ルール）から、支出の予算を提案する。既定の目安は次のとおり（設定で変えられる）。

| グループ | 費目（割合の目安） |
|---|---|
| 固定費 | 家賃・住宅ローン（20〜30%）、水道・光熱費（5〜8%）、通信費（3〜6%）、保険料（5〜10%） |
| 生活費 | 食費（15〜20%）、車関連（5〜15%）、日用品・衣服（3〜5%）、教育費（5〜15%） |
| その他 | 娯楽・交際費（5〜10%）、貯蓄・投資（20%〜） |

予算の表には、その月の収入から出した「適正 ¥…」を目安として表示する。

### 8.3 自動反映

借入金の月々の返済額（予算に反映する科目を指定したもの）と、実物資産にひも付けた借入の返済を、予算の表示に上乗せして「自動反映」の印を付ける。予算のデータは変えない。

### 8.4 CSV インポートと履歴

- 予算を CSV で一括登録できる。
- 予算の登録・変更・削除は履歴に残る。予算を消しても、履歴は科目と月とともに残る。

### 8.5 予実と確定

月ごとに、予算と実績を科目ごとに比べ、翌月の予算を確定する。会社の予算管理にならい、確定した予算は比べる基準として固定し、予算の余りは原則として繰り越さない。

画面はダッシュボードの KPI の下にある（モバイルはホームの同じ位置）。比べる月は KPI の対象月とは別に選び、既定は前月。

1. **予実対比**：選んだ月の収入・費用（`REVENUE` / `COGS` / `EXPENSE`）の科目ごとに、予算（自動反映を含む）・実績・差（実績−予算）を出す。費用は実績が予算より少なければ「余り」、多ければ「超過」とする。
2. **差額の扱い**：科目ごとに次から選ぶ。計算は `src/lib/budget-cycle.ts`。

   | 扱い | 翌月の予算案 | 既定 |
   |---|---|---|
   | 何もしない | 基準額のまま | 個人・法人モードのすべて。家計の超過と収入 |
   | 期ズレとして翌月へ | 基準額 ＋（予算 − 実績）。使わなかった分は足し、先に使った分は引く。0 円未満は 0 円にする | — |
   | 回し先へ | 余りを回し先の科目の予算に足す（費用の科目で余ったときだけ選べる） | 家計の余り（回し先があるとき） |

   - 翌月の基準額は、翌月に予算が入っていればその額、無ければ選んだ月の予算（引き継ぎ）。
   - 回し先の既定は、予算配分ルール「貯蓄・投資」にひも付けた科目。画面で変えられる。
   - 科目の間で予算を移す（流用する）ときは、案の金額を直接書き換える。
3. **確定**：「確定」で案を翌月の予算に書き込み（変更履歴も残す）、翌月を確定済みにする。予算をそのまま確定することもできる。
4. **確定済みの月**：予算の登録・変更・削除・CSV インポート・予算配分の反映を受け付けない（409）。明細一覧の月の見出しに鍵の印を付ける。確定の解除は admin だけができ、予算の値は変えずに確定の印だけを外す。確定と解除は監査ログに残す。

## 9. 実績

### 9.1 明細一覧とカレンダー

- 科目×月の表で実績を入力・編集する。
- カレンダーからは日付ごとに入力できる。カレンダーで入れた実績は、仕訳を自動で作る。

### 9.2 実績の出どころ

表のセルを開くと、金額の内訳を出どころごとに表示する。

| 出どころ | 内容 |
|---|---|
| 銀行明細から転記 | [10.2節](#102-明細) |
| カード明細から転記 | [11.2節](#112-明細と科目付け) |
| 仕訳と連動 | 仕訳帳の仕訳から作られた実績。仕訳を消すと一緒に消える |
| 手入力・CSV 取込 | この画面で入れたもの |

### 9.3 CSV インポートと履歴

- 実績を CSV で一括登録できる（Excel の取り込みは廃止した）。
- 実績の登録・変更・削除は履歴に残る。

## 10. 銀行管理

### 10.1 口座と残高

- 口座には、名前・銀行名・支店名・種別（普通 / 当座）・役割（給与 / 引き落とし / 貯蓄 / その他）・資産の科目を登録する。
- 残高は「取り込んだ明細の合計 ＋ 差額」で出す。明細を取り込む前の残高などは、差額で合わせる。
- この残高を、総資産サマリ・残高推移・資金繰りのすべてで使う。

### 10.2 明細

- 明細は CSV（`date,description,amount[,balance]`）で取り込む。同じ明細を二重に取り込まないように、明細ごとの識別子で重複を除く。
- 自動取得（同期）の仕組みもあるが、今はモックの取得先だけで、実際の銀行にはつながない（[25章](#25-未決事項)）。
- 明細ごとに次を行える。

| 操作 | 内容 |
|---|---|
| 科目を付ける | 摘要のキーワードから、学習したルールで科目を補う（補うだけで、転記はしない） |
| 実績に転記する | 科目を付けた明細を実績に計上する。同じ明細は二重に転記できない |
| チャージにする | チャージ先（デビット・プリペイド・電子マネー）を選ぶ。収支から除く |
| 振替にする | 別の口座の明細と組にする。収支から除く |
| 固定入出金にする | 毎月の資金移動ルールとして登録する |

### 10.3 振替と資金移動ルール

- **資金移動ルール**：毎月の決まった日のお金の動きを、種類（給与・収入 / 支出 / 銀行振込 / 銀行引き落とし / カード引き落とし）・日・金額・出金元・入金先で登録する。出金元・入金先は「外部」にできる（給与は外部から入金、支出は外部へ出金）。
- 一覧モードと、月のカレンダーで見るスケジュールモードがある。
- **振替の登録**：一度きりの口座間の振替を登録する。取り込んだ明細の中から、振替らしい組の候補を出して組にすることもできる。

### 10.4 残高推移

対象月の前後6か月の残高を、月ごと・日ごとで表示する。実績は実線、資金移動ルールからの見込みは破線で描く。

### 10.5 資金繰り

今の残高と資金移動ルールから、3か月先までの日ごとの残高を計算し、口座ごとに、残高が初めてマイナスになる日（入金の期限）と、必要な入金額を出す。自動で計算し、利用者の操作は要らない。

### 10.6 資金フロー図

口座どうし・外部との、お金の流れを Sankey 図で表示する。資金移動ルールから描く「設定ベース」と、月の明細から描く「実績ベース（月次）」を切り替えられる。

## 11. カード・電子マネー

### 11.1 登録できるもの

クレジットカード・デビットカード・プリペイドカード・電子マネー。名前・発行元・番号の下4桁・負債の科目を登録する。

### 11.2 明細と科目付け

- 明細を CSV で取り込み、科目を付けて実績に転記する（[10.2節](#102-明細)と同じ）。
- 利用はプラス、返金はマイナスで記録する。

### 11.3 チャージ

- カードから別のカード・電子マネーへのチャージは、チャージ先を選び、チャージ先の入金の明細と組にする。組にした明細はどちらも収支から除く。
- 組にする相手の候補は、日付と金額が近いものを順に出す。
- 摘要のキーワードでチャージを自動で判定するルールを登録できる。

### 11.4 カード払いの固定決済

- サブスクリプションなど、カードで決まった日に払うものを、名前・金額・日・科目で登録する。明細から登録することもできる。
- サマリの「引き落とし・固定決済スケジュール」に表示する。
- 銀行の資金繰りには含めない。お金はカード引き落としとして口座から出るので、含めると二重になる（[24章](#24-決定事項)）。

### 11.5 引き落としとの関係

カードの利用分を口座から引き落とす動きは、銀行管理の振替で、カード引き落としの資金移動ルールとして登録する。これが銀行の資金繰りに入る。

## 12. 資産と借入金

### 12.1 総資産サマリ

口座の残高 ＋ 実物資産の評価額 − 借入金の残高 で、純資産を出す。口座と実物資産で同じお金を二重に数えないようにしている（例：実物資産に「資産として数えない」を指定できる）。

### 12.2 実物資産

土地・建物・車・金・現金・預金・有価証券・その他。取得日・取得額・評価額を持ち、借入金を1件ひも付けられる（ひも付けた借入は、借入金管理のデータとして持つ）。

### 12.3 借入金

- 借入先・金額・金利・借入日・返済日・種類（事業 / 住宅など）・月々の返済額・残価（最終回に残す額）を登録する。
- 月々の返済額は、元利均等で自動で計算する。手で入れた額を優先させることもできる。
- 返済スケジュールをグラフと表で表示し、返済を登録すると残高が減る。
- 予算に反映する科目を指定すると、月々の返済額が予算に自動反映される（[8.3節](#83-自動反映)）。

### 12.4 金利の変更

変動金利の見直しを、適用日・新しい金利・（通知されていれば）実際の返済額で登録する。見直し前後の返済額と総返済額を比べて表示する。金利の履歴は追記だけで、消さない。

## 13. 会計帳簿

個人・法人モードで使う。

### 13.1 仕訳帳と承認

- 仕訳を、日付・摘要・支払方法・課税区分と、借方・貸方の明細（科目・金額・税率・仕入税額控除の対象か）で入力する。
- 仕訳には領収書などの証憑（画像・PDF）を添付できる。
- 承認のワークフロー：下書き → 承認申請 → 承認済 / 差戻し。承認は accountant 以上が行う（電子帳簿保存法への対応）。
- 仕訳は、損益の科目について実績に自動で同期する。

### 13.2 仕訳テンプレートと仕訳の提案

- よく使う仕訳を雛形として登録し、1回の操作で入力できる。金額を空けておくと、使うときに入れる。
- 摘要のキーワードから、借方・貸方の科目の組み合わせを提案する（ルールベース。外部の AI は使わない）。

### 13.3 総勘定元帳・試算表

- 総勘定元帳：年・科目ごとの取引の一覧。CSV で出力できる。
- 試算表：決算処理の画面と API で出す。親子の科目をまとめて集計できる。部門で絞り込める。

### 13.4 売掛金・買掛金・インボイス

- インボイス（適格請求書）を、下書き → 発行済み → 入金済み で管理する。発行すると売掛金を自動で作る。
- 売掛金・買掛金は、未入金（未払）/ 入金済（支払済）/ 延滞 で管理する。入金・支払を登録すると、仕訳を自動で作る。

### 13.5 棚卸・固定資産・家事按分

- 棚卸：期末の在庫を品目・種類・数量・単価で入力し、評価方法（最終仕入原価法 / 総平均法 / 移動平均法）で確定する。確定すると仕訳を記録する。
- 固定資産：取得日・取得額・耐用年数・償却方法（定額法 / 定率法）で登録し、年度ごとに減価償却を計算する。償却すると仕訳を記録する。
- 家事按分（個人のみ）：経費の科目ごとに、事業で使った割合を設定する。決算と家事按分計算書で使う。

## 14. 決算と申告

### 14.1 決算処理

年度を選び、次のタブで確かめる。

| タブ | 内容 |
|---|---|
| 損益計算書 | 収益・費用・利益 |
| 貸借対照表 | 資産・負債・純資産 |
| 月別収支 | 月ごとの収支 |
| 試算表 | 科目ごとの借方・貸方 |
| 財務分析 | 流動比率・自己資本比率・ROA・ROE など |

### 14.2 決算確定

決算を確定すると、その会計年度を締める（純利益を記録する）。取り消して開き直せる。

### 14.3 申告書類の印刷

| 画面 | 内容 |
|---|---|
| 青色申告決算書・収支内訳書（個人） | 損益計算書、月別収支表、貸借対照表、家事按分計算書。事業者情報の青色申告の設定で、どちらを出すかが決まる |
| 法人決算書類（法人） | 損益計算書、貸借対照表、株主資本等変動計算書、財務指標、法人税・地方税の概算 |

### 14.4 e-Tax XML

青色申告決算書・法人税申告書・消費税申告書を、e-Tax / eLTAX 向けの XML として出力する（accountant 以上）。

### 14.5 消費税

年度ごとに課税方式（免税 / 原則課税 / 簡易課税。簡易課税ならみなし仕入率）を設定する。年度の設定がないときだけ、事業者情報の既定値を使う。仕入税額控除の対象を集計できる。

## 15. 法人管理

### 15.1 法人・事業者情報

テナントの種別・名前・法人番号・資本金・設立日・決算月。個人事業主の屋号・事業主名・開業日・青色申告・インボイス登録番号は、設定の基本設定で管理する。

### 15.2 会計年度

会計年度の開始日・終了日を登録し、開いている / 締めた を切り替える。

### 15.3 ガバナンス

| タブ | 内容 |
|---|---|
| 役員管理 | 氏名・役職・任期・報酬 |
| 株主総会 | 開催日・種類（定時 / 臨時）・議題・決議・議事録 |
| 配当管理 | 決議日・支払日・1株あたりの額・総額 |
| 決算公告 | 公告日・方法（官報 / 新聞 / Web）・内容 |

### 15.4 税理士ポータル

accountant 以上が、財務の要約を見る画面。今は自分のテナントの要約だけを返す（[25章](#25-未決事項)）。

## 16. 勘定科目変換・学習ガイド・外部連携

### 16.1 科目名設定

設定の「科目名設定」で、全科目の家計の科目名・区分と、個人・法人モードでの表示名をまとめて編集する。表示名を空にすると家計の科目名を使う。既定値は [勘定科目変換マスタ](docs/design/account-master-mapping.md) に基づく。

### 16.2 勘定科目変換

- 家計の科目（`H-` で始まる）ごとに、同じテナントの法人の科目の候補を自動で出す。候補には、自動 / 要確認 / 手動 / 変換不可 の印を付ける。
- 確かめて確定すると、変換の結果を記録する。手で直した対応は、自分のルールとして次から使う。
- 変換の履歴を見られ、CSV で出力できる。
- 既存の実績や仕訳の科目を、一括で付け替えることはしない（対応の記録まで）。
- 詳しい設計は [account-conversion-system.md](docs/design/account-conversion-system.md) にある。

### 16.3 学習ガイド

次の5つの話題を、自分のデータへのリンクとともに読める。開いた話題は既読として記録する。

| 順 | 話題 | 関連する画面 |
|---|---|---|
| 1 | 家計と法人会計の対応（一家庭 = 一法人モデル） | 勘定科目変換 |
| 2 | 複式簿記の基礎 | 仕訳帳 |
| 3 | 決算書の読み方（P/L・B/S・S/S） | 決算処理 |
| 4 | 決算処理の流れ（棚卸 → 減価償却 → 家事按分 → 決算確定） | 決算処理 |
| 5 | 必要申告書ガイド（個人・法人・e-Tax / eLTAX） | 申告書類の印刷 |

### 16.4 外部サービス連携

freee・マネーフォワード（OAuth 2.0）とオープンバンキングとの連携の枠組みがある。環境変数でキーを設定するまでは使えない。

## 17. 開発ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| Phase 0〜4 | 基盤、マスタ、実績・集計、予測、KPI、予算、RBAC・MFA・監査ログ、モバイルアプリ、CI/CD | 完了 |
| Phase 5 | 個人事業主の確定申告（仕訳、証憑、棚卸、固定資産、家事按分、売掛金・買掛金、消費税、決算、青色申告決算書） | 完了 |
| Phase 6 | 法人・統合会計（テナント、会計年度、インボイス、借入金、法人決算書類、財務分析、ガバナンス、電子帳簿保存法、e-Tax XML） | 完了 |
| Phase 7 | 家計の強化（表示モード、勘定科目変換、テナントによるデータ分離、銀行台帳の一本化、残高推移・資金繰り、カード・電子マネー、チャージ、借入の金利変更、学習ガイド、モバイルの機能をWebに揃える） | 完了 |
| Phase 8 | 本番運用の準備（本番構成の見直し、見つかった不具合の修正） | 未着手（[docs/tasks/task.md](docs/tasks/task.md)） |
| 以降 | 実際の銀行との連携（口座アグリゲーション）、有料の AI 科目変換、発生主義の家計（[home-mode-accrual-basis.md](docs/design/home-mode-accrual-basis.md)）、ステージング環境 | 検討中 |

---

# 第2部 技術説明

実装に関わる技術的な内容をまとめる。機能の仕様は[第1部](#第1部-概要説明)を参照。

## 18. 技術スタックとシステム構成

### 18.1 選定の方針

- Web の画面とバックエンドの API を、1つの Next.js（App Router と Route Handlers）にまとめ、型とロジックを共有する。
- モバイルは Expo を使い、計算とラベルのロジックは Web のものを複製して使う（[18.5節](#185-web-とモバイルのロジック共有)）。
- DB へのアクセスは Prisma、入力の検査は Zod に揃える。
- Docker Compose で、Web・DB・Redis を一度に起動できるようにする。

### 18.2 技術スタック

| レイヤ | 技術 |
|---|---|
| Web・API | Next.js 15（App Router / Route Handlers）・React 19・TypeScript |
| DB | PostgreSQL 16 + Prisma 6 |
| キャッシュ・レート制限 | Redis 7 |
| モバイル | Expo SDK 54・React Native 0.81 |
| インフラ | Docker Compose |
| CI/CD | GitHub Actions・GHCR |

**Web・API（`app/web`）**

| 領域 | 技術 | 補足 |
|---|---|---|
| UI | Tailwind CSS 4・lucide-react | |
| グラフ | Recharts 2 | 資金フロー図（Sankey）を含む |
| データ取得 | TanStack Query 5 | |
| 入力の検査 | Zod 3 | API の本文・クエリと、環境変数の検査 |
| ORM | Prisma 6 | マイグレーションは `prisma/migrations` |
| CSV | papaparse | |
| Redis | `redis` 4 | つながらないときは、キャッシュなしで動く |
| パスワード | Node の `scrypt` | |
| 多要素認証 | 自前の TOTP（RFC 6238） | 外部のライブラリに頼らない |
| テスト | Vitest（単体・結合）、Playwright（E2E） | |
| 整形・静的検査 | Prettier・ESLint | |

**モバイル（`app/mobile`）**

| 領域 | 技術 |
|---|---|
| フレームワーク | Expo（React Native、画面の切り替えは自前の状態管理） |
| グラフ | react-native-svg |
| トークンの保存 | expo-secure-store |

### 18.3 システム構成

```mermaid
flowchart LR
  browser["ブラウザ"]
  mobile["Expo アプリ"]

  subgraph compose["Docker Compose"]
    web["web<br/>Next.js（画面 + /api/*）"]
    db[("PostgreSQL<br/>データ・セッション")]
    redis[("Redis<br/>キャッシュ・レート制限")]
    cron["session-cleanup<br/>（毎日 2:00）"]
    uploads[("uploads<br/>証憑ファイル")]
  end

  browser -->|"Cookie"| web
  mobile -->|"Bearer トークン"| web
  web --> db
  web --> redis
  web --> uploads
  cron -->|"POST /api/admin/cleanup"| web
```

### 18.4 リポジトリ構成

```text
docker_financial_management/
├── readme.md                 本書（仕様書の本体）
├── app/
│   ├── web/                  Next.js（画面と API）
│   │   ├── src/
│   │   │   ├── app/          画面（page.tsx）と API（api/**/route.ts）
│   │   │   ├── components/   AppShell などの共通部品
│   │   │   ├── lib/          業務ロジック・認証・テナント分離・キャッシュ
│   │   │   ├── content/learning/  学習ガイドの本文（Markdown）
│   │   │   └── middleware.ts ページの保護と CSRF
│   │   ├── prisma/           schema.prisma・migrations・seed
│   │   ├── e2e/              Playwright
│   │   └── scripts/          スクリーンショット・モバイルへの複製
│   └── mobile/               Expo
│       └── src/
│           ├── screens/
│           └── shared/       Web の lib から複製したファイル（直接編集しない）
├── platform/
│   ├── docker-compose.yml        開発環境
│   ├── docker-compose.prod.yml   本番環境
│   ├── docker/               web.Dockerfile・entrypoint.sh
│   ├── scripts/              backup.sh・restore.sh
│   └── .env.example
├── docs/                     設計資料・運用手順書・タスク（docs/README.md）
└── .github/workflows/        ci.yml・cd.yml
```

### 18.5 Web とモバイルのロジック共有

- 表示ラベル・モード別の用語・借入の償還計算・ステップ進捗などは、`app/web/src/lib/` を正とし、`app/mobile/src/shared/` にそのまま複製する。
- 共有するファイルは `app/web/src/lib/shared-with-mobile.ts` の一覧で管理する（debt-schedule・display-name・financial-matrix・forecast-methods・labels・linked-account-type・loan-schedule・mode-labels・rate-forecast・step-checklist）。
- Web 側を直したら、`app/web` で `npm run sync:mobile` を実行して複製する。
- 複製がずれていたり、共有するファイルが `@/` で始まる import を使っていたりすると、Web の単体テスト（`shared-with-mobile.test.ts`）が失敗する。

### 18.6 Docker Compose の構成

**開発環境（`platform/docker-compose.yml`）**

| サービス | イメージ・起動方法 | 役割 |
|---|---|---|
| `web` | `platform/docker/web.Dockerfile` でビルド。ポート 3000 | 画面と API。起動時に entrypoint がマイグレーションを適用し、DB が空なら初期データを入れる |
| `db` | postgres:16-alpine。ポート 5432。データは `platform/db/`（git 管理外） | データ・セッション |
| `redis` | redis:7-alpine。ポート 6379 | キャッシュ・レート制限 |
| `session-cleanup` | alpine の crond | 毎日 2:00 に `POST /api/admin/cleanup` を呼び、期限切れのセッションと多要素認証のチャレンジを消す |

**本番環境（`platform/docker-compose.prod.yml`）**

`web`（GHCR のイメージ。`/api/health` のヘルスチェックつき）と `db` だけを起動する。redis・session-cleanup・証憑のボリュームがないことは [25章](#25-未決事項) の課題として扱う。

**web のイメージと起動処理**

- `web.Dockerfile` は、依存関係の取得 → `prisma generate` と `next build` → 実行用、の段階でビルドする（ビルドにはダミーの `DATABASE_URL` を渡す）。
- `entrypoint.sh` は、途中で止まったマイグレーションを取り消し済みにしたうえで `prisma migrate deploy` を実行し、ユーザーが1人もいなければ `db:seed` を実行してから `next start` を起動する。

### 18.7 クイックスタート

```bash
cp platform/.env.example platform/.env
docker compose -f platform/docker-compose.yml up -d --build
# 起動時に、マイグレーションの適用と、空の DB への初期データの投入が自動で行われる
```

| URL | 内容 |
|---|---|
| <http://localhost:3000> | アプリ |

初期データのログインアカウント（パスワードはいずれも `password`。すべてデモテナントに所属する）：

| メール | ロール |
|---|---|
| `admin@example.com` | admin |
| `editor@example.com` | editor |
| `viewer@example.com` | viewer |
| `demo@example.com` | editor |

accountant のロールは、`/admin/users` でロールを変えて使う。

**ローカルで開発する**

```bash
docker compose -f platform/docker-compose.yml up -d db redis   # DB と Redis だけを Docker で起動する

cd app/web
npm install
npm run db:generate   # Prisma Client を生成する
npm run db:migrate    # マイグレーションを適用する（prisma migrate dev）
npm run db:seed       # 初期データを入れる
npm run dev           # http://localhost:3000
```

`app/web/.env` に `DATABASE_URL`（例：`postgresql://app:app@localhost:5432/financial`）と `REDIS_URL` を設定する。

開発でよく使うコマンド（`app/web` で実行する）：

```bash
npm run format:check && npm run lint && npm run typecheck   # 整形・静的検査・型
npm test                    # 単体テスト（Vitest）
npm run test:integration    # 結合テスト（実際の DB を使う。CI では実行しない）
npm run e2e:install         # 初回だけ。Playwright のブラウザを入れる
npm run e2e                 # E2E テスト（アプリを起動した状態で）
npm run sync:mobile         # 共有ロジックをモバイルへ複製する
npm run screenshot          # ダッシュボードのスクリーンショットを docs/images/dashboard.png に撮る
```

勘定科目の追加の初期データ（開発用。デモテナント向け）：

```bash
npm run db:seed:business-accounts   # 法人向けの勘定科目
npm run db:seed:home-accounts       # 家計向けの勘定科目
npm run db:seed:account-mapping     # 勘定科目変換のシステム定義のルール
```

**モバイルアプリ**

```bash
cd app/mobile
npm install
EXPO_PUBLIC_API_BASE_URL=http://<PCのLAN IP>:3000/api npm run start   # 表示された QR を Expo Go で読む
npm run typecheck && npm run format:check
```

`EXPO_PUBLIC_API_BASE_URL` を設定しないときは、Expo の開発サーバーのホスト（`http://<host>:3000/api`）に接続する。

### 18.8 CI/CD

| ワークフロー | きっかけ | 内容 |
|---|---|---|
| CI（`ci.yml`） | `main` への push、すべての PR | `web`：`prisma generate` → 整形 → lint → 型 → 単体テスト → ビルド。`migrate-check`：PostgreSQL にマイグレーションを適用する。`e2e`：初期データを入れてビルドし、Playwright を実行する |
| CD（`cd.yml`） | `main` への push、`v*` タグ、手動 | イメージをビルドして GHCR に push し、SSH で本番サーバーの compose を更新する。マイグレーションとヘルスチェックに失敗したら、直前のイメージに戻す。結果をメールで知らせる |

設計は [docs/design/cicd.md](docs/design/cicd.md) と [docs/design/deploy.md](docs/design/deploy.md)、手順は [docs/runbooks/deploy-and-rollback.md](docs/runbooks/deploy-and-rollback.md) にまとめている。

## 19. 認証の実装

| クライアント | 方式 | 保存場所 |
|---|---|---|
| Web | セッション Cookie（httpOnly・`SameSite=Lax`。本番は `__Host-fm_session`、`COOKIE_SECURE=false` のときは `fm_session`） | ブラウザ |
| モバイル | `Authorization: Bearer <トークン>`（ログインの応答の `data.sessionId`） | expo-secure-store |

- **パスワード**：`scrypt`（N=32768, r=8, p=1）で保存する。古い形式（N=16384）のハッシュは、次にログインに成功したときに作り直す。存在しないメールアドレスでも同じ計算をして、応答時間の差でアカウントの有無が分からないようにする。
- **セッション**：`fm2:` ＋ 32バイトの乱数をトークンとし、DB には SHA-256 のハッシュだけを保存する。ログインのたびに新しいトークンを発行する。admin がユーザーを変更すると、そのユーザーのセッションをすべて消す。
- **多要素認証**：ログインで `401 {mfaRequired, mfaToken}` を返し、`/api/auth/mfa/verify` で確認コードを受け取る。チャレンジはハッシュで保存し、5分・5回まで有効で、超えるとアカウントを15分ロックする。同じ確認コードの再利用を防ぐ。
- **CSRF**：`/api/*` の変更系のリクエストは、`Sec-Fetch-Site` が同一オリジン、または `Origin` が `APP_ORIGIN` と一致することを求める。Bearer トークンか `X-Requested-With: fm-mobile` を付けたリクエスト（モバイル）は対象外。
- **レート制限**：Redis の固定時間枠で数える。ログインは IP ごとに5分で10回（Redis が使えないときはメモリで数える）。CSV の取り込みと同期は、ユーザーごとに10分で10回。
- **ページの保護**：`middleware.ts` が、Cookie のない画面へのアクセスを `/login` に転送する。セッションの有効性は API 側で確かめ、API が 401 を返すと、画面はログインへ戻す。

## 20. 機能ごとの実装方針

### 20.1 テナント分離

`src/lib/tenant-db.ts` の `tenantDb(tenantId)` は、Prisma の `$extends` で、`tenantId` を持つすべてのモデルの検索条件と作成データに `tenantId` を差し込む。対象のモデルは起動時に `Prisma.dmmf` から集める（`User` と `LearningProgress` は除く）。ID を指定した操作で他のテナントのデータを指したときは 404 を返す。

### 20.2 API の共通処理

ほぼすべての API は `src/lib/api-handler.ts` の `withApi({ role, schema, querySchema, handler })` で書く。`withApi` は次を順に行う。

1. `requireRole` でログインとロールを確かめる（401 / 403）。
2. パスの `[id]` が正の整数であることを確かめる。
3. 本文とクエリを Zod で検査する。
4. テナントで絞った `db` と、監査ログを書く `audit()` をハンドラーに渡す。
5. 例外を `src/lib/api-error.ts` で決まった形のエラー応答にする。

`withApi` を使わないのは、ログイン・ログアウト・多要素認証の確認・`/api/auth/me`・ヘルスチェック・定期ジョブ用の `/api/admin/cleanup` など。

### 20.3 口座の残高

残高の定義は `src/lib/bank-balance.ts` の1か所だけに置く：`SUM(bank_transactions.amount) + bank_accounts.balanceAdjustment`。総資産サマリ・資金繰り・残高推移はすべてこれを使う。

### 20.4 振替とチャージ

- **振替**：2つの口座の明細に同じ `transferGroupId` を付ける。候補は、取り込み後に金額と日付から探す（`transfer-match.ts`）。
- **チャージ**：チャージ元の明細（`bank_transactions.chargeToAccountId` か `card_transactions.transferToAccountId`）と、チャージ先の入金の明細に、同じ `chargeGroupId` を付ける。`chargeGroupId` は銀行とカードの明細で共通の番号を使う。候補の順位付けと組の検査は `charge-link.ts`。
- `transferGroupId`・チャージ先・`chargeGroupId` のいずれかを持つ明細は、科目付けと実績への転記の対象から除く。

### 20.5 カード払いの固定決済

カード払いの固定決済は `card_recurring_payments` に置き、資金移動ルール（`transfers`）には入れない。`transfers` は銀行の資金繰りと残高推移に使うので、ここに入れるとカード引き落としと二重に数えてしまう。

### 20.6 実績への転記と仕訳の同期

- 明細の転記は、明細の `postedRecordId`（一意）で、同じ明細を二重に転記しないようにする。
- 仕訳から実績への同期は `src/lib/journal.ts` の `syncJournalToFinancialRecords` の1か所で行う。作った実績には `journalEntryId` を記録し、仕訳を消すときに一緒に消す。
- 同期するのは損益の科目だけで、資産・負債の科目は対象外（残高のスナップショットとして別に扱う）。
- 符号は、仕訳の借方・貸方が科目の自然に増える側と同じならプラス、逆ならマイナスとする。
- 売掛金・買掛金の発生と消込、棚卸の確定、減価償却は、監査のための仕訳も記録する。

### 20.7 予測

`src/lib/forecast.ts` に、線形回帰・移動平均・成長率・Holt・Holt-Winters と、過去のデータでの検証（MAPE・RMSE）を実装している。画面の手法の選択肢は `forecast-methods.ts`（既定は移動平均）。変動金利の先の見込みは `rate-forecast.ts`。

### 20.8 キャッシュ

`src/lib/redis.ts` の `withCache(key, ttl, fn)` で、重い集計を1時間キャッシュする。Redis につながらないときは、キャッシュなしで計算する。

| キー | 内容 | 消すタイミング |
|---|---|---|
| `assets:summary:{tenantId}:{年月}` | 総資産サマリ | 期限切れ |
| `closing:statements:{tenantId}:{年}[:dept:{部門}]` | 決算書 | 決算確定・取り消し、仕訳の登録 |
| `reports:ledger:{tenantId}:{年}:{科目}` | 総勘定元帳 | 決算確定・取り消し、仕訳の登録 |

### 20.9 勘定科目変換の判定

`src/lib/account-conversion.ts` で、家計の科目ごとに次の順で変換先を決める。

| 順 | 判定 | 信頼度 |
|---|---|---|
| 1 | 変換ルールの表（自分のルールを優先し、次にシステム定義） | ルールの値（既定 1.0） |
| 2 | キーワードの一致（科目名に「税」「保険」などを含む） | 0.9 |
| 3 | あいまいな一致（科目名の bigram の Dice 係数。0.5 以上） | 類似度 |
| 4 | 区分ごとの既定（収入 → 売上高、変動費 → 仕入高、固定費 → 雑費） | 0.4 |
| 5 | 候補なし | — |

信頼度 0.8 以上を「自動」、0.5〜0.79 を「要確認」、それ未満を「手動」とする。変換のルール・履歴はテナントではなくユーザーに属する。有料の AI 変換のテーブル（`ai_conversion_results`・`ai_conversion_usages`）はスキーマだけあり、使っていない。

### 20.10 証憑のアップロード

証憑は `/app/uploads` の下にテナントごとのフォルダで保存し、ファイルの先頭のバイトで種類を確かめる。`/api/uploads/[filename]` から、ログインしたユーザーに返す。

### 20.11 定期ジョブ

| ジョブ | 方法 | 内容 |
|---|---|---|
| 期限切れのセッションの削除 | `session-cleanup` コンテナの crond（毎日 2:00） | `POST /api/admin/cleanup` を `Authorization: Bearer <CLEANUP_SERVICE_KEY>` で呼び、期限切れのセッションと多要素認証のチャレンジを消す |

### 20.12 バックアップ

`platform/scripts/backup.sh` が `pg_dump` を gzip で保存し、`RETENTION_DAYS`（既定30日）より古いものを消す。戻すのは `restore.sh`。手順は [runbooks/backup-restore.md](docs/runbooks/backup-restore.md)。

## 21. データモデル

正式な定義は `app/web/prisma/schema.prisma`（56モデル）。ここでは領域ごとに、主な列だけを示す。財務データのテーブルはすべて `tenantId` を持つ。

### 21.1 認証・ユーザー・テナント

| テーブル | 主な列 | 補足 |
|---|---|---|
| `tenants` | type（SOLE_PROPRIETOR / CORPORATION）, name, corporateNumber, capitalAmount, establishedOn, closingMonth | |
| `users` | tenantId, email, name, passwordHash, role, mfaEnabled, totpSecret, totpLastUsedStep, mfaRecoveryCodes, loginAttempts, lockedUntil | email は一意 |
| `sessions` | id（トークンの SHA-256）, userId, expiresAt, lastSeenAt, ip, userAgent | |
| `mfa_challenges` | token（SHA-256）, userId, attempts, expiresAt | |
| `audit_logs` | tenantId, userId, action, target, ip, userAgent, before, after, changedAt | |
| `learning_progress` | tenantId, userId, topicKey, readAt | `[userId, topicKey]` 一意 |

### 21.2 財務の基盤

| テーブル | 主な列 | 補足 |
|---|---|---|
| `accounts` | code, name（家計の科目名）, soleName, corporateName, category, parentId | `[tenantId, code]` 一意 |
| `departments` | name, manager, parentId | |
| `periods` | fiscalYear, quarter, month | `[tenantId, fiscalYear, month]` 一意 |
| `financial_records` | accountId, departmentId, periodId, amount, journalEntryId | 実績 |
| `financial_record_histories` | recordId, userId, action, amount, changedAt | |
| `forecasts` | accountId, periodId, method, scenario, amount | 保存した予測 |

### 21.3 予算

| テーブル | 主な列 | 補足 |
|---|---|---|
| `budgets` | accountId, periodId, amount | `[tenantId, accountId, periodId]` 一意 |
| `budget_histories` | budgetId, accountId, periodId, userId, action, amount, changedAt | 予算を消しても残る |
| `allocation_rules` | key, label, group, minPercent, maxPercent, accountId, sortOrder | 予算配分の目安 |
| `budget_confirmations` | periodId, confirmedById, confirmedAt | 予算を確定した月。`periodId` 一意。行がある月の予算は変えられない |

### 21.4 銀行・資金移動・カード

| テーブル | 主な列 | 補足 |
|---|---|---|
| `bank_accounts` | name, bankName, branchName, accountType, role, accountId, balanceAdjustment | 銀行口座の唯一の台帳 |
| `bank_transactions` | accountId, date, description, amount, balance, source, externalId, categoryAccountId, postedRecordId, transferGroupId, chargeToAccountId, chargeGroupId | `[accountId, externalId]` 一意 |
| `transfers` | fromAccountId, toAccountId, linkedAccountId, amount, kind, channel, label, day | 資金移動ルール |
| `txn_category_rules` | keyword, categoryAccountId, priority | 科目付けの学習ルール |
| `linked_accounts` | name, type（CREDIT_CARD / DEBIT_CARD / PREPAID_CARD / E_MONEY）, institution, lastFour, accountId | カード・電子マネー |
| `card_transactions` | accountId, date, description, amount, source, externalId, categoryAccountId, postedRecordId, transferToAccountId, chargeGroupId | `[accountId, externalId]` 一意 |
| `card_transfer_rules` | accountId, keyword, transferToAccountId | チャージの自動判定 |
| `card_recurring_payments` | accountId, label, amount, day, categoryAccountId, note | カード払いの固定決済 |

### 21.5 資産・借入金

| テーブル | 主な列 | 補足 |
|---|---|---|
| `personal_assets` | name, category, acquiredOn, acquisitionCost, currentValue, countAsAsset, linkedAccountId, loanId | 実物資産。loanId は一意 |
| `loans` | lenderName, amount, interestRate, borrowedOn, repaymentDate, remainingAmount, status, loanType, linkedAccountId, monthlyPayment, residualValue, monthlyPaymentIsManual | |
| `loan_interest_rate_changes` | loanId, effectiveOn, interestRate, previousRate, monthlyPayment, previousMonthlyPayment, calculatedMonthlyPayment, note | `[loanId, effectiveOn]` 一意 |
| `loan_repayments` | loanId, repaidOn, principal, interest, totalAmount | |

### 21.6 会計帳簿

| テーブル | 主な列 | 補足 |
|---|---|---|
| `journal_entries` | transactionDate, description, paymentMethod, taxCategory, approvalStatus | |
| `journal_details` | journalEntryId, side, accountId, amount, taxRate, taxCreditEligible, note | |
| `journal_approvals` | journalEntryId, action, actorId, comment | |
| `receipts` | journalEntryId, fileName, fileUrl, savedName, mimeType, fileSize | 証憑 |
| `journal_templates` / `journal_template_lines` | name / side, accountId, amount, sortOrder | |
| `inventories` / `inventory_items` | inventoryDate, status, valuationMethod, totalAmount / itemName, itemType, quantity, unitPrice | |
| `fixed_assets` / `depreciations` | acquiredOn, acquisitionCost, usefulLife, method, bookValue / fiscalYear, amount | 償却は `[fixedAssetId, fiscalYear]` 一意 |
| `apportionments` | accountId, businessRate | `[tenantId, accountId]` 一意 |
| `receivables` / `payables` | customerName（supplierName）, amount, dueDate, status, paidOn, paidAmount, invoiceId | invoiceId は一意 |
| `invoices` / `invoice_lines` | invoiceNumber, customerName, status, subtotal, taxAmount, total / quantity, unitPrice, taxRate | `[tenantId, invoiceNumber]` 一意 |

### 21.7 決算・税

| テーブル | 主な列 | 補足 |
|---|---|---|
| `fiscal_years` | year, startDate, endDate, status, netIncome, closedAt | `[tenantId, year]` 一意。年度の開閉の唯一の台帳 |
| `business_profiles` | tradeName, ownerName, openedOn, blueReturn, invoiceNumber, taxationType | テナントに1件 |
| `tax_settings` | taxYear, taxationType, simplifiedRate | `[tenantId, taxYear]` 一意。課税方式の正 |
| `accrued_revenues` / `accrued_expenses` | description, amount, accrualDate, accountId, fiscalYear, status | |

### 21.8 法人のガバナンス

| テーブル | 主な列 |
|---|---|
| `officers` | name, title, termStart, termEnd, salary |
| `shareholder_meetings` | meetingDate, meetingType, agenda, resolution, minutesUrl |
| `dividends` | resolutionDate, paymentDate, perShareAmount, totalAmount |
| `announcements` | announcementDate, method, content, fiscalYear |

### 21.9 勘定科目変換

| テーブル | 主な列 | 補足 |
|---|---|---|
| `account_mapping_rules` | homeCode, corporateCode, matchType, confidenceScore, isConvertible, userId | userId が空ならシステム定義。`[homeCode, userId]` 一意 |
| `account_conversion_sessions` | userId, fromMode, toMode, convertedAt, status | |
| `account_conversion_logs` | sessionId, homeAccountId, corporateAccountId, matchType, confidenceScore, isManuallyOverridden | |
| `ai_conversion_results` / `ai_conversion_usages` | — | スキーマのみ（未使用） |

### 21.10 列挙型

| 列挙型 | 値 |
|---|---|
| AccountCategory | REVENUE, COGS, EXPENSE, PROFIT, ASSET, LIABILITY, OTHER |
| ForecastMethod | MOVING_AVERAGE, LINEAR_REGRESSION, GROWTH_RATE |
| ForecastScenario | OPTIMISTIC, BASE, PESSIMISTIC |
| BankAccountRole | SALARY, WITHDRAWAL, SAVINGS, OTHER |
| TransferKind | MANUAL, AUTO |
| TransferChannel | BANK_TRANSFER, AUTO_DEBIT, CARD_PAYMENT, INCOME, EXPENSE |
| TxnSource | MANUAL, CSV, SYNC |
| PersonalAssetCategory | LAND, BUILDING, VEHICLE, GOLD, CASH, DEPOSIT, SECURITIES, OTHER |
| AccountMappingMatchType | TABLE, KEYWORD, FUZZY, AI_FREE, AI_PAID, MANUAL |
| AccountConversionMode | HOME, CORPORATE |
| AccountConversionStatus | COMPLETED, CANCELLED |

## 22. API

すべて `/api` の下にある。「権限」は必要な最低のロール（V = viewer、Ac = accountant、E = editor、Ad = admin、— = ログイン不要）。

### 22.1 認証・管理

| メソッド | パス | 権限 |
|---|---|---|
| POST | `/auth/login` | — |
| POST | `/auth/logout` | — |
| GET | `/auth/me` | ログイン済み |
| POST | `/auth/mfa/verify` | —（mfaToken で確かめる） |
| POST | `/auth/mfa/setup` `/auth/mfa/enable` `/auth/mfa/disable` `/auth/mfa/recovery` | V |
| GET / POST | `/admin/users` | Ad |
| PATCH / DELETE | `/admin/users/[id]` | Ad |
| GET / POST | `/admin/cleanup` | Ad、または `CLEANUP_SERVICE_KEY` の Bearer |
| GET | `/audit-logs` | Ad |
| GET / POST | `/tenants` | V / Ad |
| GET / PUT / DELETE | `/tenants/[id]` | V / E / Ad |
| GET | `/health` | — |

### 22.2 マスタ・設定・学習

| メソッド | パス | 権限 |
|---|---|---|
| GET / POST | `/accounts` | V / E |
| PATCH / DELETE | `/accounts/[id]` | E |
| PUT | `/accounts/display-names` | E |
| GET / POST | `/departments` | V / E |
| PATCH / DELETE | `/departments/[id]` | E |
| GET / POST | `/periods` | V / E |
| GET / PUT | `/business-profile` | V / E |
| GET | `/onboarding/steps` | V |
| GET | `/learning/topics` `/learning/topics/[key]` | V |
| POST | `/learning/progress` | V |

### 22.3 実績・予測・レポート

| メソッド | パス | 権限 |
|---|---|---|
| GET / POST | `/financials` | V / E |
| PATCH / DELETE | `/financials/[id]` | E |
| GET | `/financials/[id]/history` `/financials/matrix` `/financials/recent` | V |
| POST | `/financials/import` | E |
| GET / POST / DELETE | `/actuals` | V / E / E |
| GET / POST | `/forecasts` | V / E |
| GET | `/kpi` | V |
| GET | `/reports/general-ledger` `/reports/trial-balance` `/reports/monthly-trend` | V |
| GET | `/cashflow` `/cashflow/monthly` | V |

### 22.4 予算

| メソッド | パス | 権限 |
|---|---|---|
| GET / POST | `/budgets` | V / E |
| PATCH / DELETE | `/budgets/[id]` | E |
| POST | `/budgets/import` | E |
| GET | `/budgets/history` `/budgets/allocation-guide` `/budgets/allocation-suggest` | V |
| POST | `/budgets/allocation-apply` | E |
| GET | `/budgets/variance` | V |
| POST / DELETE | `/budgets/confirm` | E / Ad |
| GET / PUT | `/allocation-rules` | V / E |
| POST | `/allocation-rules/defaults` | E |

### 22.5 銀行・資金移動

| メソッド | パス | 権限 |
|---|---|---|
| GET / POST | `/bank-accounts` | V / E |
| PATCH / DELETE | `/bank-accounts/[id]` | E |
| GET / POST / DELETE | `/bank-accounts/[id]/transactions` | V / E / E |
| POST | `/bank-accounts/[id]/sync` | E |
| GET | `/bank-accounts/balance-trend` | V |
| PATCH | `/bank-transactions/[id]/categorize` `/bank-transactions/[id]/charge` | E |
| POST | `/bank-transfers` | E |
| GET | `/bank-transfers/candidates` | V |
| POST / DELETE | `/bank-transfers/link` | E |
| GET / POST | `/transfers` | V / E |
| PATCH / DELETE | `/transfers/[id]` | E |
| GET | `/transfers/flow` `/transfers/funding` | V |
| POST | `/transfers/simulate` | V |

### 22.6 カード・電子マネー

| メソッド | パス | 権限 |
|---|---|---|
| GET / POST | `/linked-accounts` | V / E |
| PATCH / DELETE | `/linked-accounts/[id]` | E |
| GET / POST / DELETE | `/linked-accounts/[id]/transactions` | V / E / E |
| GET | `/linked-accounts/flow` | V |
| PATCH | `/card-transactions/[id]/categorize` `/card-transactions/[id]/transfer` | E |
| GET / DELETE | `/card-transfer-rules` | V / E |
| GET / POST | `/card-recurring-payments` | V / E |
| PATCH / DELETE | `/card-recurring-payments/[id]` | E |
| GET | `/charge-links/candidates` | V |

### 22.7 資産・借入金

| メソッド | パス | 権限 |
|---|---|---|
| GET | `/assets` `/assets/summary` | V |
| GET / POST | `/personal-assets` | V / E |
| PATCH / DELETE | `/personal-assets/[id]` | E |
| GET / POST | `/loans` | V / E |
| PATCH | `/loans/[id]` | E |
| POST | `/loans/[id]/repay` | E |
| GET / POST | `/loans/[id]/interest-rates` | V / E |
| PATCH | `/loans/[id]/interest-rates/[changeId]` | E |

### 22.8 会計帳簿

| メソッド | パス | 権限 |
|---|---|---|
| GET / POST | `/journals` | V / E |
| GET / DELETE | `/journals/[id]` | V / E |
| GET / POST | `/journals/[id]/receipts` | V / E |
| DELETE | `/journals/[id]/receipts/[receiptId]` | E |
| GET / POST | `/journals/approve` | Ac |
| POST | `/journals/suggest` | V |
| GET / POST | `/journal-templates` | V / E |
| GET / PUT / DELETE | `/journal-templates/[id]` | V / E / E |
| GET | `/uploads/[filename]` | V |
| GET / POST | `/invoices` `/receivables` `/payables` `/inventories` `/fixed-assets` | V / E |
| GET / PUT / DELETE | `/invoices/[id]` `/receivables/[id]` `/payables/[id]` `/fixed-assets/[id]` | V / E / E |
| GET / DELETE | `/inventories/[id]` | V / E |
| POST | `/receivables/[id]/pay` `/payables/[id]/pay` `/inventories/[id]/close` `/fixed-assets/[id]/depreciate` | E |
| GET / POST / DELETE | `/apportionments` | V / E / E |

### 22.9 決算・税・法人

| メソッド | パス | 権限 |
|---|---|---|
| GET | `/closing/statements` | V |
| POST / DELETE | `/closing/finalize` | E |
| GET | `/closing/etax` | Ac |
| GET / POST | `/fiscal-years` | V / E |
| PUT / DELETE | `/fiscal-years/[id]` | E / Ad |
| GET / PUT | `/tax-settings` | V / E |
| GET | `/tax-credit` | V |
| GET | `/portal` | Ac |
| GET / POST | `/officers` `/shareholder-meetings` `/dividends` `/announcements` | V / E |
| PUT / DELETE | `/officers/[id]` `/shareholder-meetings/[id]` | E |
| DELETE | `/dividends/[id]` `/announcements/[id]` | E |

### 22.10 勘定科目変換・外部連携

| メソッド | パス | 権限 |
|---|---|---|
| GET | `/account-conversion/preview` | V |
| GET / PUT | `/account-conversion/mappings` | V / E |
| POST | `/account-conversion/confirm` | E |
| GET | `/account-conversion/history` `/account-conversion/history/[id]` `/account-conversion/history/[id]/export` | V |
| GET | `/integrations/freee` `/integrations/moneyforward` | E |
| GET / POST | `/integrations/openbanking` | E |

## 23. 非機能要件

### 23.1 性能

- 主な画面は2秒以内に表示する。
- 重い集計（総資産サマリ・決算書・総勘定元帳）は Redis で1時間キャッシュする（[20.8節](#208-キャッシュ)）。

### 23.2 セキュリティ

| 項目 | 内容 |
|---|---|
| 認証 | パスワード（scrypt）＋ 多要素認証（TOTP）、アカウントのロック、レート制限（[19章](#19-認証の実装)） |
| 認可 | 4段階のロールと、テナントによるデータ分離（[20.1節](#201-テナント分離)） |
| セッション | ハッシュで保存、アイドル24時間・最長7日、ログインのたびに作り直す |
| CSRF | Origin・Sec-Fetch-Site の確認 |
| 通信 | 本番は TLS。Cookie は `__Host-` 付き・Secure |
| 監査 | 変更前後の内容を監査ログに残す（秘密の値は伏せる） |
| 設定 | 環境変数を起動時に Zod で検査する（`src/lib/config-schema.ts`） |

### 23.3 可用性とデータ保全

| 項目 | 内容 |
|---|---|
| 可用性 | 平日の業務時間帯で 99.5% |
| バックアップ | 毎日。保持期間は既定30日（[runbooks/backup-restore.md](docs/runbooks/backup-restore.md)） |
| デプロイ | ヘルスチェックに失敗したら、直前のイメージに自動で戻す |

### 23.4 その他

| 項目 | 内容 |
|---|---|
| 拡張性 | 勘定科目・部門・テナントを利用者が追加できる |
| アクセシビリティ | スキップリンク、ARIA、フォーカスリング、`prefers-reduced-motion` への対応 |
| 画面幅 | 狭い画面ではサイドバーをドロワーにする |

---

# 付録

## 24. 決定事項

| 番号 | 決めたこと | 理由 |
|---|---|---|
| D-1 | 銀行口座の台帳を `bank_accounts` に一本化し、`linked_accounts` はカード・電子マネー専用にする | 同じ口座が2つの台帳に分かれ、残高と明細が食い違っていたため |
| D-2 | 会計年度の開閉を `fiscal_years` に一本化する（`fiscal_year_closes` を統合） | 締めの状態の二重管理をなくすため |
| D-3 | インボイスを発行したら売掛金を自動で作り、`receivables.invoiceId` で結ぶ | 請求と売掛の入れ直しをなくすため |
| D-4 | 実物資産の負債を `loans` に移し、`personal_assets.loanId` で参照する | 借入の表し方を1つにして、返済スケジュールと予算への反映を共通にするため |
| D-5a | 仕訳から作った実績に `journalEntryId` を記録する | 仕訳を消したときに、実績も一緒に消すため |
| D-5b | 仕訳の同期は損益の科目だけにし、符号は科目の自然な増加側で決める | 資産・負債は残高のスナップショットとして扱っているため |
| D-5c | 実績への同期は `syncJournalToFinancialRecords` の1か所を通す | 経路ごとに同期がずれないようにするため |
| D-5d | 売掛・買掛の発生と消込、棚卸の確定、減価償却では、監査のための仕訳も記録する。発生時点で売上・仕入を実績に計上すること（発生主義）はしない | 試算表・総勘定元帳に記録を残しつつ、実績の意味を変えないため |
| D-6 | 課税方式は年度ごとの `tax_settings` を正とし、ないときだけ事業者情報の既定値を使う | 年度によって課税方式が変わるため |
| — | カード払いの固定決済は `transfers` に入れず `card_recurring_payments` に分ける | 銀行の資金繰りで、カード引き落としと二重に数えないため（[20.5節](#205-カード払いの固定決済)） |
| — | 口座の残高は「明細の合計 ＋ 差額（`balanceAdjustment`）」に一本化する | 明細の取り込み前の残高を扱えるようにし、残高の定義を1か所にするため（[20.3節](#203-口座の残高)） |
| — | 振替とチャージの明細は、科目付けと転記の対象から除く | お金の置き場所が変わるだけで、収支ではないため |
| — | 勘定科目変換は対応の提案と記録までとし、既存データの科目の付け替えはしない | データの整合性と巻き戻しの設計が決まっていないため |
| — | 予実対比レポート（`/reports`）は廃止する | 画面の役割を整理したため |
| — | 科目別の予実対比は「予実と確定」で行い、確定した月の予算は変えられなくする。余りは原則として繰り越さず、期ズレと回し先へは科目ごとに選ぶ | 会社の予算管理にならい、比べる基準を動かさず、予算を使い切る動機を生まないため |
| — | 「予実と確定」は予算管理のタブではなく、ダッシュボードの KPI の下に置く（モバイルのホームも同じ位置） | 月の締めの作業を、毎回開く画面で目に付くようにするため |
| — | 実績の Excel 取り込みは廃止し、CSV だけにする | 依存するライブラリの管理の負担を減らすため |

## 25. 未決事項

| 項目 | 内容 |
|---|---|
| 本番構成 | 本番の compose に redis・session-cleanup・証憑のボリュームがない。レート制限とキャッシュ・セッションの掃除・証憑の保存をどうするか |
| 実際の銀行との連携 | 自動取得は今はモックだけ。口座アグリゲーションの事業者（Plaid・Moneytree など）を選び、契約と認証情報を用意する |
| 有料の AI 科目変換 | テーブルだけがあり、仕様（料金・キャッシュ・PDF の報告書）は [account-conversion-system.md](docs/design/account-conversion-system.md) の Phase 6 のまま |
| 発生主義の家計 | [home-mode-accrual-basis.md](docs/design/home-mode-accrual-basis.md) の設計を取り入れるか |
| 税理士ポータル | 画面は「複数テナント横断」とうたうが、API は自分のテナントだけを返す。複数のテナントを見る権限をどう設計するか |
| 多言語 | 言語の切り替えはログアウトの表記しか変えていない。対応を広げるか、切り替えをなくすか |
| 見つかった不具合 | 仕訳の登録でキャッシュが消えない、Holt 系の予測の保存先の手法など。[docs/tasks/task.md](docs/tasks/task.md) に記録した |
