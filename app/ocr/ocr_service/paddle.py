"""PaddleOCR（PP-OCR を RapidOCR / ONNX Runtime で実行）でレシートを読み、文字の枠を行にまとめる。

モデルはイメージのビルド時に焼き込む（PADDLE_OCR_MODEL_DIR）。実行時には取りに行かない。
"""

from __future__ import annotations

import os

import numpy as np

MODEL_DIR = os.environ.get("PADDLE_OCR_MODEL_DIR", "/opt/paddle-ocr")

PRESETS: dict[str, dict] = {
    "v6-small": {"version": "PP-OCRv6", "det": "small", "rec": "small"},
    "v6-medium": {"version": "PP-OCRv6", "det": "medium", "rec": "medium"},
}
DEFAULT_PRESET = "v6-small"
DEFAULT_MAX_SIDE = 2000
# これより自信のない文字の枠は捨てる（レシートの地紋・ロゴの読み違いを拾わない）
MIN_SCORE = 0.5


def engine(preset: str = DEFAULT_PRESET, threads: int = 2, max_side: int = DEFAULT_MAX_SIDE):
    from rapidocr import LangDet, LangRec, ModelType, OCRVersion, RapidOCR

    p = PRESETS[preset]
    version = OCRVersion(p["version"])
    params = {
        "Global.log_level": "warning",
        # 向きは image.py の切り抜きと、ここでの縦横の判定（read の rotate）で直す
        "Global.use_cls": False,
        "Global.max_side_len": max_side,
        "EngineConfig.onnxruntime.intra_op_num_threads": threads,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "Det.ocr_version": version,
        "Det.model_type": ModelType(p["det"]),
        "Det.lang_type": LangDet.CH,
        "Rec.ocr_version": version,
        "Rec.model_type": ModelType(p["rec"]),
        "Rec.lang_type": LangRec.JAPAN,
    }
    det = os.path.join(MODEL_DIR, f"{preset}-det.onnx")
    rec = os.path.join(MODEL_DIR, f"{preset}-rec.onnx")
    if os.path.exists(det) and os.path.exists(rec):
        params["Det.model_path"] = det
        params["Rec.model_path"] = rec
    return RapidOCR(params=params)


def _boxes(result) -> list[dict]:
    """RapidOCR の結果を、文字の枠の一覧（文字・4 隅・自信）にする。"""
    if result.boxes is None or result.txts is None:
        return []
    out = []
    scores = result.scores if result.scores is not None else [1.0] * len(result.txts)
    for box, txt, score in zip(result.boxes, result.txts, scores):
        text = str(txt or "").strip()
        if not text or float(score) < MIN_SCORE:
            continue
        out.append({"t": text, "pts": [(float(x), float(y)) for x, y in box], "score": float(score)})
    return out


def is_rotated(items: list[dict]) -> bool:
    """文字の枠の多くが縦長なら、写真が横向き（レシートは横書き）。"""
    tall = wide = 0
    for it in items:
        xs = [x for x, _ in it["pts"]]
        ys = [y for _, y in it["pts"]]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if len(it["t"]) < 2:
            continue
        if h > 1.5 * w:
            tall += 1
        elif w > 1.5 * h:
            wide += 1
    return tall > wide and tall >= 3


def _confidence(items: list[dict]) -> float:
    """読めた文字の量（自信 × 文字数の合計）。向きを比べるのに使う。"""
    return sum(it["score"] * len(it["t"]) for it in items)


def read(img: np.ndarray, ocr) -> tuple[list[dict], np.ndarray, int]:
    """読んで (文字の枠, 読んだ画像, 回した角度) を返す。横向きの写真は 90 度ずつ回して読み直す。"""
    import cv2

    items = _boxes(ocr(img))
    if not is_rotated(items):
        return items, img, 0
    best = (items, img, 0)
    for angle, code in ((90, cv2.ROTATE_90_CLOCKWISE), (270, cv2.ROTATE_90_COUNTERCLOCKWISE)):
        turned = cv2.rotate(img, code)
        cand = _boxes(ocr(turned))
        if _confidence(cand) > _confidence(best[0]):
            best = (cand, turned, angle)
    return best


def _geometry(pts: list[tuple[float, float]]) -> dict:
    """枠の 4 隅から、左端の中心・傾き・文字の高さ・外接矩形を求める（少し傾いた行にも対応）。"""
    by_x = sorted(pts)
    left = sorted(by_x[:2], key=lambda p: p[1])
    right = sorted(by_x[2:], key=lambda p: p[1])
    lx = (left[0][0] + left[1][0]) / 2
    ly = (left[0][1] + left[1][1]) / 2
    rx = (right[0][0] + right[1][0]) / 2
    ry = (right[0][1] + right[1][1]) / 2
    slope = (ry - ly) / (rx - lx) if rx - lx > 1 else 0.0
    thick = max(((left[1][1] - left[0][1]) + (right[1][1] - right[0][1])) / 2, 1.0)
    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]
    return {"lx": lx, "ly": ly, "slope": slope, "thick": thick,
            "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}


def group_lines(items: list[dict]) -> list[dict]:
    """同じ行の枠をまとめ、上の行から、行の中は左から並べる。

    同じ行かどうかは、行の傾きを延ばした位置と枠の左端の中心との距離（文字の高さの半分以内）で決める。
    レシートは品名と金額が離れて並ぶので、外接矩形の重なりではなく傾きで見る。
    戻り値の行: text・x0/y0/x1/y1（外接矩形）・height（文字の高さ）・score（行の中で一番低い自信）
    """
    for it in items:
        it.update(_geometry(it["pts"]))
    groups: list[dict] = []
    for it in sorted(items, key=lambda it: it["ly"]):
        best, best_d = None, None
        for g in groups:
            ref = g["ref"]
            expected = ref["ly"] + ref["slope"] * (it["lx"] - ref["lx"])
            d = abs(it["ly"] - expected)
            if d <= 0.5 * min(ref["thick"], it["thick"]) and (best_d is None or d < best_d):
                best, best_d = g, d
        if best is None:
            groups.append({"ref": it, "items": [it]})
        else:
            best["items"].append(it)
            if it["x1"] - it["x0"] > best["ref"]["x1"] - best["ref"]["x0"]:
                best["ref"] = it  # 長い枠ほど傾きが正確

    def level(g: dict) -> float:
        ref = g["ref"]
        return ref["ly"] - ref["slope"] * ref["lx"]  # 左端（x=0）での行の位置

    lines = []
    for g in sorted(groups, key=level):
        its = sorted(g["items"], key=lambda it: it["lx"])
        heights = sorted(it["thick"] for it in its)
        lines.append({
            "text": " ".join(it["t"] for it in its),
            "x0": round(min(it["x0"] for it in its), 1),
            "y0": round(min(it["y0"] for it in its), 1),
            "x1": round(max(it["x1"] for it in its), 1),
            "y1": round(max(it["y1"] for it in its), 1),
            "height": round(heights[len(heights) // 2], 1),
            "score": round(min(it["score"] for it in its), 3),
        })
    return lines
