import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

// 決算管理システム モバイルアプリのエントリポイント。
// Web と同じバックエンド API (/api/*) を参照してダッシュボードを表示する。
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>決算管理システム</Text>
      <Text style={styles.body}>
        過去データの集計・将来予測をモバイルで確認できます。
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 12 },
  body: { fontSize: 14, textAlign: "center", color: "#444" },
});
