"""レシートの写真 1 枚を読む（子プロセスの入口）。結果は JSON で標準出力に書く。

    python -m ocr_service.receipt IMAGE [--no-ocr] [--image-out PATH]

PaddleOCR は 1 回の読み取りで数百 MB のメモリを使うので、server.py は 1 枚ごとにこれを別プロセスで
動かし、読み終わればメモリを返す。

出力:
    width / height … 読み取りに使った画像（切り抜き・回転のあと）の大きさ
    cropped        … レシートを見つけて切り抜いたか
    rotation       … 横向きの写真を何度回して読んだか（0 / 90 / 270）
    quality        … 画質の指標と警告（image.quality）
    lines          … 行ごとの文字と位置（paddle.group_lines。--no-ocr なら空）
    text           … 行を改行でつないだもの
    model          … 読んだモデル（記録用。--no-ocr なら null）
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2

from ocr_service import image as image_mod
from ocr_service import paddle


def run(path: str, *, ocr: bool = True, image_out: str | None = None,
        preset: str = paddle.DEFAULT_PRESET, threads: int = 2,
        max_side: int = paddle.DEFAULT_MAX_SIDE, enhance: str = "normalize") -> dict:
    with open(path, "rb") as f:
        img = image_mod.decode(f.read())
    if img is None:
        return {"error": "decode_failed"}

    prepared, info = image_mod.prepare(img, enhance=enhance)
    lines: list[dict] = []
    rotation = 0
    if ocr:
        items, prepared, rotation = paddle.read(prepared, paddle.engine(preset, threads, max_side))
        lines = paddle.group_lines(items)
    if image_out:
        cv2.imwrite(image_out, prepared, [cv2.IMWRITE_JPEG_QUALITY, 90])
    h, w = prepared.shape[:2]
    return {
        "width": w,
        "height": h,
        "cropped": info["cropped"],
        "rotation": rotation,
        "quality": info["quality"],
        "lines": lines,
        "text": "\n".join(line["text"] for line in lines),
        "model": f"pp-ocr-{preset}" if ocr else None,
    }


def _main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--no-ocr", action="store_true", help="切り抜きと画質の判定だけ")
    ap.add_argument("--image-out", help="切り抜いた画像（JPEG）を書き出す先")
    ap.add_argument("--preset", default=os.environ.get("OCR_PRESET", paddle.DEFAULT_PRESET),
                    choices=sorted(paddle.PRESETS))
    ap.add_argument("--threads", type=int, default=int(os.environ.get("OCR_THREADS", "2")))
    ap.add_argument("--max-side", type=int,
                    default=int(os.environ.get("OCR_MAX_SIDE", str(paddle.DEFAULT_MAX_SIDE))))
    ap.add_argument("--enhance", default=os.environ.get("OCR_ENHANCE", "normalize"),
                    choices=["none", "normalize"])
    args = ap.parse_args(argv)
    out = run(args.image, ocr=not args.no_ocr, image_out=args.image_out, preset=args.preset,
              threads=args.threads, max_side=args.max_side, enhance=args.enhance)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    _main(sys.argv[1:])
