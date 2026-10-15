// 控除・確定申告（web 版 /tax-return の閲覧版）。見込み・控除の内訳と説明・ふるさと納税・今年の変更点・
// やることと書類を出す。家族・上書きした値などの入力は web 版で行う。計算は web と共有（shared/tax-estimate.ts）。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { fetchTaxReturn, type TaxReturn } from "../api";
import { Card, COLORS, Lead, Notice, SectionTitle, TabBar } from "../components/ui";
import { yen, yenAbs } from "../format";
import { useFiscalYear } from "../fiscal-year";
import { TAX_RETURN_HELP } from "../shared/help-texts";
import { FAMILY_KIND_LABEL } from "../shared/tax-family";
import {
  DEDUCTION_GUIDES,
  NOT_COVERED,
  TAX_BASICS,
  TAX_GUIDE_DISCLAIMER,
  buildTodos,
  yearGuideFor,
  type DeductionGuide,
  type GuideSection,
} from "../shared/tax-guide";

type Tab = "overview" | "deductions" | "furusato" | "changes" | "todo";
const TABS = [
  ["overview", "概要"],
  ["deductions", "控除"],
  ["furusato", "ふるさと納税"],
  ["changes", "今年の変更点"],
  ["todo", "やること・書類"],
] as const;

export function TaxReturnScreen() {
  // 対象年度は画面上部のサブヘッダーで選ぶ（全画面で共通）
  const year = useFiscalYear();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<TaxReturn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchTaxReturn(year));
    } catch (e) {
      setError(e instanceof Error ? e.message : "データを取得できませんでした");
    }
  }, [year]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Lead>{TAX_RETURN_HELP.page}</Lead>
      <Notice>
        家族・源泉徴収票の額・控除の入力は Web 版で行ってください（モバイルでは閲覧のみ）。
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        !error && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />
      ) : (
        <>
          {data.rulesInfo.fallback && (
            <Notice tone="warn">
              {data.year} 年分の制度の値はまだ用意していないため、{data.rulesInfo.baseYear}{" "}
              年分の値で計算しています。改正があった場合は Web 版の設定「税制設定」で値を直せます。
            </Notice>
          )}
          <Kpis data={data} />
          <TabBar tabs={TABS} value={tab} onChange={setTab} />
          {tab === "overview" && <Overview data={data} />}
          {tab === "deductions" && <Deductions data={data} />}
          {tab === "furusato" && <Furusato data={data} />}
          {tab === "changes" && <Changes year={data.year} />}
          {tab === "todo" && <Todo data={data} />}
        </>
      )}
    </ScrollView>
  );
}

function Kpis({ data }: { data: TaxReturn }) {
  const e = data.estimate;
  // 給与があるのに源泉徴収税額が入っていなければ、還付・追加納付は出さない（web 版と同じ）
  const withheldUnknown = e.income.salary > 0 && e.refund.withheld === 0;
  const refund = e.refund.amount;
  const items: [string, string, string][] = [
    ["合計所得", yen(e.income.total), COLORS.text],
    [`${data.year} 年分の所得税`, yen(e.incomeTax.total), COLORS.text],
    withheldUnknown
      ? ["還付の見込み", "—", COLORS.sub]
      : [
          refund >= 0 ? "還付の見込み" : "追加で納める見込み",
          yenAbs(refund),
          refund >= 0 ? COLORS.success : COLORS.danger,
        ],
    [`${data.year + 1} 年度の住民税`, yen(e.resident.total), COLORS.text],
    ["ふるさと納税の残り枠", yen(e.furusato.remaining), COLORS.primary],
  ];
  return (
    <View style={s.kpis}>
      {items.map(([label, value, color]) => (
        <Card key={label} style={s.kpi}>
          <Text style={s.kpiLabel}>{label}</Text>
          <Text style={[s.kpiValue, { color }]}>{value}</Text>
        </Card>
      ))}
    </View>
  );
}

