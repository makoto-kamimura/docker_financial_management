"""レシート・領収証の写真を読む OCR サービス（web の lib/ledger/receipt-scan/ocr-service.ts から呼ぶ）。

- image.py   … 写真からレシートを切り抜き（台形補正）、画質を判定する（OpenCV）
- paddle.py  … PaddleOCR（PP-OCR を RapidOCR / ONNX Runtime で実行）で読み、文字の枠を行にまとめる
- receipt.py … 1 枚を読む子プロセスの入口（読み終わればメモリを返す）
- server.py  … HTTP の口（標準ライブラリだけで動く。読み取りは子プロセスに任せる）
"""
