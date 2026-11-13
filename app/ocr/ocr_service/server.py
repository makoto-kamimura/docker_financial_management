"""OCR サービスの HTTP の口（標準ライブラリだけ。待機中のメモリを小さくするため OpenCV も読み込まない）。

    GET  /health                       … 動いているか
    POST /v1/receipt?ocr=1&image=0     … 本文に画像のバイト列。読み取った行・画質を JSON で返す
                                          ocr=0 なら切り抜きと画質の判定だけ、image=1 なら切り抜いた画像
                                          （JPEG の base64）も返す

読み取りは 1 枚ごとに子プロセス（receipt.py）で行い、同時に動かす数を OCR_CONCURRENCY で絞る
（既定 1。空くのを OCR_QUEUE_SECONDS 秒まで待ち、待ちきれなければ 503）。
compose の中だけで使う（ポートは外に出さない）。画像も読み取った文字も残さず、ログにも書かない。
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("OCR_PORT", "8000"))
MAX_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(20 * 1024 * 1024)))
TIMEOUT = float(os.environ.get("OCR_TIMEOUT_SECONDS", "60"))
QUEUE_WAIT = float(os.environ.get("OCR_QUEUE_SECONDS", "60"))
SLOTS = threading.BoundedSemaphore(max(1, int(os.environ.get("OCR_CONCURRENCY", "1"))))
# 子プロセスが `python -m ocr_service.receipt` で読み込めるよう、パッケージの親で動かす
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Busy(Exception):
    """読み取りが混んでいて、空くのを待ちきれなかった。"""


def read_receipt(data: bytes, *, ocr: bool = True, want_image: bool = False) -> dict:
    if not SLOTS.acquire(timeout=QUEUE_WAIT):
        raise Busy()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "receipt")
            with open(src, "wb") as f:
                f.write(data)
            cmd = [sys.executable, "-m", "ocr_service.receipt", src]
            if not ocr:
                cmd.append("--no-ocr")
            out_img = os.path.join(tmp, "cropped.jpg") if want_image else None
            if out_img:
                cmd += ["--image-out", out_img]
            res = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT, check=True, cwd=APP_DIR)
            result = json.loads(res.stdout.decode("utf-8"))
            if out_img and "error" not in result and os.path.exists(out_img):
                with open(out_img, "rb") as f:
                    result["image"] = base64.b64encode(f.read()).decode("ascii")
            return result
    finally:
        SLOTS.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "receipt-ocr"

    def _json(self, status: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler の決まり
        if urlparse(self.path).path == "/health":
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/v1/receipt":
            self._json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._json(400, {"error": "empty_body"})
            return
        if length > MAX_BYTES:
            self._json(413, {"error": "too_large"})
            return
        data = self.rfile.read(length)
        q = parse_qs(url.query)
        ocr = q.get("ocr", ["1"])[0] != "0"
        want_image = q.get("image", ["0"])[0] == "1"
        started = time.monotonic()
        try:
            result = read_receipt(data, ocr=ocr, want_image=want_image)
        except Busy:
            print(f"[ocr] busy: waited {QUEUE_WAIT:.0f}s for the previous read", flush=True)
            self._json(503, {"error": "busy"})
            return
        except subprocess.TimeoutExpired:
            print(f"[ocr] read timed out after {TIMEOUT:.0f}s", flush=True)
            self._json(504, {"error": "timeout"})
            return
        except subprocess.CalledProcessError as e:
            tail = e.stderr.decode("utf-8", "replace")[-800:] if e.stderr else ""
            print(f"[ocr] reader failed (exit {e.returncode}): {tail}", file=sys.stderr, flush=True)
            self._json(500, {"error": "failed"})
            return
        if result.get("error") == "decode_failed":
            self._json(422, {"error": "decode_failed"})
            return
        ms = round((time.monotonic() - started) * 1000)
        print(f"[ocr] read ocr={int(ocr)} cropped={int(bool(result.get('cropped')))} "
              f"lines={len(result.get('lines') or [])} {ms}ms", flush=True)
        self._json(200, result)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - 親のシグネチャに合わせる
        # アクセスログは出さない（read の行だけ出す。/health のログで埋まらないように）
        pass


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"[ocr] listening on :{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
