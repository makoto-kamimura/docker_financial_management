import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchSsoName, login, verifyMfa, type UserInfo } from "../api";
import { SSO_COPY } from "../shared/sso-copy";
import { signInWithSso } from "../sso";

type Props = { onLogin: (user: UserInfo) => void };

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // S-15: MFA 2段階目
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [sso, setSso] = useState<string | null>(null);

  useEffect(() => {
    void fetchSsoName().then(setSso);
  }, []);

  // SSO でログイン（このアプリの MFA は求めない。認証サーバーのパスキーが兼ねる）
  async function handleSso() {
    setLoading(true);
    try {
      const user = await signInWithSso("login", sso ?? "SSO");
      if (user && user !== true) onLogin(user);
    } catch (e: unknown) {
      Alert.alert("ログイン失敗", e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setLoading(false);
    }
  }

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
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
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
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.card}>
        <Image source={require("../../assets/logo.png")} style={s.logo} />
        <Text style={s.title}>カケイカイケイ</Text>
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
        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>ログイン</Text>}
        </TouchableOpacity>
        {sso && (
          <>
            <Text style={s.ssoOr}>{SSO_COPY.or}</Text>
            <TouchableOpacity style={[s.ssoBtn, loading && s.btnDisabled]} onPress={handleSso} disabled={loading}>
              <Text style={s.ssoBtnText}>{SSO_COPY.login(sso)}</Text>
            </TouchableOpacity>
            <Text style={s.ssoHint}>{SSO_COPY.loginHint(sso)}</Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  logo: { width: 64, height: 64, alignSelf: "center", marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#64748b", textAlign: "center", marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 15,
  },
  btn: {
    backgroundColor: "#4f46e5",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  ssoOr: { textAlign: "center", color: "#64748b", fontSize: 12, marginTop: 16, marginBottom: 8 },
  ssoBtn: { borderWidth: 1, borderColor: "#2563eb", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  ssoBtnText: { color: "#2563eb", fontWeight: "600", fontSize: 15 },
  ssoHint: { textAlign: "center", color: "#64748b", fontSize: 11, marginTop: 8 },
  mfaLinkRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  mfaLinkText: { fontSize: 13, color: "#64748b" },
  mfaLinkTextPrimary: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
});
