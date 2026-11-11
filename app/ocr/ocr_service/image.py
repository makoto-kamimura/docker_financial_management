"""レシートの写真の前処理（OpenCV）。

机などに置いたレシートを撮った写真から、紙の部分を見つけて上から見た形に直し（台形補正・切り抜き）、
画質（ぼけ・暗さ・影・小ささ）を判定する。切り抜くと、読み取りに使える画素が文字に集まる。
紙が見つからなければ、写真をそのまま使う（読み取りは止めない）。
"""

from __future__ import annotations

import cv2
import numpy as np

# 紙の候補とみなす面積（写真に対する割合）。小さすぎるものは紙ではなく、ほぼ全体なら切り抜く意味がない
MIN_AREA = 0.05
MAX_AREA = 0.97
# 細長さの上限（長いレシートでも 1:10 くらいまで）
MAX_ASPECT = 10.0
# 縮小して紙を探すときの長辺
DETECT_SIDE = 1000


def decode(data: bytes) -> np.ndarray | None:
    """画像のバイト列を BGR の配列にする（EXIF の向きは imdecode が直す）。読めなければ None。"""
    arr = np.frombuffer(data, np.uint8)
    if arr.size == 0:
        return None
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def order_points(pts: np.ndarray) -> np.ndarray:
    """4 点を [左上, 右上, 右下, 左下] に並べる。"""
    pts = np.asarray(pts, dtype="float32").reshape(4, 2)
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1).ravel()
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _plausible(quad: np.ndarray, shape: tuple[int, int]) -> bool:
    """紙の外形として妥当か（面積・凸・細長さ・4 点が重なっていない）。"""
    h, w = shape
    q = order_points(quad)
    if len({(round(float(x)), round(float(y))) for x, y in q}) < 4:
        return False
    area = cv2.contourArea(q)
    if not (MIN_AREA * w * h <= area <= MAX_AREA * w * h):
        return False
    if not cv2.isContourConvex(q.astype(np.int32)):
        return False
    tl, tr, br, bl = q
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    if min(width, height) < 0.04 * max(w, h):
        return False
    return max(width, height) / max(min(width, height), 1.0) <= MAX_ASPECT


def _quad_of(contour: np.ndarray) -> np.ndarray:
    """輪郭を 4 点にする。きれいな四角形にならなければ、外接する回転した長方形を使う
    （くしゃっとしたレシートは辺が曲がり、多角形の近似が 4 点にならない）。"""
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    if len(approx) == 4:
        return approx.reshape(4, 2).astype("float32")
    return cv2.boxPoints(cv2.minAreaRect(contour)).astype("float32")


def _paper_quad(small: np.ndarray) -> np.ndarray | None:
    """白っぽい（明るく色の薄い）大きな塊を紙とみなす。レシートと机の色が違うときに強い。"""
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1].astype(np.float32)
    val = hsv[..., 2].astype(np.float32)
    # 明るいほど、色が薄いほど紙らしい
    paper = np.clip(val * (1.0 - sat / 255.0 * 0.8), 0, 255).astype(np.uint8)
    paper = cv2.GaussianBlur(paper, (5, 5), 0)
    _, mask = cv2.threshold(paper, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k = max(3, (min(small.shape[:2]) // 40) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)  # 文字の穴を埋める
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)  # 机の上の小さな光を消す
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    quad = _quad_of(biggest)
    return quad if _plausible(quad, small.shape[:2]) else None


def _edge_quad(small: np.ndarray) -> np.ndarray | None:
    """輪郭（エッジ）から一番大きな四角形を探す。白い机の上など、明るさで分けられないとき用。"""
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) != 4:
            continue
        quad = approx.reshape(4, 2).astype("float32")
        if _plausible(quad, small.shape[:2]):
            return quad
    return None


def find_receipt_quad(img: np.ndarray) -> np.ndarray | None:
    """写真の中のレシートの四隅（元の画像の座標）。見つからなければ None。"""
    h, w = img.shape[:2]
    ratio = min(1.0, DETECT_SIDE / max(h, w))
    small = cv2.resize(img, (max(round(w * ratio), 1), max(round(h * ratio), 1)),
                       interpolation=cv2.INTER_AREA)
    for find in (_paper_quad, _edge_quad):
        quad = find(small)
        if quad is not None:
            return quad / ratio
    return None


def warp(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    """四隅を上から見た長方形に直す（台形補正＋切り抜き）。"""
    rect = order_points(quad)
    tl, tr, br, bl = rect
    width = int(round(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl))))
    height = int(round(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl))))
    if width < 10 or height < 10:
        return img
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
                   dtype="float32")
    m = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, m, (width, height), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)


