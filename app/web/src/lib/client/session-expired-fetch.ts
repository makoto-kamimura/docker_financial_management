// セッション切れ検知: middleware は Cookie の有無しかチェックしないため、
// アイドルタイムアウト等でセッションが失効していても各ページは 200 で描画され、
// 内部の /api/* 呼び出しだけが 401 になり「データが消えた」ように見えてしまう。
// ここでは fetch を一度だけラップし、/api/* への 401 応答を検知して /login へ
// 誘導する（/api/auth/* はログイン・MFA 自体の失敗で 401 を返すため対象外）。

let installed = false;

function requestPath(input: RequestInfo | URL): string | null {
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, window.location.origin).pathname;
  } catch {
    return null;
  }
}

export function installSessionExpiredFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    const path = requestPath(input);
    if (
      res.status === 401 &&
      path?.startsWith("/api/") &&
      !path.startsWith("/api/auth/") &&
      window.location.pathname !== "/login"
    ) {
      const redirect = window.location.pathname + window.location.search;
      window.location.href = `/login?sessionExpired=1&redirect=${encodeURIComponent(redirect)}`;
    }
    return res;
  };
}
