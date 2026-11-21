import type { MetadataRoute } from "next";

/** ホーム画面に追加したときの名前とアイコン */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "カケイカイケイ",
    short_name: "カケイカイケイ",
    description: "家計簿から、決算書まで。ひとつの帳簿で。",
    lang: "ja",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#312e81",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
