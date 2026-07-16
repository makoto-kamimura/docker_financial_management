import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { TOPIC_KEYS } from "@/lib/learning-content";

const BodySchema = z.object({ topicKey: z.enum(TOPIC_KEYS) });

// POST /api/learning/progress … 学習ガイドの既読登録（常に自分（userId）の進捗のみ操作する）
export const POST = withApi({
  role: "viewer",
  schema: BodySchema,
  handler: async ({ user, db, body }) => {
    const progress = await db.learningProgress.upsert({
      where: { userId_topicKey: { userId: user.id, topicKey: body.topicKey } },
      create: {
        userId: user.id,
        tenantId: user.tenantId,
        topicKey: body.topicKey,
        readAt: new Date(),
      },
      update: { readAt: new Date() },
    });
    return NextResponse.json({ data: { topicKey: progress.topicKey, readAt: progress.readAt } });
  },
});
