import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

type Props = { message?: string };

export function LoadingView({ message = "データを取得中..." }: Props) {
  return (
    <View style={s.container}>
      <ActivityIndicator size="large" color="#4f46e5" />
      <Text style={s.text}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 60, gap: 12 },
  text: { fontSize: 13, color: "#94a3b8" },
});
