import numpy as np

from ocr_service import paddle


def box(x0, y0, x1, y1, dy=0.0):
    """左上から時計回りの 4 隅（dy で右側を下げて傾ける）。"""
    return [(x0, y0), (x1, y0 + dy), (x1, y1 + dy), (x0, y1)]


def item(t, b, score=0.95):
    return {"t": t, "pts": b, "score": score}


def test_groups_name_and_price_on_the_same_line():
    items = [
        item("¥1,280", box(600, 302, 700, 330)),
        item("合計", box(40, 300, 120, 328)),
        item("小計", box(40, 250, 120, 278)),
        item("¥1,280", box(600, 251, 700, 279)),
        item("スーパーみどり屋", box(100, 40, 600, 100)),
    ]
    lines = paddle.group_lines(items)
    assert [ln["text"] for ln in lines] == ["スーパーみどり屋", "小計 ¥1,280", "合計 ¥1,280"]
    assert lines[0]["height"] > 2 * lines[1]["height"]
    assert lines[2]["x0"] == 40 and lines[2]["x1"] == 700


def test_follows_the_slope_of_a_tilted_receipt():
    # 右に行くほど 0.05 ずつ下がる。右端の金額は、外接矩形では次の行と重なる高さにある
    slope = 0.05
    items = [
        item("お会計", box(40, 300, 140, 328, dy=5)),
        item("¥3,900", box(560, 300 + 520 * slope, 680, 328 + 520 * slope, dy=6)),
        item("お預り", box(40, 332, 140, 360, dy=5)),
        item("¥5,000", box(560, 332 + 520 * slope, 680, 360 + 520 * slope, dy=6)),
    ]
    lines = paddle.group_lines(items)
    assert [ln["text"] for ln in lines] == ["お会計 ¥3,900", "お預り ¥5,000"]


def test_is_rotated_when_most_boxes_are_tall():
    tall = [item("合計金額", box(10, 10 + 100 * i, 40, 100 + 100 * i)) for i in range(4)]
    wide = [item("合計金額", box(10, 10 + 40 * i, 120, 40 + 40 * i)) for i in range(4)]
    assert paddle.is_rotated(tall)
    assert not paddle.is_rotated(wide)


class FakeOcr:
    """画像の縦横で結果を変える偽の OCR（横長の画像は横向きに撮った写真）。"""

    def __init__(self):
        self.calls = []

    def __call__(self, img):
        self.calls.append(img.shape[:2])
        h, w = img.shape[:2]

        class R:
            pass

        r = R()
        if w > h:  # 横向き: 縦長の枠
            r.boxes = [box(10, 10 + 100 * i, 40, 100 + 100 * i) for i in range(4)]
            r.txts = ["読めない"] * 4
            r.scores = [0.6] * 4
        else:
            r.boxes = [box(10, 10 + 40 * i, 200, 40 + 40 * i) for i in range(4)]
            r.txts = ["合計 ¥1,280"] * 4
            r.scores = [0.98] * 4
        return r


def test_reads_again_after_turning_a_sideways_photo():
    ocr = FakeOcr()
    img = np.zeros((300, 800, 3), np.uint8)
    items, turned, angle = paddle.read(img, ocr)
    assert angle in (90, 270)
    assert turned.shape[:2] == (800, 300)
    assert items[0]["t"] == "合計 ¥1,280"
    assert len(ocr.calls) == 3


def test_drops_low_confidence_boxes():
    class R:
        boxes = [box(0, 0, 100, 20), box(0, 30, 100, 50)]
        txts = ["合計", "ﾛｺﾞ"]
        scores = [0.9, 0.2]

    assert [it["t"] for it in paddle._boxes(R())] == ["合計"]
