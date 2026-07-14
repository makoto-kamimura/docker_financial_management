import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { login, verifyMfa, type UserInfo } from "../api";

type Props = { onLogin: (user: UserInfo) => void };

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // S-15: MFA 2段階目
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert("入力エラー", "メールアドレスとパスワードを入力してください。");
      return;
    }
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.status === "mfaRequired") {
        setMfaToken(result.mfaToken);
      } else {
        onLogin(result.user);
      }
    } catch (e: unknown) {
      Alert.alert("ログイン失敗", e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyMfa() {
    if (!mfaToken || !code) return;
    setLoading(true);
    try {
      const user = await verifyMfa(mfaToken, useRecoveryCode ? { recoveryCode: code } : { code });
      onLogin(user);
    } catch (e: unknown) {
      Alert.alert("認証失敗", e instanceof Error ? e.message : "エラーが発生しました。");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials() {
    setMfaToken(null);
    setCode("");
    setUseRecoveryCode(false);
  }

  if (mfaToken) {
    return (
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.card}>
          <Text style={s.title}>2段階認証</Text>
          <Text style={s.subtitle}>
            {useRecoveryCode
              ? "発行済みのリカバリーコードを入力してください"
              : "認証アプリの 6 桁コードを入力してください"}
          </Text>
          <TextInput
            style={s.input}
            placeholder={useRecoveryCode ? "XXXX-XXXX-XX" : "123456"}
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            keyboardType={useRecoveryCode ? "default" : "number-pad"}
            editable={!loading}
            autoFocus
          />
          <TouchableOpacity
            style={[s.btn, (loading || !code) && s.btnDisabled]}
            onPress={handleVerifyMfa}
            disabled={loading || !code}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>確認</Text>}
          </TouchableOpacity>

          <View style={s.mfaLinkRow}>
            <TouchableOpacity onPress={backToCredentials}>
              <Text style={s.mfaLinkText}>‹ 戻る</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setUseRecoveryCode((v) => !v);
                setCode("");
              }}
            >
              <Text style={s.mfaLinkTextPrimary}>
                {useRecoveryCode ? "認証コードを使う" : "リカバリーコードを使う"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.card}>
        <Text style={s.title}>finance</Text>
        <Text style={s.subtitle}>ログイン</Text>
        <TextInput
          style={s.input}
          placeholder="メールアドレス"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!loading}
        />
        <TextInput
          style={s.input}
          placeholder="パスワード"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
        />
        <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ログイン</Text>}
        </TouchableOpacity>

        <View style={s.demoBox}>
          <Text style={s.demoTitle}>テストアカウント（共通パスワード: password）</Text>
          {[
            { label: "管理者", email: "admin@example.com" },
            { label: "編集者", email: "editor@example.com" },
            { label: "閲覧者", email: "viewer@example.com" },
          ].map(({ label, email }) => (
            <TouchableOpacity
              key={email}
              style={s.demoRow}
              onPress={() => { setEmail(email); setPassword("password"); }}
            >
              <Text style={s.demoLabel}>{label}</Text>
              <Text style={s.demoEmail}>{email}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 24, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#64748b", textAlign: "center", marginBottom: 24 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 15 },
  btn: { backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  demoBox: { marginTop: 20, borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 16 },
  demoTitle: { fontSize: 11, color: "#94a3b8", marginBottom: 10, textAlign: "center" },
  demoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "#f8fafc", borderRadius: 8, marginBottom: 6 },
  demoLabel: { fontSize: 12, fontWeight: "600", color: "#475569", width: 52 },
  demoEmail: { fontSize: 12, color: "#6366f1" },
  mfaLinkRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  mfaLinkText: { fontSize: 13, color: "#64748b" },
  mfaLinkTextPrimary: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
});
