// レシートの読み取り（有料プラン）。Claude に画像を渡し、構造化出力で下書きを受け取る。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  ReceiptDraftSchema,
  ReceiptScanError,
  normalizeDraft,
  type ScanResult,
} from "@/lib/ledger/receipt-scan/types";

export const DEFAULT_RECEIPT_MODEL = "claude-opus-5-5";

export type ClaudeImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SYSTEM_PROMPT = `あなたは家計簿アプリの入力補助です。渡されたレシート・領収書の画像から、家計簿に記録する内容を読み取ります。

- 日付はレシートに印字された日付を YYYY-MM-DD で返します。和暦（令和など）は西暦に直します。
- 店名は家計簿の摘要に使います。チェーン名・店名だけにし、支店名・住所・電話番号・登録番号は含めません。
- 合計は実際に支払った税込の金額です。小計・お預り・お釣り・ポイント残高とは区別します。
- 支払方法は、現金・クレジットカード・電子マネーや QR コード決済のどれかを、印字から判断します。分からなければ unknown にします。
- ドラッグストアなどのレシートでは、セルフメディケーション税制の対象品に ★・◆ などの印が付き、「★印はセルフメディケーション税制対象商品」のような注記があります。注記で対象と分かる印の付いた品目は selfMedication を true にし、それ以外は false にします。「セルフメディケーション対象額」などの印字があれば、その金額を selfMedicationTotal に入れます。
- 読めない項目は推測せず null にします。画像がレシートや領収書でなければ、すべて null・空にします。`;

/** Claude でレシートを読み取る。読み取れなければ ReceiptScanError */
export async function scanWithClaude(
  image: Buffer,
  mediaType: ClaudeImageType,
  opts: { apiKey: string; model: string; baseURL?: string },
): Promise<ScanResult> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    timeout: 60_000,
    maxRetries: 1,
  });

  let message;
  try {
    message = await client.beta.messages.parse({
      model: opts.model,
      max_tokens: 16000,
      // 安全のための判定で断られたときは、サーバー側で別のモデルに切り替えて読み直す
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 書かれていることを写すだけの作業なので、考える量は少なくてよい
      output_config: { effort: "low", format: betaZodOutputFormat(ReceiptDraftSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image.toString("base64") },
            },
            { type: "text", text: "このレシートを読み取ってください。" },
          ],
        },
      ],
    });
  } catch (e) {
    throw claudeFailed(e);
  }

  if (message.stop_reason === "refusal" || !message.parsed_output) {
    throw new ReceiptScanError("レシートを読み取れませんでした。撮り直してみてください");
  }
  return {
    draft: normalizeDraft(message.parsed_output),
    usage: {
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

function claudeFailed(e: unknown): ReceiptScanError {
  if (e instanceof Anthropic.BadRequestError) {
    // 画像が大きすぎる・壊れているなど
    return new ReceiptScanError("この画像は読み取れません。撮り直してみてください");
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error("[receipt-scan] claude credentials rejected:", e.message);
    return new ReceiptScanError("読み取りの設定に問題があります。管理者に連絡してください", 503);
  }
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) {
    return new ReceiptScanError("読み取りが混み合っています。少し待ってからお試しください", 503);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ReceiptScanError(
      "読み取りのサービスに接続できません。少し待ってからお試しください",
      503,
    );
  }
  console.error("[receipt-scan] claude request failed:", e);
  return new ReceiptScanError("レシートを読み取れませんでした。少し待ってからお試しください", 503);
}
