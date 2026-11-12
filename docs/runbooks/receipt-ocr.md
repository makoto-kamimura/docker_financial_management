# レシートの OCR サービス

無料プランのレシートの読み取りに使う OCR サービス（`app/ocr`、compose の `ocr`）の運用と、精度の測り方。仕組みは readme の 20.14 節を参照。

- コマンドは配置先のディレクトリ（`DEPLOY_PATH`）で実行する。以下の `$COMPOSE` は `docker compose --env-file .env -f platform/docker-compose.prod.yml` のこと。

## 1. 動いているか確かめる

```bash
$COMPOSE ps ocr                       # healthy なら動いている
$COMPOSE logs --tail=20 ocr           # 1 枚ごとに「read ocr=1 cropped=1 lines=32 4200ms」のような行が出る
```

- ログには、画像も読み取った文字も出さない。出るのは、切り抜けたか・行の数・かかった時間だけ。
- `ocr` が止まっていても、web は自分の中の Tesseract で読む（精度は落ちる）。web のログに `falling back to tesseract.js` が出る。
- どちらで読んだかは `receipt_scan_requests.model` に残る（`pp-ocr-v6-small` / `tesseract.js`）。

```sql
SELECT model, count(*) FROM receipt_scan_requests
WHERE engine = 'tesseract' AND "createdAt" > now() - interval '7 days' GROUP BY model;
```

## 2. 設定

`ocr` の環境変数（どれも省略できる）。変えたら `$COMPOSE up -d ocr`。

| 変数 | 既定 | 内容 |
|---|---|---|
| `OCR_MAX_SIDE` | 2000 | 読む前に、切り抜いたレシートの長辺をここまで縮める（PaddleOCR の `max_side_len`）。アプリは長辺 1600px で送るので、今は縮めることはない |
| `OCR_THREADS` | 2 | 1 枚を読むのに使う CPU のスレッド数 |
| `OCR_CONCURRENCY` | 1 | 同時に読む枚数。1 枚で 500MB 前後使うので、メモリに余裕がなければ 1 のまま |
| `OCR_QUEUE_SECONDS` | 60 | 前の読み取りが終わるのを待つ秒数。待ちきれなければ「混み合っています」 |
| `OCR_TIMEOUT_SECONDS` | 60 | 1 枚の読み取りの時間切れ |
| `OCR_ENHANCE` | normalize | 読む前に影・照明のムラを消す。`none` で止める（評価では止めると文字誤り率が上がった。下の「結果」） |

モデルを `v6-medium`（誤りは少ないが、メモリと時間が数倍）に変えるときは、ビルド引数 `PADDLE_OCR_PRESET=v6-medium` でイメージを作り直す（モデルはビルド時に取り込み、sha256 を確かめる）。

## 3. 精度を測る

合成のレシート写真で、日付・店名・合計・支払方法・セルフメディケーションの対象額が合うかと、文字誤り率（CER）を測る。
読み取り → 解析まで本番と同じ処理（`scanLocally` と同じ関数）で流す。合成なので、実物の写真での値とは違う。

1. OCR のイメージを作り、手元で動かす（ポートは localhost だけに出す）。

   ```bash
   docker build -f platform/docker/ocr.Dockerfile -t financial-ocr:dev app/ocr
   docker run -d --name financial-ocr-eval --memory 1500m -p 127.0.0.1:18000:8000 financial-ocr:dev
   ```

2. 合成のサンプルを作る。日本語のフォントを 1 つ以上渡す（`app/web/assets/fonts/BIZUDGothic-Regular.ttf` など）。
   `--fill 0.38 0.55` を付けると、遠くから撮った（文字が小さく写る）写真になる。
   `--kind medical` を付けると、病院・薬局の領収書（点数の表・領収金額・下のほうの医療機関名と印、色の付いた用紙、生年月日・次回の予約の日付）になる。

   ```bash
   mkdir -p /tmp/receipts && chmod 777 /tmp/receipts
   docker run --rm --network none -v "$PWD/app/ocr:/src:ro" -v "$PWD/app/web/assets/fonts:/fonts:ro" \
     -v /tmp/receipts:/out --entrypoint python financial-ocr:dev \
     /src/scripts/receipt_eval.py synth --out /out --n 60 --fonts /fonts/BIZUDGothic-Regular.ttf
   ```

