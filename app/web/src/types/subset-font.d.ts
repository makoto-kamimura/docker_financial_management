// subset-font（HarfBuzz でフォントを使う文字だけに減らす）の型。パッケージに型定義が無いので、使う形だけを書く。
declare module "subset-font" {
  export default function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: { targetFormat?: "sfnt" | "truetype" | "woff" | "woff2" },
  ): Promise<Buffer>;
}
