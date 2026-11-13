// 撮影の画面。カメラの上に、レシート・書類を合わせる枠を重ねる（枠の外を暗くし、四隅に L 字を描く）。
// 枠は「レシート」（縦長）と「書類・領収書」（A4。病院・薬局の領収書や証明書）を切り替えられる。
// 撮った写真は切り取らない（サーバーが紙を見つけて切り抜く。余白があるほうが紙の縁を見つけやすい）。
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type GuideShape = "receipt" | "document";

export type CapturedPhoto = { uri: string; width: number; height: number };

// 枠の縦 / 横と、画面に対する大きさの上限（幅・高さの割合）
const GUIDES: Record<GuideShape, { ratio: number; maxW: number; maxH: number }> = {
  receipt: { ratio: 2.6, maxW: 0.62, maxH: 0.8 },
  document: { ratio: Math.SQRT2, maxW: 0.9, maxH: 0.78 },
};
const LABELS: Record<GuideShape, string> = { receipt: "レシート", document: "書類・領収書" };
const HINTS: Record<GuideShape, string> = {
  receipt: "レシートを枠に合わせて撮影",
  document: "書類を枠に合わせて撮影（横長の領収書は縦に置いても読めます）",
};

/** 枠の位置と大きさ（カメラの表示の大きさ w × h の中で、中央に置く） */
export function guideFrame(shape: GuideShape, w: number, h: number) {
  const g = GUIDES[shape];
  const fw = Math.min(w * g.maxW, (h * g.maxH) / g.ratio);
  const fh = fw * g.ratio;
  return { fw, fh, left: (w - fw) / 2, top: (h - fh) / 2 };
}

