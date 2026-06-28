import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ViewMode } from "../api";

export type MoreRoute =
  | "assets" | "bank-accounts" | "bank-transactions" | "loans" | "settings"
  | "journals" | "invoices" | "closing" | "governance";

type MenuItem = {
  id: MoreRoute;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  modes: ViewMode[];
};

const MENU_ITEMS: { group: string; items: MenuItem[] }[] = [
  {
    group: "銀行・資産",
    items: [
      { id: "bank-accounts",     label: "銀行口座管理", icon: "business-outline",         color: "#4f46e5", bg: "#eef2ff", modes: ["household", "sole", "corporate"] },
      { id: "bank-transactions", label: "入出金管理",   icon: "swap-horizontal-outline",  color: "#0891b2", bg: "#ecfeff", modes: ["household", "sole", "corporate"] },
      { id: "assets",            label: "資産管理",     icon: "trending-up-outline",      color: "#16a34a", bg: "#f0fdf4", modes: ["household", "sole", "corporate"] },
      { id: "loans",             label: "借入金管理",   icon: "card-outline",             color: "#dc2626", bg: "#fef2f2", modes: ["household", "sole", "corporate"] },
    ],
  },
  {
    group: "会計帳簿",
    items: [
      { id: "journals",   label: "仕訳帳",         icon: "book-outline",          color: "#7c3aed", bg: "#f5f3ff", modes: ["sole", "corporate"] },
      { id: "invoices",   label: "インボイス",     icon: "receipt-outline",       color: "#b45309", bg: "#fffbeb", modes: ["sole", "corporate"] },
      { id: "closing",    label: "決算処理",       icon: "bar-chart-outline",     color: "#0f766e", bg: "#f0fdfa", modes: ["sole", "corporate"] },
      { id: "governance", label: "ガバナンス管理", icon: "shield-checkmark-outline", color: "#1d4ed8", bg: "#eff6ff", modes: ["corporate"] },
    ],
  },
  {
    group: "設定",
    items: [
      { id: "settings", label: "設定", icon: "settings-outline", color: "#475569", bg: "#f8fafc", modes: ["household", "sole", "corporate"] },
    ],
  },
];

type Props = { viewMode: ViewMode; onNavigate: (route: MoreRoute) => void };

export function MoreScreen({ viewMode, onNavigate }: Props) {
  return (
    <ScrollView style={s.container}>
      {MENU_ITEMS.map(({ group, items }) => {
        const visible = items.filter(i => i.modes.includes(viewMode));
        if (visible.length === 0) return null;
        return (
          <View key={group} style={s.group}>
            <Text style={s.groupLabel}>{group}</Text>
            {visible.map(item => (
              <TouchableOpacity key={item.id} style={s.row} onPress={() => onNavigate(item.id)}>
                <View style={[s.iconWrap, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={20} color={item.color} />
                </View>
                <Text style={s.label}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
              </TouchableOpacity>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  group: { marginBottom: 20 },
  groupLabel: {
    fontSize: 11, fontWeight: "700", color: "#94a3b8",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8,
  },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 14, padding: 14, marginBottom: 6,
    borderWidth: 1, borderColor: "#f1f5f9",
    shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  label: { flex: 1, fontSize: 14, color: "#1e293b", fontWeight: "500" },
});
