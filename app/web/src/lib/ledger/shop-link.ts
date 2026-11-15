// 明細分け（通販の注文）の請求と、カード・銀行の明細の紐付け（DB の読み書き）。判定は lib/ledger/shop-link-core.ts。
//
// 紐付けると、明細（親）は科目を外して amount 0 にし（実績に入らない）、請求の商品ごとに内訳の行
// （financial_records の kind の無い行。splitOfId = 親）を作る。内訳の行の科目・事業利用は商品のもの、
// 金額は商品の金額を明細の金額に合うよう割り振ったもの（allocateToTotal）。科目の無い商品の行は未割り当てとして数える。
// 内訳の行は商品から作り直す（syncChargeEntries）。正は商品の側に置く。
// 実績を確定済みの月の明細には、紐付けない・外さない・商品の科目を変えない。
import type { Prisma } from "@prisma/client";
import { badRequest, conflict, notFound } from "@/lib/server/api-error";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { assertActualsPeriodsEditable } from "@/lib/budget/budget-lock";
import { toYmd } from "@/lib/ledger/actuals-coverage";
import { classifyByRules, normalizeKeyword } from "@/lib/ledger/banktxn-import";
import { NOT_BUSINESS, ruleBusiness, type BusinessSetting } from "@/lib/ledger/business-use";
import { entryActualAmount, UNPAIRED } from "@/lib/ledger/ledger-entries";
import {
  allocateToTotal,
  LINK_DAYS_AFTER,
  LINK_DAYS_BEFORE,
  planAutoLinks,
  type LinkEntry,
} from "@/lib/ledger/shop-link-core";

type Tx = TenantDbClient;

/** 請求の日付（@db.Date は UTC の 0 時）を YYYY-MM-DD に */
export const chargeYmd = (d: Date) => d.toISOString().slice(0, 10);

/** 紐付けの相手になる明細の列（LinkEntry に直す） */
export const LINK_ENTRY_SELECT = {
  id: true,
  kind: true,
  bankAccountId: true,
  cardAccountId: true,
  date: true,
  flow: true,
  description: true,
} as const satisfies Prisma.FinancialRecordSelect;

export function toLinkEntry(r: {
  id: number;
  kind: string | null;
  bankAccountId: number | null;
  cardAccountId: number | null;
  date: Date | null;
  flow: unknown;
  description: string | null;
}): LinkEntry {
  return {
    id: r.id,
    kind: (r.kind ?? "CASH") as LinkEntry["kind"],
    sourceId: r.bankAccountId ?? r.cardAccountId ?? null,
    ymd: r.date ? toYmd(r.date) : "",
    flow: Number(r.flow ?? 0),
    description: r.description ?? "",
  };
}

/** 明細の科目を外し、実績から抜く列（紐付けた親・外した親） */
const PARENT_CLEAR = { accountId: null, amount: 0, ...NOT_BUSINESS } as const;

/**
 * 請求の内訳の行を、商品から作り直す。紐付いていなければ何もしない。
 * 親の明細は科目を外して amount 0 にする
 */
