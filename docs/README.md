# docs

仕様書の本体はリポジトリ直下の [readme.md](../readme.md)。`docs/` には、それ以外の資料を種類ごとのフォルダに分けて置く。

| フォルダ | 置くもの | 書く人 |
|---|---|---|
| [design/](design/) | 設計・要件の資料（[CI/CD](design/cicd.md)・[自動デプロイ](design/deploy.md)・要件定義（[個人事業主](design/requirements-sole-proprietor.md)・[法人](design/requirements-corporation.md)）・勘定科目の資料（[勘定科目変換](design/account-conversion-system.md)・[変換マスタ](design/account-master-mapping.md)・[家計の科目](design/home-mode-accounts.md)・[家計→法人の対応表](design/home-to-corporate-account-mapping.md)・[家計の発生主義](design/home-mode-accrual-basis.md)）） | 人 |
| [runbooks/](runbooks/) | 運用手順書（作業ごと。[デプロイとロールバック](runbooks/deploy-and-rollback.md)・[本番サーバーの準備](runbooks/production-server-setup.md)・[バックアップと復元](runbooks/backup-restore.md)・[ユーザーとテナント](runbooks/users-and-tenants.md)・[よくある操作](runbooks/common-operations.md)） | 人 |
| [incidents/](incidents/) | 障害のふりかえり（`YYYY-MM-DD-<概要>.md`） | 人 |
| [automation/](automation/) | 自動化するルーティンの手順 | 人（エージェントに変えさせない） |
| [tasks/](tasks/) | 残っている作業・不具合・要望（[task.md](tasks/task.md)） | 人・エージェント |
| [images/](images/) | readme などで使う画像 | 人 |

- まだ中身のないフォルダには、フォルダを git に残すための `.gitkeep` を置いている。中身ができても消さなくてよい。
- 不具合・要望のタスクは `tasks/` にだけ置く。設計・運用の資料と混ぜない。
- 変更の履歴は git log に任せ、履歴のためのファイルは作らない。
- 個人のデータ（`*.csv` など）や作業メモは git 管理の外に置く（`.gitignore`）。
