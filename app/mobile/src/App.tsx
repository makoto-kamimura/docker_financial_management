import { useState } from "react";
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import {
  getViewMode, logout, setViewMode as apiSetViewMode,
  type UserInfo, type ViewMode, VIEW_MODES,
} from "./api";
import { LoginScreen } from "./screens/LoginScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { EntryScreen } from "./screens/EntryScreen";
import { BankTransactionsScreen } from "./screens/BankTransactionsScreen";
import { MoreScreen, type MoreRoute } from "./screens/MoreScreen";
import { AssetsScreen } from "./screens/AssetsScreen";
import { BankAccountsScreen } from "./screens/BankAccountsScreen";
import { BudgetScreen } from "./screens/BudgetScreen";
import { LoansScreen } from "./screens/LoansScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { JournalsScreen } from "./screens/JournalsScreen";
import { InvoicesScreen } from "./screens/InvoicesScreen";
import { ClosingScreen } from "./screens/ClosingScreen";
import { GovernanceScreen } from "./screens/GovernanceScreen";

type BottomTab = "home" | "budget" | "entry" | "more";

type TabDef = {
  id: BottomTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const BOTTOM_TABS: TabDef[] = [
  { id: "home",   label: "ホーム", icon: "home-outline",    iconActive: "home" },
  { id: "budget", label: "予算",   icon: "wallet-outline",  iconActive: "wallet" },
  { id: "entry",  label: "実績",   icon: "create-outline",  iconActive: "create" },
  { id: "more",   label: "その他", icon: "grid-outline",    iconActive: "grid" },
];

const MORE_TITLES: Record<MoreRoute, string> = {
  "assets":            "資産管理",
  "bank-accounts":     "銀行口座管理",
  "bank-transactions": "入出金管理",
  "loans":             "借入金管理",
  "settings":          "設定",
  "journals":          "仕訳帳",
  "invoices":          "インボイス",
  "closing":           "決算処理",
  "governance":        "ガバナンス管理",
};

const SYSTEM_NAME: Record<ViewMode, string> = {
  household: "家計管理システム",
  sole:      "個人会計システム",
  corporate: "法人会計システム",
};

export default function App() {
  const [user, setUser]           = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [viewMode, setVm]         = useState<ViewMode>(getViewMode());
  const [moreRoute, setMoreRoute] = useState<MoreRoute | null>(null);

  function changeMode(m: ViewMode) {
    apiSetViewMode(m);
    setVm(m);
    setMoreRoute(null);
  }

  async function handleLogout() {
    await logout().catch(() => {});
    setUser(null);
  }

  function navigateMore(route: MoreRoute) { setMoreRoute(route); }
  function backToMore() { setMoreRoute(null); }

  if (!user) {
    return (
      <>
        <LoginScreen onLogin={setUser} />
        <StatusBar style="dark" />
      </>
    );
  }

  const screenTitle = activeTab === "more" && moreRoute
    ? MORE_TITLES[moreRoute]
    : activeTab === "more" ? "その他"
    : activeTab === "home"   ? "ホーム"
    : activeTab === "budget" ? "予算管理"
    : "実績管理";

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />

      {/* ヘッダー */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          {activeTab === "more" && moreRoute ? (
            <TouchableOpacity onPress={backToMore} style={s.backBtn}>
              <Text style={s.backText}>‹ その他</Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.headerTitle}>{screenTitle}</Text>
          )}
        </View>

        {/* モード切替ピル */}
        <View style={s.modePill}>
          {VIEW_MODES.map(m => (
            <TouchableOpacity
              key={m.value}
              style={[s.modeBtn, viewMode === m.value && s.modeBtnActive]}
              onPress={() => changeMode(m.value)}
            >
              <Text style={[s.modeBtnText, viewMode === m.value && s.modeBtnTextActive]}>
                {m.short}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
          <Text style={s.logoutText}>退出</Text>
        </TouchableOpacity>
      </View>

      {/* システム名サブヘッダー */}
      <View style={s.subHeader}>
        <Text style={s.systemName}>{SYSTEM_NAME[viewMode]}</Text>
        <Text style={s.userName}>{user.name}</Text>
      </View>

      {/* コンテンツ */}
      <View style={s.body}>
        {activeTab === "home"   && <DashboardScreen viewMode={viewMode} />}
        {activeTab === "budget" && <BudgetScreen viewMode={viewMode} />}
        {activeTab === "entry"  && <EntryScreen />}
        {activeTab === "more"   && !moreRoute && (
          <MoreScreen viewMode={viewMode} onNavigate={navigateMore} />
        )}
        {activeTab === "more" && moreRoute === "assets"            && <AssetsScreen />}
        {activeTab === "more" && moreRoute === "bank-accounts"     && <BankAccountsScreen />}
        {activeTab === "more" && moreRoute === "bank-transactions" && <BankTransactionsScreen />}
        {activeTab === "more" && moreRoute === "loans"             && <LoansScreen />}
        {activeTab === "more" && moreRoute === "settings"          && <SettingsScreen />}
        {activeTab === "more" && moreRoute === "journals"          && <JournalsScreen />}
        {activeTab === "more" && moreRoute === "invoices"          && <InvoicesScreen />}
        {activeTab === "more" && moreRoute === "closing"           && <ClosingScreen />}
        {activeTab === "more" && moreRoute === "governance"        && <GovernanceScreen />}
      </View>

      {/* タブバー */}
      <View style={s.tabBar}>
        {BOTTOM_TABS.map(t => {
          const active = activeTab === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              style={s.tabItem}
              onPress={() => { setActiveTab(t.id); setMoreRoute(null); }}
            >
              <Ionicons
                name={active ? t.iconActive : t.icon}
                size={23}
                color={active ? "#4f46e5" : "#94a3b8"}
              />
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    backgroundColor: "#fff",
    gap: 8,
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#1e293b" },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 14, color: "#4f46e5", fontWeight: "600" },
  modePill: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  modeBtn: { paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#f8fafc" },
  modeBtnActive: { backgroundColor: "#4f46e5" },
  modeBtnText: { fontSize: 11, color: "#64748b", fontWeight: "600" },
  modeBtnTextActive: { color: "#fff" },
  logoutBtn: { paddingHorizontal: 8, paddingVertical: 5 },
  logoutText: { fontSize: 12, color: "#94a3b8" },
  subHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 4,
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  systemName: { fontSize: 11, color: "#64748b" },
  userName: { fontSize: 11, color: "#94a3b8" },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    backgroundColor: "#fff",
    paddingBottom: 4,
  },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 8 },
  tabLabel: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  tabLabelActive: { color: "#4f46e5", fontWeight: "600" },
});