function Sections({ items }: { items: GuideSection[] }) {
  return (
    <>
      {items.map((it) => (
        <View key={it.title} style={s.section}>
          <Text style={s.sectionHead}>{it.title}</Text>
          <Text style={s.body}>{it.body}</Text>
        </View>
      ))}
    </>
  );
}

function Overview({ data }: { data: TaxReturn }) {
  const e = data.estimate;
  return (
    <>
      <Card style={s.card}>
        <SectionTitle>確定申告</SectionTitle>
        <Text style={[s.badge, e.filing.willFile ? s.badgeWarn : s.badgeOk]}>
          {e.filing.willFile ? "申告する" : "申告不要の見込み"}
        </Text>
        {e.filing.required.length > 0 && (
          <List title="申告が必要な理由" items={e.filing.required.map((r) => r.label)} />
        )}
        {e.filing.beneficial.length > 0 && (
          <List
            title="申告すると税金が戻る（減る）もの"
            items={e.filing.beneficial.map((r) => r.label)}
          />
        )}
        {!e.filing.willFile && (
          <Text style={s.body}>
            {e.income.salary > 0
              ? "年末調整で済む見込みです。ふるさと納税は、寄付先が 5 自治体以内ならワンストップ特例を使えます。"
              : "確定申告は要らない見込みです。"}
          </Text>
        )}
        {e.notes.map((n) => (
          <Notice key={n} tone="warn">
            {n}
          </Notice>
        ))}
      </Card>
      <Card style={s.card}>
        <SectionTitle>内訳</SectionTitle>
        <Line label="給与収入" value={yen(e.income.salary)} />
        <Line label="給与所得" value={yen(e.income.salaryIncome)} />
        {e.payroll && (
          <>
            <Line label="総支給額（給与明細）" value={yen(e.payroll.gross)} />
            <Line label="社会保険料（天引き）" value={yen(e.payroll.social)} />
            <Line
              label={`住民税（${e.year + 1} 年 6 月から・月額）`}
              value={yen(e.payroll.resident.nextMonthly)}
            />
          </>
        )}
        {e.income.business !== 0 && <Line label="事業所得" value={yen(e.income.business)} />}
        {e.income.other > 0 && <Line label="その他の所得" value={yen(e.income.other)} />}
        <Line label="所得控除（所得税）" value={yen(e.deductionTotal.income)} />
        <Line label="所得控除（住民税）" value={yen(e.deductionTotal.resident)} />
        <Line
          label="課税所得（所得税）"
          value={`${yen(e.taxable.income)}（税率 ${Math.round(e.incomeTax.rate * 100)}%）`}
        />
        <Line label="源泉徴収済み" value={yen(e.refund.withheld)} />
      </Card>
      <Card style={s.card}>
        <SectionTitle>基本の考え方</SectionTitle>
        <Sections items={TAX_BASICS} />
        <Text style={s.muted}>{TAX_GUIDE_DISCLAIMER}</Text>
      </Card>
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionHead}>{title}</Text>
      {items.map((i) => (
        <Text key={i} style={s.body}>
          ・{i}
        </Text>
      ))}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.line}>
      <Text style={s.lineLabel}>{label}</Text>
      <Text style={s.lineValue}>{value}</Text>
    </View>
  );
}