3. 測る（`app/web` で）。`--engines tesseract` で web の中の Tesseract、`service` で OCR サービス。

   ```bash
   npx tsx scripts/receipt-eval.ts --samples /tmp/receipts --ocr-url http://localhost:18000 --verbose
   ```

   写真はアプリと同じく長辺 1600px の JPEG に縮めてから読む（`--max-edge` で変えられる）。`--out result.json` で 1 枚ごとの結果を書き出す。

4. 実物のレシートも測れる。写真 `xxx.jpg` の横に、正解 `xxx.json` を置く（形は合成のサンプルと同じ。`text` は省略してよい）。

   ```json
   { "date": "2026-10-13", "merchant": "店名", "total": 1280, "paymentMethod": "cash", "selfMedicationTotal": null }
   ```

   実物の写真と正解は個人のデータなので、リポジトリには入れない。

5. 終わったら `docker rm -f financial-ocr-eval`。

### 結果

2026-11 に測った値（4 コアのホストで、OCR のコンテナを 3 コアに制限）。サンプルは易しい 12MP と難しい 7MP の写真が半分ずつ。
「遠く」は `--fill 0.38 0.55`（レシートが写真の高さの 4〜5 割）。4 項目は日付・店名・合計・支払方法。

| サンプル | 方式 | 4 項目すべて | 文字誤り率 | 1 枚 |
|---|---|---|---|---|
| 60 枚 | Tesseract・以前の解析（以前の方式） | 0% | 24.4% | 約 2 秒 |
| 60 枚 | Tesseract（OCR サービスに届かないとき） | 3% | 24.4% | 約 2 秒 |
| 60 枚 | OCR サービス・以前の解析 | 60% | 1.9% | 約 4.4 秒 |
| 60 枚 | **OCR サービス** | **98%** | **1.9%** | **約 4.4 秒** |
| 遠く 40 枚 | **OCR サービス** | **100%** | **2.3%** | **約 4.2 秒** |

設定を変えた比較（遠く 40 枚。4 項目はどれも 100%）:

| 設定 | 文字誤り率 | 1 枚 |
|---|---|---|
| 影を消さない（`OCR_ENHANCE=none`） | 2.9% | 約 4.4 秒 |
| **影を消す（既定）** | **2.3%** | **約 4.3 秒** |
| 影を消さず、アプリから長辺 2400px で送る | 2.2% | 約 4.8 秒 |
| 影を消さず、`OCR_MAX_SIDE=1600` | 2.9% | 約 4.6 秒 |
| 影を消さず、小さいレシートを幅 720px に拡大 | 3.0% | 約 4.2 秒 |

- 影を消すと、アプリから大きい写真を送るのとほぼ同じだけ誤りが減り、時間は変わらない。なので影を消すのを既定にし、送る写真は長辺 1600px のまま（証憑の大きさと、有料プランの読み取りの課金が増えないように）。
- 影を消すと、日付と時刻のあいだの空白が読めないことが増えた（「26/10/1312:34」）。解析でこの形も読むようにした。
- 待機中のメモリは約 30MB、読み取り中は最大 300〜440MB。1 枚のうち約 1.7 秒は、モデルの読み込み（読み終わればメモリを返すため、毎回読み込む）。
- 残った誤りは、店名の「ユ」を小さい「ュ」と読んだ 1 枚だけ。

医療の領収書（`--kind medical`、40 枚。4 項目の支払方法の正解は「分からない」）:

| 解析 | 日付 | 店名 | 合計 | 4 項目すべて |
|---|---|---|---|---|
| 医療の領収書に合わせる前 | 100% | 0% | 35% | 0% |
| **合わせたあと** | **100%** | **100%** | **100%** | **100%** |

- 合わせる前は、店名に「患者番号」「生年月日」の行を、合計に何も拾えないこと（「今回領収額」「お支払額」を見ていなかった）が多かった。
- 文字誤り率は 24% と高く出るが、表を読む順番が正解の文と違うためで、読み違いは少ない（「負担」を「负担」、「薬」を「莱」と読むなど）。
- 送る写真を大きくしなくても 4 項目は読めたので、書類も長辺 1600px のまま送る。
