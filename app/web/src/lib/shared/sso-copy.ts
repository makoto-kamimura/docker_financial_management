// SSO の画面の文言（Web とモバイルで共通。mobile/src/shared へ同期する場合も、この内容を使う）
export type SsoMode = "login" | "link";

export const SSO_COPY = {
  or: "または",
  login: (name: string) => `${name} でログイン`,
  loginHint: (name: string) => `設定の「セキュリティ」で ${name} を連携した人だけが使えます。このアプリの MFA は求めません（${name} のパスキーが兼ねます）。`,
  linkTitle: (name: string) => `${name} でログイン`,
  linkDescription: (name: string) =>
    `共通のアカウントと連携すると、ほかのアプリと同じログインで入れます。このアプリには、${name} にパスキーでログインした場合だけ入れます（このアプリの MFA の代わりになります）。`,
  linked: "連携しました。",
  linkedAs: (email: string) => `連携済み: ${email}`,
  link: (name: string) => `${name} のアカウントと連携する`,
  unlink: "連携を解除",
  unlinkConfirm: (name: string) => `連携を解除しますか？「${name} だけ」も外れ、パスワードでログインできるようになります。`,
  demoDenied: (name: string) => `デモ用のアカウントには ${name} を連携できません。`,
  ssoOnlyTitle: (name: string, on: boolean) => `${name} だけでログインする: ${on ? "オン" : "オフ"}`,
  ssoOnlyDescription:
    "オンにすると、メールアドレスとパスワードではログインできなくなります。ほかの端末でパスワードで入っているログインも、その時点で切れます。",
  ssoOnlyOn: "オンにする",
  ssoOnlyOff: "オフにする",
  ssoOnlyConfirm: (name: string) => `${name} だけでログインしますか？ メールアドレスとパスワードではログインできなくなります。`,
  ssoOnlyNeedsSso: (name: string) =>
    `オンにするには、いったんログアウトして「${name} でログイン」で入り直してください（${name} で入れることを確かめるため）。`,
} as const;

/** API から戻ってきた error を、画面に出す文に変える */
export function ssoErrorMessage(reason: string | null | undefined, mode: SsoMode, name = "SSO"): string | null {
  if (!reason) return null;
  switch (reason) {
    case "not_linked":
      return `この ${name} のアカウントは連携されていません。メールアドレスとパスワードでログインし、設定の「セキュリティ」で連携してください。`;
    case "mfa_required":
      return `このアプリは 2 段階認証が必須です。${name} にパスキーでログインしてから、もう一度お試しください。`;
    case "cancelled":
      return mode === "login" ? `${name} でのログインを中止しました。` : `${name} との連携を中止しました。`;
    case "expired":
      return "有効期限が切れました。もう一度やり直してください。";
    case "conflict":
      return `この ${name} のアカウントは、ほかの利用者に連携されているか、すでに別のアカウントと連携済みです。`;
    case "demo":
      return `デモ用のアカウントには ${name} を連携できません。`;
    default:
      return mode === "login"
        ? `${name} でログインできませんでした。もう一度お試しください。`
        : `${name} と連携できませんでした。もう一度お試しください。`;
  }
}