/** 控除の説明。押すと開く */
function GuideItem({ guide, amounts }: { guide: DeductionGuide; amounts?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.guide}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} hitSlop={6}>
        <View style={s.line}>
          <Text style={[s.lineLabel, s.guideTitle]}>
            {open ? "▲" : "▼"} {guide.title}
          </Text>
          {amounts ? <Text style={s.lineValue}>{amounts}</Text> : null}
        </View>
      </TouchableOpacity>
      {open && (
        <View style={s.guideBody}>
          <Text style={s.body}>{guide.summary}</Text>
          <Text style={s.body}>
            <Text style={s.term}>対象：</Text>
            {guide.who}
          </Text>
          <Text style={s.body}>
            <Text style={s.term}>計算：</Text>
            {guide.calc}
          </Text>
          <Text style={s.body}>
            <Text style={s.term}>手続き：</Text>
            {guide.procedure}
          </Text>
          {guide.documents.length > 0 && (
            <Text style={s.body}>
              <Text style={s.term}>書類：</Text>
              {guide.documents.join("、")}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function Deductions({ data }: { data: TaxReturn }) {
  const e = data.estimate;
  const h = e.housing;
  return (
    <>
      <Card style={s.card}>
        <SectionTitle note="押すと説明が開きます">所得控除（所得税／住民税）</SectionTitle>
        {DEDUCTION_GUIDES.filter((g) => g.type === "所得控除").map((g) => {
          const line = e.deductions.find((d) => d.key === g.key);
          return (
            <GuideItem
              key={g.key}
              guide={g}
              amounts={line ? `${yen(line.income)}／${yen(line.resident)}` : "—"}
            />
          );
        })}
      </Card>
      {e.family.members.length > 0 && (
        <Card style={s.card}>
          <SectionTitle>家族の判定</SectionTitle>
          {e.family.members.map((j) => (
            <View key={j.member.id} style={s.section}>
              <Text style={s.sectionHead}>
                {j.member.name || "（呼び名なし）"}：{j.age} 歳・所得 {yen(j.income)} →{" "}
                {FAMILY_KIND_LABEL[j.kind]}
              </Text>
              {j.walls
                .filter((w) => w.room >= 0)
                .slice(0, 2)
                .map((w) => (
                  <Text key={w.label} style={s.muted}>
                    {w.label}: 年収 {yen(w.salaryLimit)} まで（あと {yen(w.room)}）
                  </Text>
                ))}
            </View>
          ))}
        </Card>
      )}
      <Card style={s.card}>
        <SectionTitle>税額控除</SectionTitle>
        <GuideItem
          guide={DEDUCTION_GUIDES.find((g) => g.key === "housingLoan")!}
          amounts={h ? yen(h.credit) : "—"}
        />
        {h && (
          <>
            {h.limit > 0 && <Line label="借入限度額" value={yen(h.limit)} />}
            {h.years > 0 && <Line label="控除期間" value={`${h.yearIndex} / ${h.years} 年目`} />}
            <Line label="住民税から引く分" value={yen(e.resident.housingCredit)} />
            {h.reason && <Notice tone="warn">{h.reason}</Notice>}
          </>
        )}
        <GuideItem
          guide={DEDUCTION_GUIDES.find((g) => g.key === "otherTaxCredit")!}
          amounts={yen(e.incomeTax.otherCredit)}
        />
      </Card>
      <Card style={s.card}>
        <SectionTitle>このページで計算しないもの</SectionTitle>
        <Sections items={NOT_COVERED} />
      </Card>
    </>
  );
}

function Furusato({ data }: { data: TaxReturn }) {
  const f = data.estimate.furusato;
  const guide = yearGuideFor(data.year);
  return (
    <>
      <Card style={s.card}>
        <SectionTitle>上限と残り枠</SectionTitle>
        <Line label="上限の目安" value={yen(f.limit)} />
        <Line label="寄付済み" value={yen(f.donated)} />
        <Line label={`残り枠（${data.year} 年 12 月 31 日まで）`} value={yen(f.remaining)} />
        <Text style={s.body}>
          {f.path === "oneStop" &&
            "ワンストップ特例を使う見込みです。控除は全額が翌年度の住民税から引かれます（所得税の還付はありません）。"}
          {f.path === "return" &&
            "確定申告で控除を受ける見込みです。所得税の還付と、翌年度の住民税からの控除に分かれます。"}
          {f.path === "none" &&
            f.oneStopAvailable &&
            "確定申告をしなければ、寄付先が 5 自治体以内ならワンストップ特例を使えます。"}
        </Text>
        {f.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
        <Text style={s.muted}>
          帳簿の「ふるさと納税」の科目に記帳すると、寄付済みの額に自動で入ります。
        </Text>
      </Card>
      {guide && (
        <Card style={s.card}>
          <SectionTitle note={guide.year !== data.year ? `${guide.year} 年時点の内容` : undefined}>
            制度の動き
          </SectionTitle>
          <Sections items={guide.furusato} />
        </Card>
      )}
    </>
  );
}

function Changes({ year }: { year: number }) {
  const guide = yearGuideFor(year);
  if (!guide) return <Notice>この年の変更点はまだ用意していません。</Notice>;
  return (
    <>
      {guide.year !== year && (
        <Notice tone="warn">
          {year} 年の変更点はまだ用意していません。{guide.year} 年の内容を出しています。
        </Notice>
      )}
      <Card style={s.card}>
        <SectionTitle>{`${guide.year} 年分の主な変更点`}</SectionTitle>
        <Sections items={guide.changes} />
      </Card>
      <Card style={s.card}>
        <SectionTitle>この先に決まっている改正</SectionTitle>
        <Sections items={guide.upcoming} />
      </Card>
      <Card style={s.card}>
        <SectionTitle>出典</SectionTitle>
        {guide.sources.map((src) => (
          <TouchableOpacity key={src.url} onPress={() => Linking.openURL(src.url)} hitSlop={4}>
            <Text style={s.link}>{src.label}</Text>
          </TouchableOpacity>
        ))}
      </Card>
    </>
  );
}

function Todo({ data }: { data: TaxReturn }) {
  const e = data.estimate;
  const checked = new Set(data.inputs.checks);
  const todos = buildTodos(data.year, e);
  return (
    <>
      <Card style={s.card}>
        <SectionTitle note="チェックは Web 版で付けます">やること</SectionTitle>
        {todos.map((t) => (
          <View key={t.id} style={s.section}>
            <View style={s.line}>
              <Text style={[s.lineLabel, s.guideTitle]}>
                {checked.has(`todo:${t.id}`) ? "✓ " : "○ "}
                {t.title}
              </Text>
              <Text style={s.muted}>{t.due.replace(/-/g, "/")} まで</Text>
            </View>
            <Text style={s.muted}>{t.body}</Text>
          </View>
        ))}
      </Card>
      <Card style={s.card}>
        <SectionTitle>必要な書類</SectionTitle>
        {e.documents.length === 0 ? (
          <Text style={s.muted}>今の入力では、集める書類はありません。</Text>
        ) : (
          e.documents.map((d) => (
            <View key={d.id} style={s.section}>
              <Text style={s.body}>
                {checked.has(`doc:${d.id}`) ? "✓ " : "○ "}
                {d.label}
              </Text>
              <Text style={s.muted}>{d.why}</Text>
            </View>
          ))
        )}
        {e.filing.willFile && (
          <TouchableOpacity
            onPress={() => Linking.openURL("https://www.keisan.nta.go.jp/")}
            hitSlop={4}
          >
            <Text style={s.link}>確定申告書等作成コーナー（国税庁）</Text>
          </TouchableOpacity>
        )}
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpi: { flexBasis: "47%", flexGrow: 1, padding: 12 },
  kpiLabel: { fontSize: 11, color: COLORS.sub },
  kpiValue: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  card: { marginTop: 4 },
  section: { marginTop: 8 },
  sectionHead: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  body: { fontSize: 13, color: COLORS.text, lineHeight: 20, marginTop: 2 },
  muted: { fontSize: 11, color: COLORS.sub, lineHeight: 16, marginTop: 4 },
  term: { fontWeight: "600" },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    gap: 8,
  },
  lineLabel: { fontSize: 13, color: COLORS.sub, flexShrink: 1 },
  lineValue: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  guide: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 2 },
  guideTitle: { color: COLORS.text },
  guideBody: { paddingBottom: 8, paddingLeft: 4 },
  badge: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 4,
  },
  badgeOk: { backgroundColor: "#dcfce7", color: "#15803d" },
  badgeWarn: { backgroundColor: "#fef3c7", color: "#b45309" },
  link: { fontSize: 13, color: COLORS.primary, textDecorationLine: "underline", marginTop: 6 },
});
