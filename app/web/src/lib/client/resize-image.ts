// 撮った写真を送る前に縮める（長辺 1600px の JPEG）。アップロードを軽くし、
// 読み取り（Claude）の課金のトークンも減らす。読み取りの精度はこの大きさで足りる。
// 写真の向き（EXIF）は createImageBitmap が直す。縮められない画像（ブラウザが開けない形式）は、そのまま返す。

export const RESIZE_MAX_EDGE = 1600;

export async function resizeImageToJpeg(
  file: File,
  maxEdge = RESIZE_MAX_EDGE,
  quality = 0.85,
): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) return file;
  return new File([blob], "receipt.jpg", { type: "image/jpeg" });
}
