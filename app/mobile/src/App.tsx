import { useState } from "react";
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { type UserInfo, logout } from "./api";
import { LoginScreen } from "./screens/LoginScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { AssetsScreen } from "./screens/AssetsScreen";
import { BudgetScreen } from "./screens/BudgetScreen";
import { EntryScreen } from "./screens/EntryScreen";

type Tab = "dashboard" | "assets" | "budget" | "entry";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "dashboard", label: "ホーム", icon: "📊" },
  { id: "assets", label: "資産", icon: "🏦" },
  { id: "budget", label: "予算", icon: "📋" },
  { id: "entry", label: "入力", icon: "✏️" },
];

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  async function handleLogout() {
    await logout().catch(() => {});
    setUser(null);
  }

  if (!user) {
    return (
      <>
        <LoginScreen onLogin={setUser} />
        <StatusBar style="dark" />
      </>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />

      {/* ヘッダー */}
      <View style={s.header}>
        <Text style={s.headerTitle}>決算管理</Text>
        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
          <Text style={s.logoutText}>{user.name} ▸ ログアウト</Text>
        </TouchableOpacity>
      </View>

      {/* コンテンツ */}
      <View style={s.body}>
        {activeTab === "dashboard" && <DashboardScreen />}
        {activeTab === "assets" && <AssetsScreen />}
        {activeTab === "budget" && <BudgetScreen />}
        {activeTab === "entry" && <EntryScreen />}
      </View>

      {/* タブバー */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={s.tabItem}
            onPress={() => setActiveTab(t.id)}
          >
            <Text style={[s.tabIcon, activeTab === t.id && s.tabIconActive]}>{t.icon}</Text>
            <Text style={[s.tabLabel, activeTab === t.id && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#1e293b" },
  logoutBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  logoutText: { fontSize: 12, color: "#64748b" },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    backgroundColor: "#fff",
    paddingBottom: 4,
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 8 },
  tabIcon: { fontSize: 20, opacity: 0.45 },
  tabIconActive: { opacity: 1 },
  tabLabel: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  tabLabelActive: { color: "#4f46e5", fontWeight: "600" },
});
