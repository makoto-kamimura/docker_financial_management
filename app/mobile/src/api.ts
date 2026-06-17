import Constants from "expo-constants";

// app.json の extra.apiBaseUrl を参照（未設定時はローカル）
const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? "http://localhost:3000/api";

export type ForecastResponse = {
  accountCode: string;
  method: string;
  scenario: string;
  history: { key: string; total: number }[];
  forecast: number[];
};

export async function fetchForecast(accountCode = "4000", months = 6): Promise<ForecastResponse> {
  const res = await fetch(`${API_BASE_URL}/forecasts?accountCode=${accountCode}&months=${months}`);
  if (!res.ok) throw new Error("failed to load forecast");
  return res.json();
}