export function CameraCapture({
  visible,
  shape,
  shapes = [shape],
  onShapeChange,
  caption,
  note,
  onCaptured,
  onClose,
}: {
  visible: boolean;
  shape: GuideShape;
  /** シャッターの上に出す、撮った写真の行き先（例: 「11月13日（木）の仮の明細に保存」） */
  caption?: string;
  /** caption の下に小さく出す補足 */
  note?: string;
  /** 切り替えられる枠（1 つなら切り替えを出さない） */
  shapes?: GuideShape[];
  onShapeChange?: (shape: GuideShape) => void;
  onCaptured: (photo: CapturedPhoto) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // onCameraReady が来るまでシャッターを押せない（開くたびにカメラを作り直す）
  const [ready, setReady] = useState(false);
  const [shooting, setShooting] = useState(false);
  const shootingRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) {
      setReady(false);
      setError("");
      return;
    }
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible, permission, requestPermission]);

  async function capture() {
    // 連打は state の反映前に届くため ref で弾く
    if (!cameraRef.current || !ready || shootingRef.current) return;
    shootingRef.current = true;
    setShooting(true);
    setError("");
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo) onCaptured({ uri: photo.uri, width: photo.width, height: photo.height });
    } catch {
      if (cameraRef.current) setError("撮影できませんでした。もう一度シャッターを押してください");
    } finally {
      shootingRef.current = false;
      setShooting(false);
    }
  }

  const granted = permission?.granted ?? false;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={s.root}>
        <View style={[s.top, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="閉じる">
            <Text style={s.close}>閉じる</Text>
          </TouchableOpacity>
          {shapes.length > 1 ? (
            <View style={s.shapes}>
              {shapes.map((sh) => (
                <TouchableOpacity
                  key={sh}
                  onPress={() => onShapeChange?.(sh)}
                  style={[s.shape, sh === shape && s.shapeOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sh === shape }}
                >
                  <Text style={[s.shapeText, sh === shape && s.shapeTextOn]}>{LABELS[sh]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <View style={{ width: 48 }} />
        </View>

        <View style={s.camera}>
          {visible && granted ? (
            <>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                onCameraReady={() => setReady(true)}
              />
              <Guide shape={shape} />
            </>
          ) : (
            <View style={s.perm}>
              {permission === null ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={s.permText}>カメラを使う許可がありません。</Text>
                  {permission.canAskAgain ? (
                    <TouchableOpacity style={s.permBtn} onPress={() => void requestPermission()}>
                      <Text style={s.permBtnText}>許可する</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={s.permBtn} onPress={() => void Linking.openSettings()}>
                      <Text style={s.permBtnText}>端末の設定を開く</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}
        </View>

        <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {caption ? (
            <View style={s.captionWrap}>
              <Text style={s.caption}>{caption}</Text>
              {note ? <Text style={s.captionNote}>{note}</Text> : null}
            </View>
          ) : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[s.shutter, (!ready || shooting) && { opacity: 0.5 }]}
            onPress={capture}
            disabled={!granted || !ready || shooting}
            accessibilityLabel="シャッター"
          >
            <View style={s.shutterInner}>
              {shooting ? <ActivityIndicator color="#1e293b" /> : null}
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const CORNER = 28;
const THICK = 4;

/** 枠の外を暗くし、枠の四隅に L 字を描く */
function Guide({ shape }: { shape: GuideShape }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };
  const f = size ? guideFrame(shape, size.w, size.h) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {f && (
        <>
          <View style={[s.dim, { top: 0, left: 0, right: 0, height: f.top }]} />
          <View style={[s.dim, { top: f.top + f.fh, left: 0, right: 0, bottom: 0 }]} />
          <View style={[s.dim, { top: f.top, left: 0, width: f.left, height: f.fh }]} />
          <View style={[s.dim, { top: f.top, right: 0, width: f.left, height: f.fh }]} />
          <View style={[s.frame, { top: f.top, left: f.left, width: f.fw, height: f.fh }]}>
            <View style={[s.corner, s.tl]} />
            <View style={[s.corner, s.tr]} />
            <View style={[s.corner, s.bl]} />
            <View style={[s.corner, s.br]} />
          </View>
          <View style={[s.hintWrap, { top: Math.max(f.top - 36, 6) }]}>
            <Text style={s.hint}>{HINTS[shape]}</Text>
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  top: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  close: { color: "#fff", fontSize: 15, fontWeight: "600", width: 48 },
  shapes: { flex: 1, flexDirection: "row", justifyContent: "center", gap: 8 },
  shape: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  shapeOn: { backgroundColor: "#fff" },
  shapeText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  shapeTextOn: { color: "#1e293b" },
  camera: { flex: 1, overflow: "hidden" },
  perm: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  permText: { color: "#fff", fontSize: 14 },
  permBtn: {
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  permBtnText: { color: "#1e293b", fontWeight: "700" },
  bottom: { alignItems: "center", paddingTop: 16, gap: 10 },
  captionWrap: { alignItems: "center", paddingHorizontal: 16, gap: 2 },
  caption: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center" },
  captionNote: { color: "rgba(255,255,255,0.7)", fontSize: 11, textAlign: "center" },
  error: { color: "#fca5a5", fontSize: 13 },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.4)" },
  frame: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.55)",
  },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: "#fff" },
  tl: {
    top: -THICK / 2,
    left: -THICK / 2,
    borderTopWidth: THICK,
    borderLeftWidth: THICK,
    borderTopLeftRadius: 6,
  },
  tr: {
    top: -THICK / 2,
    right: -THICK / 2,
    borderTopWidth: THICK,
    borderRightWidth: THICK,
    borderTopRightRadius: 6,
  },
  bl: {
    bottom: -THICK / 2,
    left: -THICK / 2,
    borderBottomWidth: THICK,
    borderLeftWidth: THICK,
    borderBottomLeftRadius: 6,
  },
  br: {
    bottom: -THICK / 2,
    right: -THICK / 2,
    borderBottomWidth: THICK,
    borderRightWidth: THICK,
    borderBottomRightRadius: 6,
  },
  hintWrap: { position: "absolute", left: 12, right: 12, alignItems: "center" },
  hint: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
});
