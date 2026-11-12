"""読み取りの精度を測るための、合成のレシート写真と正解を作る。

    python scripts/receipt_eval.py synth --out /work/samples --n 40 --fonts A.ttf B.ttf

感熱紙のレシート（店名・日付・品目・小計・税・合計・支払方法・セルフメディケーションの印）か、
`--kind medical` で病院・薬局の領収書（点数の表・領収金額・下のほうの医療機関名と印）を描き、
机に置いたレシートをスマホで撮ったように加工する（傾き・台形のゆがみ・紙のうねり・影・周辺減光・
感熱紙のかすれ・ぼけ・ノイズ・JPEG）。易しい 12MP と難しい 7MP を交互に作る。

1 枚ごとに NN_xxx.jpg（カメラで撮ったままの大きさ）と NN_xxx.json（正解）を書く。正解は
date・merchant・total・paymentMethod・selfMedicationTotal・text（印字した行）。
評価（読み取り → 解析まで本番と同じ処理）は web の scripts/receipt-eval.ts で行う。
実物の写真も、同じ形の xxx.json を横に置けば一緒に測れる。手順は docs/runbooks/receipt-ocr.md。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DOT = 2  # 感熱プリンタ（203dpi）の 1 ドットを 2px で描く
FONT_DOTS = 24  # 全角 24 ドット
WEEKDAYS = "月火水木金土日"

STORES = [
    ("スーパーみどり屋", "super"),
    ("フレッシュマート青葉", "super"),
    ("ドラッグひまわり", "drug"),
    ("くすりの森田", "drug"),
    ("ベーカリー麦の穂", "bakery"),
    ("カフェ ソレイユ", "cafe"),
    ("ホームセンター ツルマキ", "home"),
    ("コンビニ サンライズ", "conv"),
    ("書店 青葉堂", "book"),
    ("青空食堂", "restaurant"),
]
BRANCHES = ["中央店", "駅前店", "本町店", "北口店", "みなと店", "若葉台店"]
# (品名, 単価, 軽減税率 8% か, セルフメディケーションの対象か)
ITEMS: dict[str, list[tuple[str, int, bool, bool]]] = {
    "super": [("国産たまご10個", 248, True, False), ("牛乳 1000ml", 218, True, False),
              ("食パン 6枚切", 158, True, False), ("バナナ", 198, True, False),
              ("鶏むね肉", 386, True, False), ("キャベツ", 158, True, False),
              ("絹ごし豆腐 3P", 98, True, False), ("納豆 3P", 88, True, False),
              ("にんじん", 128, True, False), ("ヨーグルト", 138, True, False),
              ("こいくち醤油 1L", 298, True, False), ("台所用洗剤", 218, False, False),
              ("ゴミ袋 45L", 248, False, False)],
    "drug": [("ティッシュ 5箱", 328, False, False), ("ハンドソープ詰替", 258, False, False),
             ("歯みがき粉", 198, False, False), ("目薬クール", 698, False, True),
             ("かぜ薬 24錠", 1280, False, True), ("胃腸薬 顆粒", 980, False, True),
             ("温感シップ 20枚", 798, False, True), ("マスク 30枚", 498, False, False),
             ("のど飴", 158, True, False), ("スポーツドリンク", 138, True, False)],
    "bakery": [("クロワッサン", 220, True, False), ("メロンパン", 180, True, False),
               ("カレーパン", 240, True, False), ("バゲット", 320, True, False),
               ("あんぱん", 160, True, False), ("ベーコンエピ", 260, True, False)],
    "cafe": [("ブレンドコーヒー", 450, False, False), ("カフェラテ", 520, False, False),
             ("チーズケーキ", 480, False, False), ("ホットサンド", 650, False, False),
             ("アイスティー", 450, False, False)],
    "home": [("ビス 50本入", 298, False, False), ("養生テープ", 248, False, False),
             ("電池 単3 4本", 398, False, False), ("収納ボックス", 1280, False, False),
             ("軍手 5双", 328, False, False), ("延長コード 2m", 880, False, False),
             ("園芸用土 5L", 498, False, False)],
    "conv": [("おにぎり 鮭", 160, True, False), ("緑茶 500ml", 140, True, False),
             ("サンドイッチ", 320, True, False), ("ボールペン", 165, False, False),
             ("チョコレート", 128, True, False), ("ホットコーヒー", 120, True, False)],
    "book": [("文庫本", 880, False, False), ("月刊誌", 990, False, False),
             ("ノート B5", 198, False, False), ("ブックカバー", 330, False, False)],
    "restaurant": [("日替わり定食", 980, False, False), ("ラーメン", 850, False, False),
                   ("餃子", 380, False, False), ("ライス大", 200, False, False),
                   ("生ビール", 580, False, False)],
}
TOTAL_LABELS = ["合計", "合 計", "お買上計", "お会計", "ご請求額"]
EMONEY = ["交通系IC", "PayPay", "nanaco", "iD", "WAON", "楽天Edy"]
CARDS = ["VISA", "JCB", "MasterCard"]


def _font(path: str, px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, px)


def _yen(n: int) -> str:
    return f"¥{n:,}"


def _date_text(d: dt.datetime, style: int) -> str:
    wd = WEEKDAYS[d.weekday()]
    hm = f"{d.hour:02d}:{d.minute:02d}"
    if style == 0:
        return f"{d.year}年{d.month}月{d.day}日({wd}) {hm}"
    if style == 1:
        return f"{d.year}/{d.month:02d}/{d.day:02d}({wd}) {hm}"
    if style == 2:
        return f"{d.year}-{d.month:02d}-{d.day:02d} {hm}"
    if style == 3:
        return f"{d.year % 100:02d}/{d.month:02d}/{d.day:02d} {hm}"
    return f"令和{d.year - 2018}年{d.month:02d}月{d.day:02d}日 {hm}"


def make_receipt(rng: random.Random) -> dict:
    """印字する行と正解を作る。行は (種類, 左, 右, 大きさ) の並び。"""
    store, kind = rng.choice(STORES)
    branch = rng.choice(BRANCHES)
    day = dt.datetime(2025, 1, 1) + dt.timedelta(days=rng.randint(0, 680),
                                                 minutes=rng.randint(8 * 60, 21 * 60))
    rows: list[tuple[str, str, str, int]] = []
    add = lambda kind_, left, right="", size=1: rows.append((kind_, left, right, size))  # noqa: E731

    if rng.random() < 0.3:
        add("center", "領 収 証", "", 2)
    add("center", store, "", 2)
    add("center", branch)
    add("center", f"東京都みどり区青葉{rng.randint(1, 9)}-{rng.randint(1, 30)}-{rng.randint(1, 20)}")
    add("center", f"TEL 03-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}")
    if rng.random() < 0.7:
        add("center", f"登録番号 T{rng.randint(10**12, 10**13 - 1)}")
    add("blank", "")
    add("lr", _date_text(day, rng.randint(0, 4)), f"レジ{rng.randint(1, 12):04d}")
    add("left", f"責No.{rng.randint(100, 999)}")
    add("blank", "")

    pool = ITEMS[kind]
    # 4 枚に 1 枚は品目の多い長いレシート（写真の中で細長くなり、文字が小さく写る）
    n_items = rng.randint(10, 18) if rng.random() < 0.25 else rng.randint(2, 9)
    picked = [rng.choice(pool) for _ in range(n_items)]
    selfmed_marks = kind == "drug" and any(p[3] for p in picked) and rng.random() < 0.8
    total8 = total10 = 0
    selfmed_total = 0
    count = 0
    for name, price, reduced, selfmed in picked:
        qty = 2 if rng.random() < 0.15 else 1
        amount = price * qty
        mark = ("★" if selfmed and selfmed_marks else "") + name + ("※" if reduced else "")
        add("lr", mark, _yen(amount))
        if qty > 1:
            add("left", f"  {qty}コ X 単{price}")
        if rng.random() < 0.08:
            disc = rng.choice([20, 30, 50])
            add("lr", "  値引", f"-{disc}")
            amount -= disc
        count += qty
        if reduced:
            total8 += amount
        else:
            total10 += amount
        if selfmed:
            selfmed_total += amount
    total = total8 + total10
    add("rule", "")
    add("lr", f"小計 ({count}点)", _yen(total))
    if total8:
        add("lr", "(8%対象", _yen(total8) + ")")
        add("lr", "(内消費税等", _yen(total8 * 8 // 108) + ")")
    if total10:
        add("lr", "(10%対象", _yen(total10) + ")")
        add("lr", "(内消費税等", _yen(total10 * 10 // 110) + ")")
    add("lr", rng.choice(TOTAL_LABELS), _yen(total), 2)

    r = rng.random()
    if r < 0.45:
        method = "cash"
        paid = next(v for v in (1000, 2000, 3000, 5000, 10000, 20000) if v >= total)
        if rng.random() < 0.3:
            paid = total + rng.choice([0, 3, 10, 100])
        add("lr", "お預り", _yen(paid))
        add("lr", "お釣り", _yen(paid - total))
    elif r < 0.75:
        method = "card"
        add("lr", "クレジット", _yen(total))
        add("left", f"{rng.choice(CARDS)} ************{rng.randint(1000, 9999)}")
        add("left", "お支払回数 1回")
    else:
        method = "emoney"
        name = rng.choice(EMONEY)
        add("lr", f"{name}支払", _yen(total))
        if name in ("交通系IC", "nanaco", "WAON", "楽天Edy"):
            add("lr", "残高", _yen(rng.randint(100, 9000)))
    if rng.random() < 0.4:
        add("left", f"ポイントカード 今回{total // 100}P 累計{rng.randint(200, 3000)}P")

    has_selfmed_total = selfmed_marks and rng.random() < 0.7
    if selfmed_marks:
        add("blank", "")
        add("left", "★印はセルフメディケーション")
        add("left", "税制対象商品です")
        if has_selfmed_total:
            add("lr", "セルフメディケーション対象額", _yen(selfmed_total))
    add("blank", "")
    add("center", rng.choice(["毎度ありがとうございます", "またのご来店をお待ちしております"]))

    text = []
    for kind_, left, right, _ in rows:
        if kind_ in ("blank", "rule"):
            continue
        text.append(f"{left} {right}".strip())
    return {
        "rows": rows,
        "truth": {
            "date": day.strftime("%Y-%m-%d"),
            "merchant": store,
            "total": total,
            "paymentMethod": method,
            "selfMedicationTotal": selfmed_total if has_selfmed_total else None,
            "text": "\n".join(text),
        },
    }


def render(rows: list, font_path: str, narrow: bool, ink: int) -> Image.Image:
    """感熱紙に印字したレシートの画像（グレー）。"""
    print_dots = 384 if narrow else 576  # 58mm / 80mm 幅の紙
    margin = 32 * DOT
    width = print_dots * DOT + 2 * margin
    px = FONT_DOTS * DOT
    line_h = int(px * 1.3)
    height = margin * 2 + sum(line_h * (r[3] if r[0] != "rule" else 1) for r in rows)
    page = Image.new("L", (width, height), 245)
    d = ImageDraw.Draw(page)
    fonts = {1: _font(font_path, px), 2: _font(font_path, px * 2)}
    y = margin
    right_edge = width - margin
    for kind, left, right, size in rows:
        f = fonts[size]
        if kind == "center":
            # 紙の幅に収まらない大きい字は、収まるまで横を詰める（感熱プリンタは倍角をやめて印字する）
            cf = f
            while d.textlength(left, font=cf) > right_edge - margin and cf.size > px:
                cf = _font(font_path, int(cf.size * 0.9))
            w = d.textlength(left, font=cf)
            d.text(((width - w) / 2, y + (f.size - cf.size) / 2), left, font=cf, fill=ink)
        elif kind == "left":
            d.text((margin, y), left, font=f, fill=ink)
        elif kind == "lr":
            # 長い品名は金額にかからないよう、左の文字を小さくする（実物は 2 行に分けることが多い）
            rw = d.textlength(right, font=f)
            lf = f
            while d.textlength(left, font=lf) > right_edge - margin - rw - px and lf.size > px * 0.6:
                lf = _font(font_path, int(lf.size * 0.9))
            d.text((margin, y + (f.size - lf.size)), left, font=lf, fill=ink)
            d.text((right_edge - rw, y), right, font=f, fill=ink)
        elif kind == "rule":
            dash = px // 2
            for x in range(margin, right_edge, dash * 2):
                d.line([(x, y + line_h // 2), (x + dash, y + line_h // 2)], fill=ink, width=DOT)
        y += line_h * (size if kind != "rule" else 1)
    return page


def _background(w: int, h: int, rng: random.Random) -> np.ndarray:
    palette = [(70, 50, 35), (95, 70, 50), (120, 120, 118), (55, 60, 85), (150, 140, 120),
               (190, 180, 160), (215, 212, 205)]
    weights = [3, 3, 2, 2, 2, 1, 1]
    base = np.array(rng.choices(palette, weights)[0][::-1], np.float32)  # BGR
    bg = np.empty((h, w, 3), np.float32)
    bg[:] = base
    # 木目のような筋と、細かいノイズ
    yy = np.arange(h, dtype=np.float32)[:, None]
    stripes = 6 * np.sin(yy / rng.uniform(20, 60) + rng.uniform(0, 6)) * rng.random()
    bg += stripes[..., None]
    bg += np.random.default_rng(rng.randint(0, 10**6)).normal(0, 6, bg.shape).astype(np.float32)
    return bg


def photo(page: Image.Image, rng: random.Random, hard: bool,
          fill_range: tuple[float, float] | None = None) -> bytes:
    """机に置いたレシートをスマホで撮ったような写真にする。"""
    W, H = (2268, 3024) if hard else (3024, 4032)
    paper = np.array(page.convert("RGB"), np.float32)[..., ::-1].copy()
    ph, pw = paper.shape[:2]

    # 紙のうねり（横方向に少し波打つ）
    amp = rng.uniform(0, 0.006 if hard else 0.003) * pw
    ys, xs = np.mgrid[0:ph, 0:pw].astype(np.float32)
    map_x = xs + amp * np.sin(ys / ph * 2 * math.pi * rng.uniform(1, 3) + rng.uniform(0, 6))
    paper = cv2.remap(paper, map_x, ys, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    # 写真の中でのレシートの大きさ（高さの割合）と位置
    if fill_range:
        fill = rng.uniform(*fill_range)
    else:
        fill = rng.uniform(0.55, 0.78) if hard else rng.uniform(0.72, 0.9)
    th = H * fill
    tw = th * pw / ph
    if tw > W * 0.88:
        tw = W * 0.88
        th = tw * ph / pw
    cx = W / 2 + rng.uniform(-0.05, 0.05) * W
    cy = H / 2 + rng.uniform(-0.04, 0.04) * H
    ang = math.radians(rng.uniform(-6, 6) if hard else rng.uniform(-2.5, 2.5))
    corners = np.array([[-tw / 2, -th / 2], [tw / 2, -th / 2], [tw / 2, th / 2], [-tw / 2, th / 2]])
    rot = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
    j = (0.03 if hard else 0.015) * min(W, H)
    dst = np.float32([(rot @ c) + (cx, cy) + (rng.uniform(-j, j), rng.uniform(-j, j))
                      for c in corners])
    src = np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    m = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(paper, m, (W, H), flags=cv2.INTER_AREA)
    mask = cv2.warpPerspective(np.ones((ph, pw), np.float32), m, (W, H))
    img = _background(W, H, rng) * (1 - mask[..., None]) + warped * mask[..., None]

    # 片側からの影と周辺減光
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    a = rng.uniform(0, 2 * math.pi)
    ramp = (math.cos(a) * (xx / W - 0.5) + math.sin(a) * (yy / H - 0.5)) + 0.5
    low = rng.uniform(0.55, 0.72) if hard else rng.uniform(0.78, 0.9)
    light = low + (1 - low) * np.clip(ramp, 0, 1)
    vignette = 1 - 0.2 * (((xx / W - 0.5) ** 2 + (yy / H - 0.5) ** 2) * 2)
    img *= (light * vignette)[..., None]
    img *= np.array([0.96, 0.99, 1.02], np.float32)  # 少し暖色の照明（BGR）

    sigma = rng.uniform(1.2, 2.0) if hard else rng.uniform(0.6, 1.1)
    img = cv2.GaussianBlur(img, (0, 0), sigma)
    img += np.random.default_rng(rng.randint(0, 10**6)).normal(0, 5 if hard else 3, img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return buf.tobytes()


# ---------------------------------------------------------------- 医療の領収書（病院・診療所・歯科・薬局）

# (法人名, 医療機関名, 種類)。正解の店名は医療機関名（法人名は付いていてもよい）
CLINICS = [
    ("医療法人社団 青葉会", "みどりクリニック", "clinic"),
    ("", "さくら内科医院", "clinic"),
    ("", "ひかり整形外科", "clinic"),
    ("医療法人 若葉会", "わかば歯科クリニック", "clinic"),
    ("", "市立みなと病院", "hospital"),
    ("", "こもれび皮膚科", "clinic"),
    ("", "あすなろ眼科", "clinic"),
    ("", "あおば薬局", "pharmacy"),
    ("株式会社なのはな", "なのはな調剤薬局", "pharmacy"),
]
MEDICAL_ITEMS = ["初・再診料", "医学管理等", "在宅医療", "検査", "画像診断", "投薬", "注射",
                 "リハビリテーション", "精神科専門療法", "処置", "手術", "麻酔", "放射線治療",
                 "病理診断", "入院料等"]
PHARMACY_ITEMS = ["調剤技術料", "薬学管理料", "薬剤料", "特定保険医療材料料"]
PATIENTS = ["山田 太郎", "佐藤 花子", "鈴木 一郎", "高橋 陽子", "田中 健"]
PAID_LABELS = ["領収金額", "領収額", "今回領収額", "お支払額"]
# 用紙の色（白が多い。医療の領収書は色の付いた用紙に印刷されることがある）と、枠の線の色（RGB）
PAPERS = [((250, 250, 248), (90, 90, 90)), ((252, 238, 242), (200, 120, 150)),
          ((238, 248, 238), (110, 170, 120)), ((238, 244, 252), (110, 140, 200)),
          ((252, 250, 232), (170, 150, 80))]


def _wareki(d: dt.date, style: int) -> str:
    if style == 0:
        return f"令和{d.year - 2018}年{d.month}月{d.day}日"
    if style == 1:
        return f"令和 {d.year - 2018}年 {d.month:2d}月 {d.day:2d}日"
    if style == 2:
        return f"{d.year}年{d.month}月{d.day}日"
    return f"{d.year}/{d.month:02d}/{d.day:02d}"


def render_medical(rng: random.Random, font_path: str) -> tuple[Image.Image, dict]:
    """医療の領収書（厚生労働省の標準様式に近い、点数の表のある領収証）を描く。"""
    corp, name, kind = rng.choice(CLINICS)
    pharmacy = kind == "pharmacy"
    branch = rng.choice(["", "", " 中央店", " 駅前店"]) if pharmacy else ""
    landscape = not pharmacy and rng.random() < 0.6
    W, H = (2100, 1480) if landscape else (1480, 2100)  # A5 を 10px/mm で
    paper, line = rng.choice(PAPERS) if rng.random() < 0.5 else PAPERS[0]
    page = Image.new("RGB", (W, H), paper)
    d = ImageDraw.Draw(page)
    ink = (30, 30, 35)
    f = {k: _font(font_path, v) for k, v in {"title": 64, "big": 44, "body": 30, "small": 26}.items()}
    texts: list[str] = []

    def text(x, y, s, size="body", anchor="la", fill=ink):
        d.text((x, y), s, font=f[size], fill=fill, anchor=anchor)
        texts.append(s)

    def cell(x, y, w, h, label=None, value=None):
        d.rectangle([x, y, x + w, y + h], outline=line, width=3)
        if label:
            d.text((x + w / 2, y + h * 0.3), label, font=f["small"], fill=ink, anchor="mm")
            texts.append(label)
        if value:
            d.text((x + w - 14, y + h * 0.75), value, font=f["body"], fill=ink, anchor="rm")
            texts.append(value)

    day = dt.date(2025, 1, 1) + dt.timedelta(days=rng.randint(0, 680))
    style = rng.choice([0, 0, 1, 2, 3])
    m = 70
    text(W / 2, 50, "領 収 証", "title", "ma")
    y = 150
    text(m, y, f"患者番号 {rng.randint(10000, 99999999):08d}", "small")
    text(W / 2 - 80 if landscape else m, y + (0 if landscape else 50),
         f"氏名 {rng.choice(PATIENTS)} 様", "body")
    y += 60 if landscape else 110
    if rng.random() < 0.4:  # 生年月日（昭和・平成。読み取りの日付と取り違えないこと）
        text(m, y, f"生年月日 {rng.choice(['昭和', '平成'])}{rng.randint(30, 63)}年{rng.randint(1, 12)}月{rng.randint(1, 28)}日", "small")
        y += 46
    text(m, y, f"{'調剤日' if pharmacy else '受診日'} {_wareki(day, style)}", "body")
    text(W - m, y, f"負担割合 {rng.choice(['3割', '2割', '1割'])}", "body", "ra")
    y += 70

    items = PHARMACY_ITEMS if pharmacy else MEDICAL_ITEMS[: 9 if landscape else 6]
    cols = len(items) if pharmacy else (len(items) if landscape else 3)
    cw = (W - 2 * m) / cols
    ch = 110
    points = 0
    for i, label in enumerate(items):
        r, c = divmod(i, cols)
        pts = rng.choice([0, 0, rng.randint(12, 400)]) if i else rng.randint(70, 300)
        points += pts
        cell(m + c * cw, y + r * ch, cw, ch, label, f"{pts}点" if pts else None)
    y += ch * (math.ceil(len(items) / cols)) + 40

    burden = round(points * 10 * rng.choice([0.3, 0.3, 0.2, 0.1]), -1)
    extra = rng.choice([0, 0, 0, 1100, 550])  # 保険外（文書料・容器代など）
    paid = int(burden + extra)
    sw = (W - 2 * m) / 4
    cell(m, y, sw, ch, "保険", None)
    cell(m + sw, y, sw, ch, "合計" if pharmacy else "合計点数", f"{points}点")
    cell(m + 2 * sw, y, sw, ch, "負担額", f"{int(burden):,}円")
    cell(m + 3 * sw, y, sw, ch, "保険外負担", f"{extra:,}円")
    y += ch + 20
    paid_label = rng.choice(PAID_LABELS)
    d.rectangle([W - m - 2 * sw, y, W - m, y + ch], outline=line, width=5)
    text(W - m - 2 * sw + 24, y + ch / 2, paid_label, "big", "lm")
    text(W - m - 24, y + ch / 2, f"{paid:,}円", "big", "rm")
    y += ch + 40
    if rng.random() < 0.4:  # 次回の予約（領収の日付ではない）
        later = day + dt.timedelta(days=rng.randint(7, 60))
        text(m, y, f"次回予約 {_wareki(later, style)} 10:30", "small")
    text(W - m, y, f"発行日 {_wareki(day, style)}", "small", "ra")
    y += 70

    # 医療機関名・住所・電話（下のほう）と、赤い印
    facility = (f"{corp} " if corp else "") + name + branch
    fx = W - m - (900 if landscape else 1000)
    text(fx, y, facility, "big")
    text(fx, y + 60, f"東京都みどり区青葉{rng.randint(1, 9)}-{rng.randint(1, 30)}-{rng.randint(1, 20)}", "small")
    text(fx, y + 100, f"TEL 03-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}", "small")
    sx, sy, r = W - m - 90, y + 40, 70
    stamp = Image.new("RGBA", page.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(stamp)
    sd.rectangle([sx - r, sy - r, sx + r, sy + r], outline=(210, 40, 40, 170), width=6)
    sd.text((sx, sy), name[:2] + "\n" + name[2:4], font=f["body"], fill=(210, 40, 40, 170),
            anchor="mm", align="center")
    page = Image.alpha_composite(page.convert("RGBA"), stamp).convert("RGB")

    truth = {
        "date": day.strftime("%Y-%m-%d"),
        "merchant": name,
        "total": paid,
        "paymentMethod": "unknown",
        "selfMedicationTotal": None,
        "text": "\n".join(texts),
    }
    return page, truth


def synth(out: Path, n: int, seed: int, fonts: list[str],
          fill_range: tuple[float, float] | None = None, kind: str = "receipt") -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    for k in range(n):
        hard = k % 2 == 1
        font = fonts[k % len(fonts)]
        if kind == "medical":
            page, truth = render_medical(rng, font)
            # 横長の用紙は、4 枚に 1 枚を縦に置いて撮る（枠に合わせて回す人がいる）
            if page.width > page.height and rng.random() < 0.25:
                page = page.rotate(90, expand=True)
            name = f"{k:02d}_{'hard' if hard else 'easy'}_med_{Path(font).stem}"
        else:
            r = make_receipt(rng)
            narrow = rng.random() < 0.4
            ink = rng.randint(60, 110) if hard and rng.random() < 0.6 else rng.randint(20, 45)
            page = render(r["rows"], font, narrow, ink)
            truth = r["truth"]
            name = f"{k:02d}_{'hard' if hard else 'easy'}_{'58' if narrow else '80'}_{Path(font).stem}"
        (out / f"{name}.jpg").write_bytes(photo(page, rng, hard, fill_range))
        (out / f"{name}.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1),
                                          encoding="utf-8")
        print("made", name)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("synth")
    s.add_argument("--out", required=True)
    s.add_argument("--n", type=int, default=40)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--fonts", nargs="+", required=True, help="日本語のフォント（.ttf / .otf）")
    s.add_argument("--fill", nargs=2, type=float, metavar=("MIN", "MAX"),
                   help="写真の高さに対するレシートの高さ（例: 0.4 0.55 で遠くから撮った写真）")
    s.add_argument("--kind", choices=["receipt", "medical"], default="receipt",
                   help="receipt: 感熱紙のレシート / medical: 病院・薬局の領収書（点数の表のある様式）")
    args = ap.parse_args()
    synth(Path(args.out), args.n, args.seed, args.fonts, tuple(args.fill) if args.fill else None,
          args.kind)


if __name__ == "__main__":
    main()
