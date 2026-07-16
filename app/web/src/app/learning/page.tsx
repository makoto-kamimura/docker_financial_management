"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

type TopicSummary = {
  key: string;
  title: string;
  order: number;
  relatedPath: string | null;
  relatedLabel: string | null;
  read: boolean;
  readAt: string | null;
};

type TopicDetail = TopicSummary & { html: string };

export default function LearningPage() {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch("/api/learning/topics")
      .then((r) => r.json())
      .then((json) => {
        const list: TopicSummary[] = json.data ?? [];
        setTopics(list);
        setLoading(false);
        if (list.length > 0) setSelectedKey(list[0].key);
      });
  }, []);

  useEffect(() => {
    if (!selectedKey) return;
    setDetailLoading(true);
    fetch(`/api/learning/topics/${selectedKey}`)
      .then((r) => r.json())
      .then((json) => {
        setDetail(json.data ?? null);
        setDetailLoading(false);
      });
    fetch("/api/learning/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicKey: selectedKey }),
    }).then(() => {
      setTopics((list) => list.map((t) => (t.key === selectedKey ? { ...t, read: true } : t)));
    });
  }, [selectedKey]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">学習ガイド</h1>
        <p className="text-sm text-slate-500 mt-1">
          自分の家計データを教材に、複式簿記・決算処理・必要申告書について学びます。
        </p>
      </div>

      {loading ? (
        <p className="text-slate-400">読み込み中…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-6">
          <nav className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {topics.map((t) => (
              <button
                key={t.key}
                onClick={() => setSelectedKey(t.key)}
                className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between gap-2 ${
                  t.key === selectedKey
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>{t.title}</span>
                {t.read && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">
                    既読
                  </span>
                )}
              </button>
            ))}
          </nav>

          <article className="bg-white rounded-xl border border-slate-200 p-6">
            {detailLoading || !detail ? (
              <p className="text-slate-400">読み込み中…</p>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-800 mb-4">{detail.title}</h2>
                <div
                  className="text-sm text-slate-700 leading-relaxed [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-800 [&_h2]:mt-6 [&_h2]:mb-2 [&_h2:first-child]:mt-0 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_li]:mb-1 [&_a]:text-indigo-600 [&_a]:underline [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs"
                  dangerouslySetInnerHTML={{ __html: detail.html }}
                />
                {detail.relatedPath && (
                  <div className="mt-6 pt-4 border-t border-slate-100">
                    <Link
                      href={detail.relatedPath as never}
                      className="text-sm text-indigo-600 hover:underline"
                    >
                      → {detail.relatedLabel ?? "自分のデータで見る"}
                    </Link>
                  </div>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </AppShell>
  );
}
