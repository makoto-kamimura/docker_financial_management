export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>決算管理システム</h1>
      <p>
        過去の財務データを集計し、将来の推移を予測してグラフで可視化するダッシュボードです。
      </p>
      <ul>
        <li><a href="/dashboard">ダッシュボード（推移グラフ）</a></li>
        <li><a href="/entry">実績データ入力</a></li>
        <li><a href="/login">ログイン</a></li>
      </ul>
      <p>
        バックエンド API は <code>/api/*</code>（Next.js Route Handlers）で提供しています。
      </p>
    </main>
  );
}
