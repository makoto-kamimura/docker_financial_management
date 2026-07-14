import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { TOPIC_KEYS, loadTopic } from "@/lib/learning-content";

// GET /api/learning/topics/[key] … 学習ガイド記事本文 + 自分の既読状況
// key は TOPIC_KEYS（ビルド時生成の定数配列）による z.enum ホワイトリストで検証し、
// リクエスト値からファイルパスを組み立てることはない（パストラバーサルの構造的排除）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, params }) => {
    const parsed = z.enum(TOPIC_KEYS).safeParse(params.key);
    if (!parsed.success) throw badRequest("invalid topic key");

    const topic = loadTopic(parsed.data);
    if (!topic) throw notFound();

    const progress = await db.learningProgress.findUnique({
      where: { userId_topicKey: { userId: user.id, topicKey: topic.key } },
    });
    return NextResponse.json({
      data: { ...topic, read: progress !== null, readAt: progress?.readAt ?? null },
    });
  },
});
