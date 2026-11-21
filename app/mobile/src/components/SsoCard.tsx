// 設定の「セキュリティ」の SSO の欄: 共通の認証サーバーとの連携・解除と「SSO だけでログインする」
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { fetchSsoIdentities, setSsoOnly, unlinkSso, type SsoIdentities } from "../api";
import { SSO_COPY } from "../shared/sso-copy";
import { signInWithSso } from "../sso";
import { Button, Card, SectionTitle } from "./ui";

export function SsoCard() {
  const [ids, setIds] = useState<SsoIdentities | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchSsoIdentities().then(setIds, () => setIds(null));
  }, []);
  useEffect(load, [load]);

  if (!ids?.sso_enabled) return null;
  const name = ids.sso_name || "SSO";
  const sso = ids.identities.find((i) => i.provider === "sso");

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      const ok = await fn();
      if (done && ok) Alert.alert(done);
      load();
    } catch (e) {
      Alert.alert("エラー", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const confirm = (title: string, label: string, onOk: () => void) =>
    Alert.alert(title, undefined, [
      { text: "キャンセル", style: "cancel" },
      { text: label, style: "destructive", onPress: onOk },
    ]);

  return (
    <Card>
      <SectionTitle note={SSO_COPY.linkDescription(name)}>{SSO_COPY.linkTitle(name)}</SectionTitle>
      {sso ? (
        <>
          <Text style={s.body}>{SSO_COPY.linkedAs(sso.email ?? name)}</Text>
          <Text style={s.body}>{SSO_COPY.ssoOnlyTitle(name, ids.sso_only)}</Text>
          <Text style={s.muted}>{SSO_COPY.ssoOnlyDescription}</Text>
          {ids.sso_only ? (
            <Button label={SSO_COPY.ssoOnlyOff} variant="secondary" disabled={busy} onPress={() => run(() => setSsoOnly(false))} style={s.gap} />
          ) : ids.login_method === "sso" ? (
            <Button
              label={SSO_COPY.ssoOnlyOn}
              variant="secondary"
              disabled={busy}
              onPress={() => confirm(SSO_COPY.ssoOnlyConfirm(name), SSO_COPY.ssoOnlyOn, () => run(() => setSsoOnly(true)))}
              style={s.gap}
            />
          ) : (
            <Text style={s.muted}>{SSO_COPY.ssoOnlyNeedsSso(name)}</Text>
          )}
          <Button
            label={SSO_COPY.unlink}
            variant="danger"
            disabled={busy}
            onPress={() => confirm(SSO_COPY.unlinkConfirm(name), SSO_COPY.unlink, () => run(unlinkSso))}
            style={s.gap}
          />
        </>
      ) : ids.can_link ? (
        <Button
          label={SSO_COPY.link(name)}
          variant="secondary"
          disabled={busy}
          onPress={() => run(() => signInWithSso("link", name), SSO_COPY.linked)}
          style={s.gap}
        />
      ) : (
        <Text style={s.muted}>{SSO_COPY.demoDenied(name)}</Text>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  body: { fontSize: 14, color: "#0f172a", marginTop: 8 },
  muted: { fontSize: 12, color: "#64748b", marginTop: 6 },
  gap: { marginTop: 10 },
});
