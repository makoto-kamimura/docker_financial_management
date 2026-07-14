import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { loadTopicSummaries } from "@/lib/learning-content";

// GET /api/learning/topics … 学習ガイドのトピック一覧 + 自分の既読状況（ロール不問・認証のみ）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const summaries = loadTopicSummaries();
    const progress = await db.learningProgress.findMany({
      where: { userId: user.id },
      select: { topicKey: true, readAt: true },
    });
    const readMap = new Map(progress.map((p) => [p.topicKey, p.readAt]));
    const data = summaries.map((t) => ({
      ...t,
      read: readMap.has(t.key),
      readAt: readMap.get(t.key) ?? null,
    }));
    return NextResponse.json({ data });
  },
});
