"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";

export default function SettingsPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function setup() {
    setMessage(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    if (!res.ok) return setMessage({ ok: false, text: "セットアップに失敗しました。" });
    const json = await res.json();
    setSecret(json.secret);
    setUri(json.otpauthUri);
  }

  async function enable() {
    const res = await fetch("/api/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setMessage(
      res.ok
        ? { ok: true, text: "MFA を有効化しました。" }
        : { ok: false, text: "コードが正しくありません。" },
    );
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">セキュリティ設定</h1>
        <p className="text-sm text-slate-500 mt-0.5">多要素認証（MFA / TOTP）の管理</p>
      </div>

      <div className="card max-w-lg">
        <h2 className="section-title">多要素認証（MFA / TOTP）</h2>

        <ol className="space-y-1 text-sm text-slate-600 mb-6 list-decimal list-inside">
          <li>「シークレット発行」を押す</li>
          <li>表示されたシークレットを認証アプリに登録</li>
          <li>アプリに表示された 6 桁コードを入力して有効化</li>
        </ol>

        <button type="button" onClick={setup} className="btn-primary">
          シークレット発行
        </button>

        {secret && (
          <div className="mt-5 space-y-4 pt-5 border-t border-slate-100">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">シークレット</p>
              <code className="block bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 break-all">
                {secret}
              </code>
            </div>
            {uri && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">otpauth URI</p>
                <p className="text-xs text-slate-400 break-all leading-relaxed">{uri}</p>
              </div>
            )}
            <div className="flex gap-2">
              <input
                placeholder="6 桁コード"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="input-field w-36 text-center tracking-widest font-mono"
              />
              <button type="button" onClick={enable} className="btn-primary">
                有効化
              </button>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`mt-4 text-sm rounded-lg px-3 py-2 border ${
              message.ok
                ? "text-green-700 bg-green-50 border-green-200"
                : "text-red-600 bg-red-50 border-red-200"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </AppShell>
  );
}
