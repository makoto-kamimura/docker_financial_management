"use client";

import { useState } from "react";

// MFA（多要素認証）の設定画面。シークレットを発行し、認証アプリのコードで有効化する。
export default function SettingsPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function setup() {
    setMessage(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    if (!res.ok) return setMessage("セットアップに失敗しました。");
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
    setMessage(res.ok ? "MFA を有効化しました。" : "コードが正しくありません。");
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 560, margin: "0 auto" }}>
      <h1>セキュリティ設定</h1>
      <h2>多要素認証 (MFA / TOTP)</h2>
      <ol>
        <li>「シークレット発行」を押す</li>
        <li>表示されたシークレット（または otpauth URI）を認証アプリに登録</li>
        <li>アプリに表示された 6 桁コードを入力して有効化</li>
      </ol>

      <button type="button" onClick={setup}>
        シークレット発行
      </button>

      {secret && (
        <div style={{ marginTop: "1rem" }}>
          <p>
            シークレット: <code>{secret}</code>
          </p>
          <p style={{ wordBreak: "break-all", color: "#6b7280", fontSize: 12 }}>{uri}</p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input
              placeholder="6桁コード"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="button" onClick={enable}>
              有効化
            </button>
          </div>
        </div>
      )}

      {message && <p>{message}</p>}
      <p style={{ marginTop: "1rem" }}>
        <a href="/dashboard">← ダッシュボードへ</a>
      </p>
    </main>
  );
}
