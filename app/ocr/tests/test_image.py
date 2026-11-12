import cv2
import numpy as np

from ocr_service import image


def _receipt_photo(bg=(60, 45, 35), paper=235, size=(1200, 1600), quad=None):
    """机（bg）の上に、文字の行がある白いレシートを少し傾けて置いた写真。"""
    w, h = size
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = bg
    pw, ph = 400, 1000
    sheet = np.full((ph, pw, 3), paper, np.uint8)
    for y in range(60, ph - 60, 40):
        cv2.rectangle(sheet, (30, y), (30 + (y * 7) % 250 + 60, y + 14), (40, 40, 40), -1)
    if quad is None:
        quad = np.float32([[420, 280], [800, 300], [790, 1320], [400, 1300]])
    m = cv2.getPerspectiveTransform(np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]]), quad)
    warped = cv2.warpPerspective(sheet, m, (w, h))
    mask = cv2.warpPerspective(np.full((ph, pw), 255, np.uint8), m, (w, h))
    img[mask > 0] = warped[mask > 0]
    return img, quad


def test_finds_the_receipt_and_warps_it_upright():
    img, quad = _receipt_photo()
    found = image.find_receipt_quad(img)
    assert found is not None
    got = image.order_points(found)
    want = image.order_points(quad)
    assert np.abs(got - want).max() < 25  # 縮小して探すので、数画素はずれてよい
    out, info = image.prepare(img)
    assert info["cropped"] is True
    h, w = out.shape[:2]
    assert 360 < w < 440 and 980 < h < 1060


def test_uses_the_whole_photo_when_no_receipt_is_found():
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (800, 600, 3), dtype=np.uint8)
    out, info = image.prepare(img)
    assert info["cropped"] is False
    assert out.shape == img.shape


def test_does_not_crop_when_the_receipt_fills_the_photo():
    img = np.full((1000, 600, 3), 235, np.uint8)
    for y in range(40, 960, 40):
        cv2.rectangle(img, (30, y), (400, y + 14), (40, 40, 40), -1)
    assert image.find_receipt_quad(img) is None


def test_finds_the_receipt_on_a_light_desk_by_its_edges():
    img, _ = _receipt_photo(bg=(205, 200, 195), paper=250)
    cv2.polylines(img, [np.int32([[420, 280], [800, 300], [790, 1320], [400, 1300]])], True,
                  (120, 120, 120), 3)  # 紙の縁の影
    assert image.find_receipt_quad(img) is not None


def test_quality_warnings():
    img, _ = _receipt_photo()
    sharp, _ = image.prepare(img, enhance="none")  # 画質はムラを消す前の画像で測る
    sharp = cv2.resize(sharp, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)  # 幅 600px
    assert image.quality(sharp)["warnings"] == []

    blurred = cv2.GaussianBlur(sharp, (0, 0), 6)
    assert "blurry" in image.quality(blurred)["warnings"]

    dark = (sharp * 0.35).astype(np.uint8)
    assert "too_dark" in image.quality(dark)["warnings"]

    small = cv2.resize(sharp, (sharp.shape[1] // 2, sharp.shape[0] // 2))
    assert "low_resolution" in image.quality(small)["warnings"]


def test_normalize_evens_out_a_shadow_and_keeps_the_text_dark():
    img, _ = _receipt_photo()
    shade = np.linspace(0.45, 1.0, img.shape[1], dtype=np.float32)[None, :, None]
    shaded = (img * shade).astype(np.uint8)
    out, _ = image.prepare(shaded)
    flat, _ = image.prepare(shaded, enhance="none")
    gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    paper = gray[gray > 150]
    assert paper.std() < cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)[gray > 150].std()
    assert gray.min() < 90  # 文字は黒いまま


def test_decode_rejects_broken_bytes():
    assert image.decode(b"") is None
    assert image.decode(b"not an image") is None
