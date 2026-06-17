import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { fetchForecast, type ForecastResponse } from "./api";
import { TrendChart } from "./TrendChart";

// 決算管理システム モバイルアプリ。
// Web と共通のバックエンド API (/api/forecasts) を参照しダッシュボードを表示する。
export default function App() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchForecast("4000", 6)
      .then(setData)
      .catch(() => setError("データの取得に失敗しました。"));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>決算管理システム</Text>
      <Text style={styles.body}>売上高（4000）の実績と将来予測</Text>

      {error && <Text style={styles.error}>{error}</Text>}
      {!data && !error && <ActivityIndicator style={{ marginTop: 24 }} />}

      {data && (
        <View style={styles.card}>
          <TrendChart
            actual={data.history.map((h) => h.total)}
            forecast={data.forecast}
          />
          <Text style={styles.caption}>
            実績 {data.history.length} 件 / 予測 {data.forecast.length} か月（{data.method}）
          </Text>
        </View>
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#fff", alignItems: "center", padding: 24, paddingTop: 64 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 8 },
  body: { fontSize: 14, color: "#444", marginBottom: 16 },
  error: { color: "crimson", marginTop: 16 },
  card: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12 },
  caption: { fontSize: 12, color: "#6b7280", marginTop: 8 },
});
