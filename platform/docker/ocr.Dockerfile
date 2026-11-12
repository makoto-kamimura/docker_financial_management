# レシートの OCR サービス（app/ocr）。レシートを切り抜いて（OpenCV）、PaddleOCR で読む。
# ビルドコンテキストは app/ocr: docker build -f platform/docker/ocr.Dockerfile app/ocr
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import cv2, onnxruntime, rapidocr"

# PaddleOCR（PP-OCR の ONNX 版）のモデル。実行時にダウンロードしないよう、ビルド時に取り込んで sha256 を確かめる。
# OCR_PRESET（ocr_service/paddle.py の PRESETS）と合わせる。
ARG PADDLE_OCR_PRESET=v6-small
ENV PADDLE_OCR_MODEL_DIR=/opt/paddle-ocr \
    OCR_PRESET=${PADDLE_OCR_PRESET}
RUN set -eu; mkdir -p "$PADDLE_OCR_MODEL_DIR"; cd "$PADDLE_OCR_MODEL_DIR"; \
    base=https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx; \
    case "$PADDLE_OCR_PRESET" in \
      v6-small) \
        det="$base/PP-OCRv6/det/PP-OCRv6_det_small.onnx 090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"; \
        rec="$base/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx 6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884" ;; \
      v6-medium) \
        det="$base/PP-OCRv6/det/PP-OCRv6_det_medium.onnx 92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2"; \
        rec="$base/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b" ;; \
      *) echo "unknown PADDLE_OCR_PRESET: $PADDLE_OCR_PRESET" >&2; exit 1 ;; \
    esac; \
    for pair in "det:$det" "rec:$rec"; do \
      kind="${pair%%:*}"; rest="${pair#*:}"; url="${rest% *}"; sum="${rest##* }"; \
      out="$PADDLE_OCR_PRESET-$kind.onnx"; \
      python -c "import sys,urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$url" "$out"; \
      echo "$sum  $out" | sha256sum -c -; \
    done; \
    chmod 644 ./*.onnx

COPY ocr_service ./ocr_service

# root では動かさない
RUN useradd --system --uid 10001 --no-create-home ocr
USER ocr

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status == 200 else 1)"
CMD ["python", "-m", "ocr_service.server"]
