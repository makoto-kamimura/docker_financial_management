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
import { login, type UserInfo } from "../api";

type Props = { onLogin: (user: UserInfo) => void };

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert("入力エラー", "メールアドレスとパスワードを入力してください。");
      return;
    }
    setLoading(true);
    try {
      const user = await login(email, password);
      onLogin(user);
    } catch (e: unknown) {
      Alert.alert("ログイン失敗", e instanceof Error ? e.message : "エラーが発生しました。");
    } finally {
      setLoading(false);
    }
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
});
