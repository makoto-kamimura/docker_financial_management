# 証憑の置き場所を Cloudflare R2 に移す

証憑（仕訳の添付・レシートの写真）の置き場所を、web コンテナのボリューム（`/app/uploads`）から Cloudflare R2 に移す手順。仕組みは readme の 20.10 節を参照。

- ボリュームの証憑は DB のバックアップに含まれず、ホストを失うと戻せない。R2 に置けばホストの外に残る。
- 切り替えたあとも、R2 に無いファイルはボリュームから読むので、既存のファイルを移す前でも配信は切れない。
- コマンドは配置先のディレクトリ（`DEPLOY_PATH`）で実行する。以下の `$COMPOSE` は `docker compose --env-file .env -f platform/docker-compose.prod.yml` のこと。

## 1. バケットとトークンを作る

1. Cloudflare のダッシュボードで R2 のバケットを作る（例: `financial-receipts`）。公開アクセス（r2.dev・カスタムドメイン）は有効にしない。
2. R2 の API トークンを作る。権限は「オブジェクトの読み取りと書き込み」、対象はこのバケットだけにする。
3. アカウント ID・アクセスキー ID・シークレットアクセスキーを控える（シークレットは作成時にしか表示されない）。

## 2. 切り替える

1. `.env` に設定を入れる。

   ```bash
   UPLOAD_STORAGE=r2
   R2_ACCOUNT_ID=<アカウント ID>
   R2_ACCESS_KEY_ID=<アクセスキー ID>
   R2_SECRET_ACCESS_KEY=<シークレットアクセスキー>
   R2_BUCKET=financial-receipts
   ```

2. web を作り直す: `$COMPOSE up -d web`
3. 画面で証憑を 1 つ付けて、開けることを確かめる。R2 のダッシュボードで、`<テナント ID>/<保存名>` のオブジェクトができていることを確かめる。

ここから新しい証憑は R2 に入る。既存の証憑は、まだボリュームから読んでいる。

## 3. 既存の証憑を R2 にコピーする

1. 何件コピーするかを確かめる（書き込まない）。

   ```bash
   $COMPOSE exec web npx tsx scripts/migrate-uploads-to-r2.ts --dry-run
   ```

2. コピーする。何度流しても同じ結果になる（R2 に同じサイズのものがあれば飛ばす）。

   ```bash
   $COMPOSE exec web npx tsx scripts/migrate-uploads-to-r2.ts
   ```

3. 結果を確かめる。
   - 「ローカルに無い」: DB に行があるのにファイルが無い。移行の前から開けなかった証憑なので、一覧を残しておく。
   - 「R2 にサイズの違うものがある」: 上書きしていない（終了コード 1）。R2 のオブジェクトとボリュームのファイルを見比べて、正しいほうを手で置き直す。
4. もう一度流して、「コピーした 0 件」になることを確かめる。

旧構成の平置き（`/app/uploads/<保存名>`）のファイルも、R2 ではテナントごとのキーにそろう。

## 4. ボリュームを片付ける

すぐには消さない。しばらく運用して、証憑が開けることを確かめてから手で消す。

1. 念のため、ボリュームの中身を控えておく。

   ```bash
   $COMPOSE exec -T web tar czf - -C /app uploads > uploads-$(date +%Y%m%d).tar.gz
   ```

2. ボリュームの中のファイルを消す: `$COMPOSE exec web sh -c 'rm -rf /app/uploads/*'`
3. 画面で、古い証憑と新しい証憑の両方が開けることを確かめる。

## 5. ボリュームに戻す（R2 をやめる）

1. R2 にしか無い証憑（切り替えたあとに付けたもの）を、ボリュームに戻す。R2 のオブジェクトを `/app/uploads/<テナント ID>/<保存名>` に置く（`rclone` や `aws s3 cp --endpoint-url https://<アカウント ID>.r2.cloudflarestorage.com` などで）。
2. `.env` の `UPLOAD_STORAGE` を `local` に戻し、`$COMPOSE up -d web` で作り直す。
3. 画面で証憑が開けることを確かめてから、R2 のバケットを片付ける。
