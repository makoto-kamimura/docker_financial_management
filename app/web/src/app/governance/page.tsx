"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

type Tenant  = { id: number; name: string; type: string };
type Officer = { id: number; tenantId: number; name: string; title: string; termStart: string; termEnd: string; salary: string | null };
type Meeting = { id: number; tenantId: number; meetingDate: string; meetingType: string; agenda: string; resolution: string | null };
type Dividend= { id: number; tenantId: number; resolutionDate: string; paymentDate: string; perShareAmount: string; totalAmount: string };
type Ann     = { id: number; tenantId: number; announcementDate: string; method: string; content: string | null; fiscalYear: number };

type Tab = "officers" | "meetings" | "dividends" | "announcements";

export default function GovernancePage() {
  const [tab, setTab]               = useState<Tab>("officers");
  const [tenants, setTenants]       = useState<Tenant[]>([]);
  const [tenantId, setTenantId]     = useState<number | "">("");
  const [officers, setOfficers]     = useState<Officer[]>([]);
  const [meetings, setMeetings]     = useState<Meeting[]>([]);
  const [dividends, setDividends]   = useState<Dividend[]>([]);
  const [announcements, setAnns]    = useState<Ann[]>([]);
  const [loading, setLoading]       = useState(false);
  const [showForm, setShowForm]     = useState(false);

  const [officerForm, setOF] = useState({ tenantId: "", name: "", title: "", termStart: "", termEnd: "", salary: "" });
  const [meetingForm, setMF] = useState({ tenantId: "", meetingDate: "", meetingType: "regular", agenda: "", resolution: "" });
  const [divForm, setDF]     = useState({ tenantId: "", resolutionDate: "", paymentDate: "", perShareAmount: "0", totalAmount: "" });
  const [annForm, setAF]     = useState({ tenantId: "", announcementDate: "", method: "WEBSITE", content: "", fiscalYear: String(new Date().getFullYear()) });

  const qs = tenantId ? `?tenantId=${tenantId}` : "";

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/tenants").then(r => r.json()),
      fetch(`/api/officers${qs}`).then(r => r.json()),
      fetch(`/api/shareholder-meetings${qs}`).then(r => r.json()),
      fetch(`/api/dividends${qs}`).then(r => r.json()),
      fetch(`/api/announcements${qs}`).then(r => r.json()),
    ]).then(([t, o, m, d, a]) => {
      setTenants(t.data ?? []);
      setOfficers(o.data ?? []);
      setMeetings(m.data ?? []);
      setDividends(d.data ?? []);
      setAnns(a.data ?? []);
      setLoading(false);
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, [tenantId]);

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "officers",      label: "役員管理",    count: officers.length },
    { key: "meetings",      label: "株主総会",     count: meetings.length },
    { key: "dividends",     label: "配当管理",     count: dividends.length },
    { key: "announcements", label: "決算公告",     count: announcements.length },
  ];

  const saveOfficer = async () => {
    const r = await fetch("/api/officers", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...officerForm, tenantId: Number(officerForm.tenantId), salary: officerForm.salary ? Number(officerForm.salary) : undefined }) });
    if (r.ok) { setShowForm(false); loadAll(); }
  };
  const saveMeeting = async () => {
    const r = await fetch("/api/shareholder-meetings", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...meetingForm, tenantId: Number(meetingForm.tenantId) }) });
    if (r.ok) { setShowForm(false); loadAll(); }
  };
  const saveDiv = async () => {
    const r = await fetch("/api/dividends", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...divForm, tenantId: Number(divForm.tenantId), perShareAmount: Number(divForm.perShareAmount), totalAmount: Number(divForm.totalAmount) }) });
    if (r.ok) { setShowForm(false); loadAll(); }
  };
  const saveAnn = async () => {
    const r = await fetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...annForm, tenantId: Number(annForm.tenantId), fiscalYear: Number(annForm.fiscalYear) }) });
    if (r.ok) { setShowForm(false); loadAll(); }
  };

  const delOfficer = async (id: number) => { if (!confirm("削除しますか？")) return; await fetch(`/api/officers/${id}`, { method: "DELETE" }); loadAll(); };
  const delMeeting = async (id: number) => { if (!confirm("削除しますか？")) return; await fetch(`/api/shareholder-meetings/${id}`, { method: "DELETE" }); loadAll(); };
  const delDiv     = async (id: number) => { if (!confirm("削除しますか？")) return; await fetch(`/api/dividends/${id}`, { method: "DELETE" }); loadAll(); };
  const delAnn     = async (id: number) => { if (!confirm("削除しますか？")) return; await fetch(`/api/announcements/${id}`, { method: "DELETE" }); loadAll(); };

  const isExpiringSoon = (termEnd: string) => {
    const d = new Date(termEnd);
    const now = new Date();
    const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 90;
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">法人ガバナンス管理</h1>
        <div className="flex gap-3">
          <select value={tenantId} onChange={e => setTenantId(e.target.value === "" ? "" : Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">全テナント</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
            追加
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t.label}
            <span className="ml-1.5 text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full">{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? <p className="text-slate-400">読み込み中…</p> : (
        <>
          {tab === "officers" && (
            <div className="space-y-3">
              {officers.length === 0 ? <p className="text-slate-400 text-center py-12">役員情報がありません。</p> : officers.map(o => (
                <div key={o.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{o.name}</span>
                      <span className="text-sm text-slate-500">/ {o.title}</span>
                      {isExpiringSoon(o.termEnd) && (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">任期満了まで90日以内</span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      任期: {o.termStart.slice(0, 10)} 〜 {o.termEnd.slice(0, 10)}
                      {o.salary && <span className="ml-4">報酬: ¥{Number(o.salary).toLocaleString()}/月</span>}
                    </div>
                  </div>
                  <button onClick={() => delOfficer(o.id)} className="text-sm text-red-500 hover:underline">削除</button>
                </div>
              ))}
            </div>
          )}

          {tab === "meetings" && (
            <div className="space-y-3">
              {meetings.length === 0 ? <p className="text-slate-400 text-center py-12">株主総会の記録がありません。</p> : meetings.map(m => (
                <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${m.meetingType === "regular" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                          {m.meetingType === "regular" ? "定時" : "臨時"}
                        </span>
                        <span className="font-medium text-slate-800">{m.meetingDate.slice(0, 10)}</span>
                      </div>
                      <p className="text-sm text-slate-700 font-medium">議題: {m.agenda}</p>
                      {m.resolution && <p className="text-sm text-slate-500 mt-1">決議: {m.resolution}</p>}
                    </div>
                    <button onClick={() => delMeeting(m.id)} className="text-sm text-red-500 hover:underline">削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "dividends" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>{["決議日","支払日","1株配当","配当総額","操作"].map(h => <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dividends.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">配当記録がありません。</td></tr>
                  ) : dividends.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{d.resolutionDate.slice(0, 10)}</td>
                      <td className="px-4 py-3">{d.paymentDate.slice(0, 10)}</td>
                      <td className="px-4 py-3">¥{Number(d.perShareAmount).toLocaleString()}</td>
                      <td className="px-4 py-3 font-semibold">¥{Number(d.totalAmount).toLocaleString()}</td>
                      <td className="px-4 py-3"><button onClick={() => delDiv(d.id)} className="text-xs text-red-500 hover:underline">削除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "announcements" && (
            <div className="space-y-3">
              {announcements.length === 0 ? <p className="text-slate-400 text-center py-12">決算公告の記録がありません。</p> : announcements.map(a => (
                <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {a.method === "KANPO" ? "官報" : a.method === "NEWSPAPER" ? "日刊紙" : "ウェブサイト"}
                      </span>
                      <span className="font-medium text-slate-800">{a.announcementDate.slice(0, 10)}</span>
                      <span className="text-sm text-slate-500">/ {a.fiscalYear}年度</span>
                    </div>
                    {a.content && <p className="text-sm text-slate-600">{a.content}</p>}
                  </div>
                  <button onClick={() => delAnn(a.id)} className="text-sm text-red-500 hover:underline">削除</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 追加フォーム */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold text-slate-800 mb-4">
              {tab === "officers" ? "役員追加" : tab === "meetings" ? "株主総会記録追加" : tab === "dividends" ? "配当追加" : "決算公告追加"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">テナント *</label>
                <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={tab === "officers" ? officerForm.tenantId : tab === "meetings" ? meetingForm.tenantId : tab === "dividends" ? divForm.tenantId : annForm.tenantId}
                  onChange={e => {
                    const v = e.target.value;
                    if (tab === "officers") setOF(f => ({ ...f, tenantId: v }));
                    else if (tab === "meetings") setMF(f => ({ ...f, tenantId: v }));
                    else if (tab === "dividends") setDF(f => ({ ...f, tenantId: v }));
                    else setAF(f => ({ ...f, tenantId: v }));
                  }}>
                  <option value="">選択してください</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {tab === "officers" && (
                <>
                  {[["name","氏名 *"],["title","役職 *"],["salary","月額報酬（円）"]].map(([k, l]) => (
                    <div key={k}>
                      <label className="block text-sm font-medium text-slate-600 mb-1">{l}</label>
                      <input type={k === "salary" ? "number" : "text"} value={officerForm[k as keyof typeof officerForm]}
                        onChange={e => setOF(f => ({ ...f, [k]: e.target.value }))}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    {[["termStart","任期開始"],["termEnd","任期終了"]].map(([k, l]) => (
                      <div key={k}>
                        <label className="block text-sm font-medium text-slate-600 mb-1">{l}</label>
                        <input type="date" value={officerForm[k as keyof typeof officerForm]}
                          onChange={e => setOF(f => ({ ...f, [k]: e.target.value }))}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tab === "meetings" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">開催日 *</label>
                    <input type="date" value={meetingForm.meetingDate} onChange={e => setMF(f => ({ ...f, meetingDate: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">種別</label>
                    <select value={meetingForm.meetingType} onChange={e => setMF(f => ({ ...f, meetingType: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                      <option value="regular">定時総会</option>
                      <option value="extraordinary">臨時総会</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">議題 *</label>
                    <textarea value={meetingForm.agenda} onChange={e => setMF(f => ({ ...f, agenda: e.target.value }))}
                      rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">決議内容</label>
                    <textarea value={meetingForm.resolution} onChange={e => setMF(f => ({ ...f, resolution: e.target.value }))}
                      rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </>
              )}

              {tab === "dividends" && (
                <>
                  {[["resolutionDate","決議日 *","date"],["paymentDate","支払日 *","date"],["perShareAmount","1株配当額（円）"],["totalAmount","配当総額（円）*"]].map(([k, l, type]) => (
                    <div key={k}>
                      <label className="block text-sm font-medium text-slate-600 mb-1">{l}</label>
                      <input type={type ?? "number"} value={divForm[k as keyof typeof divForm]}
                        onChange={e => setDF(f => ({ ...f, [k]: e.target.value }))}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  ))}
                </>
              )}

              {tab === "announcements" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">公告日 *</label>
                    <input type="date" value={annForm.announcementDate} onChange={e => setAF(f => ({ ...f, announcementDate: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">公告方式</label>
                    <select value={annForm.method} onChange={e => setAF(f => ({ ...f, method: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                      <option value="WEBSITE">ウェブサイト</option>
                      <option value="KANPO">官報</option>
                      <option value="NEWSPAPER">日刊新聞</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">対象年度 *</label>
                    <input type="number" value={annForm.fiscalYear} onChange={e => setAF(f => ({ ...f, fiscalYear: e.target.value }))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">公告内容</label>
                    <textarea value={annForm.content} onChange={e => setAF(f => ({ ...f, content: e.target.value }))}
                      rows={3} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">キャンセル</button>
              <button onClick={tab === "officers" ? saveOfficer : tab === "meetings" ? saveMeeting : tab === "dividends" ? saveDiv : saveAnn}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
