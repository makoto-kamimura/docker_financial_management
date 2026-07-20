"use client";

import { useEffect, useState } from "react";

type Step = "credentials" | "mfa";

export default function LoginPage() {
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    setSessionExpired(new URLSearchParams(window.location.search).get("sessionExpired") === "1");
  }, []);

  async function handleCredentialsSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      window.location.href = "/dashboard";
      return;
    }
    if (res.status === 401 && json.mfaRequired && json.mfaToken) {
      setMfaToken(json.mfaToken);
      setStep("mfa");
      return;
    }
    if (typeof json.error === "string") {
      setError(json.error);
    } else {
      setError(
        `サーバーエラーが発生しました（HTTP ${res.status}）。DB が起動しているか確認してください。`,
      );
    }
  }

  async function handleMfaSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setLoading(true);
    const res = await fetch("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(useRecoveryCode ? { mfaToken, recoveryCode: code } : { mfaToken, code }),
    });
    setLoading(false);
    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      window.location.href = "/dashboard";
      return;
    }
    if (typeof json.error === "string") {
      setError(json.error);
    } else {
      setError(`サーバーエラーが発生しました（HTTP ${res.status}）。`);
    }
    setCode("");
  }

  function backToCredentials() {
    setStep("credentials");
    setMfaToken(null);
    setCode("");
    setError(null);
    setUseRecoveryCode(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">決算管理システム</h1>
          <p className="text-sm text-slate-500 mt-1">アカウントにログイン</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {sessionExpired && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              セッションの有効期限が切れました。もう一度ログインしてください。
            </p>
          )}
          {step === "credentials" ? (
            <>
              <h2 className="text-xl font-semibold text-slate-800 mb-6">ログイン</h2>
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                    メールアドレス
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="input-field"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-700 mb-1"
                  >
                    パスワード
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="input-field"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full py-2.5 mt-2 disabled:opacity-60"
                >
                  {loading ? "ログイン中…" : "ログイン"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-800 mb-1">2段階認証</h2>
              <p className="text-sm text-slate-500 mb-6">
                {useRecoveryCode
                  ? "発行済みのリカバリーコードを入力してください。"
                  : "認証アプリに表示されている 6 桁のコードを入力してください。"}
              </p>
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <div>
                  <label htmlFor="code" className="block text-sm font-medium text-slate-700 mb-1">
                    {useRecoveryCode ? "リカバリーコード" : "認証コード"}
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode={useRecoveryCode ? "text" : "numeric"}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    autoFocus
                    className="input-field tracking-widest text-center"
                    placeholder={useRecoveryCode ? "XXXX-XXXX-XX" : "123456"}
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !code}
                  className="btn-primary w-full py-2.5 mt-2 disabled:opacity-60"
                >
                  {loading ? "確認中…" : "確認"}
                </button>

                <div className="flex items-center justify-between text-sm mt-2">
                  <button
                    type="button"
                    onClick={backToCredentials}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    ‹ 戻る
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUseRecoveryCode((v) => !v);
                      setCode("");
                      setError(null);
                    }}
                    className="text-indigo-600 hover:underline"
                  >
                    {useRecoveryCode ? "認証コードを使う" : "リカバリーコードを使う"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
