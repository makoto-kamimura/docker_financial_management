"use client";

// 設定の「セキュリティ」タブ（MFA とリカバリーコード）。

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SETTINGS_HELP } from "@/lib/shared/help-texts";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";

// ── セキュリティセクション（MFA + リカバリー）────────────────────
export function SecuritySection() {
  const qc = useQueryClient();

  // 現在のログインユーザー。MFA が有効かどうかで画面の出し分けをする
  const { data: me } = useQuery({
    queryKey: ["auth-me"],
    queryFn: async (): Promise<{ mfaEnabled: boolean } | null> => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return (await res.json()).user ?? null;
    },
  });
  const mfaEnabled = me?.mfaEnabled ?? false;

  // MFA セットアップ
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState<SaveMessage>(null);

  async function setup() {
    setMfaMsg(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    if (!res.ok) return setMfaMsg({ ok: false, text: "セットアップに失敗しました。" });
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
    if (res.ok) {
      setSecret(null);
      setUri(null);
      setCode("");
      setMfaMsg({ ok: true, text: "MFA を有効化しました。" });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    } else {
      setMfaMsg({ ok: false, text: "コードが正しくありません。" });
    }
  }

  // MFA 解除。認証アプリのコードで本人確認したうえで無効化する
  // （サーバ側でシークレットとリカバリーコードを破棄する）
  const [disableCode, setDisableCode] = useState("");
  const [disabling, setDisabling] = useState(false);

  async function disable() {
    if (
      !confirm(
        "MFA を解除します。以後はパスワードだけでログインできるようになり、" +
          "発行済みのリカバリーコードも使えなくなります。よろしいですか？",
      )
    )
      return;
    setDisabling(true);
    setMfaMsg(null);
    const res = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: disableCode }),
    });
    setDisabling(false);
    setDisableCode("");
    if (res.ok) {
      setSecret(null);
      setUri(null);
      setCode("");
      setMfaMsg({
        ok: true,
        text: "MFA を解除しました。再度有効にする場合は改めて設定してください。",
      });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    } else {
      setMfaMsg({ ok: false, text: "コードが正しくありません。" });
    }
  }

  // リカバリーコード
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [recMsg, setRecMsg] = useState<SaveMessage>(null);

  async function generateRecovery() {
    if (!confirm("既存のリカバリーコードはすべて無効になります。よろしいですか？")) return;
    setGenerating(true);
    setRecMsg(null);
    setRecoveryCodes(null);
    const res = await fetch("/api/auth/mfa/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totp: totpCode }),
    });
    const json = await res.json();
    if (res.ok) {
      setRecoveryCodes(json.codes);
      setRecMsg({ ok: true, text: json.message });
    } else {
      setRecMsg({ ok: false, text: json.error ?? "生成に失敗しました" });
    }
    setGenerating(false);
    setTotpCode("");
  }

  return (
    <>
      {/* MFA セットアップ */}
      <SectionCard
        title="多要素認証（MFA / TOTP）"
        lead={SETTINGS_HELP.mfa}
        badge={
          <span
            className={`text-xs font-medium rounded-full px-2 py-0.5 border ${
              mfaEnabled
                ? "text-green-700 bg-green-50 border-green-200"
                : "text-slate-500 bg-slate-50 border-slate-200"
            }`}
          >
            {mfaEnabled ? "有効" : "無効"}
          </span>
        }
        actions={
          <button type="button" onClick={setup} className="btn-primary">
            {mfaEnabled ? "シークレットを再発行" : "シークレット発行"}
          </button>
        }
      >
        <ol className="space-y-1 text-sm text-slate-600 mb-2 list-decimal list-inside">
          <li>「シークレット発行」を押す</li>
          <li>表示されたシークレットを認証アプリに登録</li>
          <li>アプリに表示された 6 桁コードを入力して有効化</li>
        </ol>
        {mfaEnabled && (
          <p className="mt-2 text-xs text-slate-400">
            再発行すると新しいシークレットに切り替わります。有効化するまでは今の認証アプリのコードが有効です。
          </p>
        )}
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
        {/* 解除。認証アプリを機種変更・削除する前にここで無効化する。
            本人確認のため現在の 6 桁コードを求める（サーバ側でも検証する）。 */}
        {mfaEnabled && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 mb-1">MFA の解除</p>
            <p className="text-xs text-slate-400 mb-3">
              認証アプリのコードで本人確認のうえ無効化します。シークレットと発行済みの
              リカバリーコードは破棄されるため、再び有効にするときは登録し直しになります。
            </p>
            <div className="flex gap-2">
              <input
                placeholder="6 桁コード"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                maxLength={6}
                className="input-field w-36 text-center tracking-widest font-mono"
              />
              <button
                type="button"
                onClick={disable}
                disabled={disabling || disableCode.length !== 6}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {disabling ? "解除中…" : "MFA を解除"}
              </button>
            </div>
          </div>
        )}
        <SaveNotice msg={mfaMsg} />
      </SectionCard>

      {/* リカバリーコード */}
      <SectionCard title="MFA リカバリーコード" lead={SETTINGS_HELP.recovery}>
        <div className="flex gap-2 mb-4">
          <input
            placeholder="現在の TOTP コード（6桁）"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            maxLength={6}
            className="input-field w-40 text-center tracking-widest font-mono"
          />
          <button
            type="button"
            onClick={generateRecovery}
            // MFA が無効なときはサーバが 400 を返すので、押せないようにしておく
            disabled={generating || totpCode.length !== 6 || !mfaEnabled}
            title={mfaEnabled ? undefined : "MFA を有効化すると発行できます"}
            className="btn-primary px-3"
          >
            {generating ? "生成中…" : "リカバリーコードを発行"}
          </button>
        </div>
        {recoveryCodes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-amber-700 mb-3">
              以下のコードを安全な場所に保管してください（再表示不可・各コードは1回のみ使用可）
            </p>
            <div className="grid grid-cols-2 gap-1">
              {recoveryCodes.map((c, i) => (
                <code
                  key={i}
                  className="bg-white border border-amber-200 rounded px-2 py-1 text-xs font-mono text-slate-800"
                >
                  {c}
                </code>
              ))}
            </div>
          </div>
        )}
        <SaveNotice msg={recMsg} />
      </SectionCard>
    </>
  );
}