export async function syncChargeEntries(tx: Tx, chargeId: number): Promise<void> {
  const charge = await tx.shopCharge.findUnique({
    where: { id: chargeId },
    select: {
      tenantId: true,
      entry: { select: { id: true, periodId: true, date: true, flow: true } },
      items: {
        select: {
          name: true,
          quantity: true,
          amount: true,
          businessUse: true,
          businessRatio: true,
          categoryAccount: { select: { id: true, category: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!charge?.entry) return;
  const parent = charge.entry;
  const flow = Number(parent.flow ?? 0);
  const sign = flow < 0 ? -1 : 1;
  const parts = allocateToTotal(
    charge.items.map((i) => Number(i.amount)),
    Math.abs(flow),
  );

  await tx.financialRecord.deleteMany({ where: { splitOfId: parent.id } });
  if (charge.items.length > 0) {
    await tx.financialRecord.createMany({
      data: charge.items.map((item, i) => {
        const itemFlow = sign * parts[i];
        const category = item.categoryAccount;
        return {
          tenantId: charge.tenantId,
          periodId: parent.periodId,
          date: parent.date,
          description: item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name,
          flow: itemFlow,
          splitOfId: parent.id,
          accountId: category?.id ?? null,
          amount: category ? entryActualAmount(category.category, itemFlow) : 0,
          businessUse: item.businessUse,
          businessRatio: item.businessUse ? item.businessRatio : null,
        };
      }),
    });
  }
  await tx.financialRecord.update({ where: { id: parent.id }, data: PARENT_CLEAR });
}

/**
 * 請求を明細に紐付ける。明細は銀行・カードの出金で、振替・チャージの組でも、ほかの請求の紐付け先でもないこと
 * （現金の明細は画面で金額を直せるので紐付けない）。
 * 金額が違ってもよい（差は商品の金額の割合で割り振る）
 */
export async function linkCharge(
  tx: Tx,
  chargeId: number,
  entryId: number,
  linkedBy: "AUTO" | "MANUAL",
): Promise<void> {
  const charge = await tx.shopCharge.findUnique({
    where: { id: chargeId },
    select: { entryId: true },
  });
  if (!charge) throw notFound("注文が見つかりません");
  if (charge.entryId !== null) throw conflict("この注文はもう明細に紐付いています");
  const entry = await tx.financialRecord.findFirst({
    where: { id: entryId, kind: { in: ["BANK", "CARD"] } },
    select: {
      periodId: true,
      flow: true,
      transferGroupId: true,
      chargeToCardId: true,
      chargeGroupId: true,
      shopCharge: { select: { id: true } },
    },
  });
  if (!entry) throw notFound("明細が見つかりません");
  if (entry.shopCharge) throw conflict("この明細にはほかの注文が紐付いています");
  if (entry.transferGroupId || entry.chargeToCardId || entry.chargeGroupId) {
    throw badRequest("振替・チャージの明細には注文を紐付けられません");
  }
  if (Number(entry.flow ?? 0) >= 0) throw badRequest("出金の明細だけに注文を紐付けられます");
  await assertActualsPeriodsEditable(tx, [entry.periodId]);

  await tx.shopCharge.update({ where: { id: chargeId }, data: { entryId, linkedBy } });
  await syncChargeEntries(tx, chargeId);
}

/** 請求の紐付けを外す。明細は未割り当て（科目なし）に戻り、内訳の行は消える */
export async function unlinkCharge(tx: Tx, chargeId: number): Promise<number | null> {
  const charge = await tx.shopCharge.findUnique({
    where: { id: chargeId },
    select: { entry: { select: { id: true, periodId: true } } },
  });
  if (!charge) throw notFound("注文が見つかりません");
  if (!charge.entry) return null;
  await assertActualsPeriodsEditable(tx, [charge.entry.periodId]);
  await tx.financialRecord.deleteMany({ where: { splitOfId: charge.entry.id } });
  await tx.financialRecord.update({ where: { id: charge.entry.id }, data: PARENT_CLEAR });
  await tx.shopCharge.update({ where: { id: chargeId }, data: { entryId: null, linkedBy: null } });
  return charge.entry.id;
}

/**
 * 明細分けの注文に紐付いた明細があれば 400（科目を付ける・振替やチャージの組にする操作の前に呼ぶ）。
 * 紐付いた明細は商品ごとの行が実績になるので、明細そのものは操作しない
 */
export async function assertNotShopLinked(
  db: Pick<TenantDbClient, "shopCharge">,
  entryIds: number[],
  action: string,
): Promise<void> {
  const ids = entryIds.filter((id) => id > 0);
  if (ids.length === 0) return;
  const linked = await db.shopCharge.count({ where: { entryId: { in: ids } } });
  if (linked > 0) {
    throw badRequest(
      `明細分けの注文に紐付いた明細は${action}。商品の科目は明細分けの履歴で付けます（紐付けを外せば${action.replace(/ません$/, "ます")}）`,
    );
  }
}

/** 請求の明細の月を変えられるか（紐付いていなければ常に変えられる） */
export async function assertChargeEditable(tx: Tx, chargeId: number): Promise<void> {
  const charge = await tx.shopCharge.findUnique({
    where: { id: chargeId },
    select: { entry: { select: { periodId: true } } },
  });
  if (!charge) throw notFound("注文が見つかりません");
  if (charge.entry) await assertActualsPeriodsEditable(tx, [charge.entry.periodId]);
}

/**
 * まだ紐付いていない請求を、金額と日付が合い相手が 1 つに決まる明細に自動で紐付ける。紐付けた件数を返す。
 * 相手は銀行・カードの出金の明細で、振替・チャージ・ほかの請求の紐付け先でなく、実績を確定済みの月でないもの。
 * shopAccountIds を渡せば、その明細分けの請求だけを見る
 */
export async function autoLinkShopCharges(
  db: TenantDbClient & { $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> },
  opts: { shopAccountIds?: number[] } = {},
): Promise<number> {
  const charges = await db.shopCharge.findMany({
    where: {
      entryId: null,
      ...(opts.shopAccountIds ? { shopAccountId: { in: opts.shopAccountIds } } : {}),
    },
    select: { id: true, shopAccountId: true, date: true, amount: true },
  });
  if (charges.length === 0) return 0;
  const shops = await db.shopAccount.findMany({
    where: { id: { in: [...new Set(charges.map((c) => c.shopAccountId))] } },
    select: {
      id: true,
      type: true,
      matchKeywords: true,
      excludeKeywords: true,
      paymentCardIds: true,
      paymentBankIds: true,
    },
  });

  const times = charges.map((c) => c.date.getTime());
  const DAY = 86_400_000;
  // 時刻の扱いの違いで日がずれないよう前後 1 日広く読み、正確な日数は isAutoLinkable で見る
  const range = {
    gte: new Date(Math.min(...times) - (LINK_DAYS_BEFORE + 1) * DAY),
    lt: new Date(Math.max(...times) + (LINK_DAYS_AFTER + 2) * DAY),
  };
  const rows = await db.financialRecord.findMany({
    where: {
      kind: { in: ["BANK", "CARD"] },
      flow: { lt: 0 },
      date: range,
      ...UNPAIRED,
      period: { actualsConfirmation: { is: null } },
    },
    select: LINK_ENTRY_SELECT,
  });

  const plan = planAutoLinks(
    charges.map((c) => ({
      id: c.id,
      shopAccountId: c.shopAccountId,
      ymd: chargeYmd(c.date),
      amount: Number(c.amount),
    })),
    rows.map(toLinkEntry),
    shops,
  );
  for (const p of plan) {
    await db.$transaction((tx) => linkCharge(tx, p.chargeId, p.entryId, "AUTO"));
  }
  return plan.length;
}

// ── 商品名の学習ルール ─────────────────────────────────────────────

export type ShopItemCategory = {
  categoryAccountId: number;
  business: BusinessSetting | undefined;
};

/** 商品名の学習ルールを読み、商品名から科目と事業利用を決める関数を返す（当たらなければ null） */
export async function loadShopItemClassifier(db: TenantDbClient) {
  const rules = await db.shopItemRule.findMany({
    select: {
      keyword: true,
      categoryAccountId: true,
      priority: true,
      businessUse: true,
      businessRatio: true,
    },
  });
  return (name: string): ShopItemCategory | null => {
    const rule = classifyByRules(name, rules);
    return rule
      ? { categoryAccountId: rule.categoryAccountId, business: ruleBusiness(rule) }
      : null;
  };
}

/** 商品名のキーワードの長さの上限（長い商品名は先頭だけを覚える。画面で短く直せる） */
export const SHOP_RULE_KEYWORD_MAX = 60;

/**
 * 商品名と科目の組を学習ルールに覚える（手で付けた科目は優先度 100）。同じキーワードがあれば付け替える。
 * 事業利用は指定したときだけ覚える
 */
export async function learnShopItemRule(
  tx: Tx,
  tenantId: number,
  name: string,
  categoryAccountId: number,
  business: BusinessSetting | undefined,
): Promise<void> {
  const keyword = normalizeKeyword(name).slice(0, SHOP_RULE_KEYWORD_MAX).trim();
  if (keyword === "") return;
  await tx.shopItemRule.upsert({
    where: { tenantId_keyword: { tenantId, keyword } },
    update: { categoryAccountId, priority: 100, ...business },
    create: { tenantId, keyword, categoryAccountId, priority: 100, ...business },
  });
}
