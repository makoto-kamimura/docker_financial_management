// 銀行口座・カード（電子マネー）の明細を見る公式サイト。実績管理の CSV インポートの画面から開く。
//
// 口座・カードに URL（statementUrl）を登録していればそれを使い、無ければ金融機関名から下の表で既定を決める。
// 表の URL は各社のログイン入口（明細の画面はログインの後にたどる）。深いリンクは変わりやすいので持たない。

import { z } from "zod";

export type StatementLinkKind = "BANK" | "CARD";

export type StatementLink = {
  /** 開く URL。アプリでしか明細を見られないものは null */
  url: string | null;
  /** 表の既定なら公式サイトの名前、登録した URL なら null */
  siteName: string | null;
  /** 明細の落とし方の補足（アプリでしか見られないものなど） */
  note?: string;
};

type Preset = { keywords: string[]; siteName: string; url: string | null; note?: string };

// 上から順に当てる（「PayPayカード」を「PayPay」より先に置くなど、長い名前を先に）
const BANK_PRESETS: Preset[] = [
  {
    keywords: ["三菱ufj", "mufg", "三菱東京ufj"],
    siteName: "三菱UFJダイレクト",
    url: "https://direct.bk.mufg.jp/",
  },
  {
    keywords: ["三井住友銀行", "三井住友", "smbc"],
    siteName: "SMBCダイレクト",
    url: "https://direct.smbc.co.jp/aib/aibgsjsw5001.jsp",
  },
  {
    keywords: ["みずほ"],
    siteName: "みずほダイレクト",
    url: "https://web.ib.mizuhobank.co.jp/servlet/LOGBNK0000000B.do",
  },
  {
    keywords: ["ゆうちょ", "郵便貯金"],
    siteName: "ゆうちょダイレクト",
    url: "https://www.jp-bank.japanpost.jp/direct/pc/dr_pc_index.html",
  },
  {
    keywords: ["住信sbi", "sbiネット"],
    siteName: "住信SBIネット銀行",
    url: "https://www.netbk.co.jp/contents/pages/wpl010101/i010101CT/DI01010210",
  },
  {
    keywords: ["楽天銀行", "楽天"],
    siteName: "楽天銀行",
    url: "https://fes.rakuten-bank.co.jp/MS/main/RbS?CurrentPageID=START&&COMMAND=LOGIN",
  },
];

const CARD_PRESETS: Preset[] = [
  {
    keywords: ["三井住友カード", "三井住友", "smbcカード", "vpass"],
    siteName: "Vpass（三井住友カード）",
    url: "https://www.smbc-card.com/mem/index.jsp",
  },
  {
    keywords: ["楽天カード", "楽天"],
    siteName: "楽天e-NAVI",
    url: "https://www.rakuten-card.co.jp/e-navi/",
  },
  {
    keywords: ["paypay"],
    siteName: "PayPay",
    url: null,
    note: "PayPay アプリの「取引履歴」から CSV を書き出します（Web の明細ページはありません）。",
  },
];

/** 比べるための形（全角英数を半角に、空白を除き、小文字に） */
function normalizeName(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 金融機関名から既定の明細ページを探す。当たらなければ null */
export function presetStatementLink(
  kind: StatementLinkKind,
  institution: string,
): StatementLink | null {
  const name = normalizeName(institution);
  if (!name) return null;
  const preset = (kind === "BANK" ? BANK_PRESETS : CARD_PRESETS).find((p) =>
    p.keywords.some((k) => name.includes(normalizeName(k))),
  );
  if (!preset) return null;
  return {
    url: preset.url,
    siteName: preset.siteName,
    ...(preset.note ? { note: preset.note } : {}),
  };
}

/** 登録した URL があればそれ、無ければ金融機関名から既定。どちらも無ければ null */
export function statementLinkFor(
  kind: StatementLinkKind,
  account: { statementUrl?: string | null; institution: string },
): StatementLink | null {
  const url = account.statementUrl?.trim();
  if (url) return { url, siteName: null };
  return presetStatementLink(kind, account.institution);
}

/**
 * 口座・カードの API で受け取る URL（https だけ。空欄は登録を消す null）。省略は「変えない」の undefined のまま
 */
export const statementUrlInput = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((v) => v.startsWith("https://"), "https:// で始まる URL を入れてください"),
  ])
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));
