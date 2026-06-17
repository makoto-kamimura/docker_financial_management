export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>決算管理システム</h1>
      <p>
        過去の財務データを集計し、将来の推移を予測してグラフで可視化するダッシュボードです。
      </p>
      <ul>
        <li>データ取り込み・集計</li>
        <li>将来予測（推移グラフ）</li>
        <li>予実対比レポート</li>
      </ul>
      <p>
        バックエンド API は <code>/api/*</code>（Next.js Route Handlers）で提供しています。
      </p>
    </main>
  );
}
