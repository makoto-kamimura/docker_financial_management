// 申告書の転記用 PDF（web 版の「やること・書類」タブの「申告書（転記用 PDF）」と同じ）。
// 保存した入力で要る申告書だけを出し、PDF を端末に保存して共有シートで開く（確認・保存・印刷）。
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Sharing from "expo-sharing";
import { downloadTaxFormPdf, fetchTaxForms, type TaxFormItem } from "../api";
import { Button, Card, COLORS, Notice, SectionTitle } from "./ui";

export function TaxFormsSection({ year }: { year: number }) {
  const [forms, setForms] = useState<TaxFormItem[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setForms(await fetchTaxForms(year));
    } catch (err) {
      setError(err instanceof Error ? err.message : "申告書の一覧を取得できませんでした");
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  async function open(f: TaxFormItem) {
    setError("");
    setOpening(f.key);
    try {
      const uri = await downloadTaxFormPdf(year, f.key);
      if (!(await Sharing.isAvailableAsync())) {
        setError("この端末では PDF を開けません");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: f.title,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF を取得できませんでした");
    } finally {
      setOpening(null);
    }
  }

  const needed = (forms ?? []).filter((f) => f.needed);
  return (
    <Card style={s.card}>
      <SectionTitle note="保存した入力で作ります">申告書（転記用 PDF）</SectionTitle>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {forms === null ? (
        <Text style={s.muted}>読み込み中…</Text>
      ) : needed.length === 0 ? (
        <Text style={s.muted}>今の入力では、要る申告書はありません。</Text>
      ) : (
        needed.map((f) => (
          <View key={f.key} style={s.row}>
            <View style={s.body}>
              <Text style={s.title}>
                {f.title}
                {f.pageCount > 1 ? `（${f.pageCount} 枚）` : ""}
              </Text>
              <Text style={s.muted}>
                {f.group}・{f.why}
              </Text>
            </View>
            <Button
              small
              variant="secondary"
              label="開く"
              loading={opening === f.key}
              onPress={() => open(f)}
            />
          </View>
        ))
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 14, color: COLORS.text },
  muted: { fontSize: 12, color: COLORS.sub },
});