def normalize_illumination(img: np.ndarray) -> np.ndarray:
    """紙の明るさ（背景）を推定して割り、影・照明のムラを消す。文字の色は残す。

    文字より大きい窓の最大値フィルタで文字を消した「紙だけの画像」を作り、元の画像をそれで割る。
    """
    h, w = img.shape[:2]
    s = 4
    small = cv2.resize(img, (max(w // s, 1), max(h // s, 1)), interpolation=cv2.INTER_AREA)
    k = max(9, (min(small.shape[:2]) // 20) | 1)
    bg = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    bg = cv2.medianBlur(bg, min(k, 255))
    bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.divide(img, bg, scale=255)


def quality(img: np.ndarray) -> dict:
    """画質の指標と警告。レシートを切り抜いた画像（切り抜けなければ写真全体）で測る。

    - blurry: 文字の縁がぼけている（幅 600px にそろえて測る。解像度で値が変わらないように）
    - too_dark / too_bright: 紙の明るさ
    - uneven_lighting: 影・照明のムラ
    - low_resolution: レシートの幅が小さく、文字がつぶれやすい（もっと近づいて撮る）
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    h, w = gray.shape[:2]
    short = min(h, w)
    scale = 600.0 / short
    norm = cv2.resize(gray, (max(round(w * scale), 1), max(round(h * scale), 1)),
                      interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    lap = np.abs(cv2.Laplacian(norm, cv2.CV_32F))
    # 文字の縁だけを見る（白い余白が多いレシートでも、ぼけの度合いが分かるように）
    sharp = float(np.percentile(lap, 99.5))
    brightness = float(np.percentile(gray, 90))  # 紙の明るさ（文字の黒に引っぱられない）
    s = 8
    tiny = cv2.resize(gray, (max(w // s, 1), max(h // s, 1)), interpolation=cv2.INTER_AREA)
    illum = cv2.GaussianBlur(tiny, (0, 0), sigmaX=max(max(h, w) / 30.0 / s, 1.0))
    shadow = float(illum.std())

    warnings: list[str] = []
    if short < 450:
        warnings.append("low_resolution")
    if sharp < 40:
        warnings.append("blurry")
    if brightness < 110:
        warnings.append("too_dark")
    if float(np.percentile(gray, 30)) > 250:
        warnings.append("too_bright")
    if shadow > 40:
        warnings.append("uneven_lighting")
    return {
        "width": w,
        "height": h,
        "sharpness": round(sharp, 1),
        "brightness": round(brightness, 1),
        "shadow": round(shadow, 1),
        "warnings": warnings,
    }


def prepare(img: np.ndarray, enhance: str = "normalize") -> tuple[np.ndarray, dict]:
    """レシートを切り抜いて、読み取りに渡す画像と、画質の判定を返す。

    enhance: "normalize"（影・照明のムラを消す。既定）/ "none"（切り抜いただけ）。
    合成のレシートの評価で、normalize は文字誤り率を 2.2% → 1.9%（遠くから撮った写真は 2.9% → 2.3%）に下げ、
    時間は変わらなかった（docs/runbooks/receipt-ocr.md）。小さいレシートの拡大は効かなかったので、していない。
    """
    info: dict = {"cropped": False}
    try:
        quad = find_receipt_quad(img)
        if quad is not None:
            warped = warp(img, quad)
            if warped.size > 0 and warped is not img:
                img = warped
                info["cropped"] = True
    except cv2.error:
        pass
    info["quality"] = quality(img)
    if enhance == "normalize":
        img = normalize_illumination(img)
    return img, info
