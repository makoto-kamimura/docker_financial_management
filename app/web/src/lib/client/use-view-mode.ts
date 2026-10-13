"use client";

import { useEffect, useState } from "react";
import type { ViewMode } from "@/lib/shared/display-name";
import { scopeOfMode, type ActualsScope } from "@/lib/shared/business-use";

const STORAGE_KEY = "viewMode";
const VALID_MODES: readonly ViewMode[] = ["household", "sole", "corporate"];

function readStoredMode(): ViewMode | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v && (VALID_MODES as readonly string[]).includes(v) ? (v as ViewMode) : null;
}

// F-10: ダッシュボードのステップ進捗チェックリスト「モード切替経験」判定用。
// AppShell の changeViewMode() がモード実切替のたびに "true" をセットする。
export function hasSwitchedViewMode(): boolean {
  return localStorage.getItem("viewmode-switched") === "true";
}

// AppShell のモード切替ピル（家計/個人/法人）と同期する現在の観点モード。
// AppShell が localStorage への保存と "viewmode-change" カスタムイベントの発火を担当し、
// 各画面はこのフックで購読するだけでよい（dashboard / bank-transactions の重複実装を統一）。
export function useViewMode(initial: ViewMode = "household"): ViewMode {
  const [mode, setMode] = useState<ViewMode>(initial);

  useEffect(() => {
    const stored = readStoredMode();
    if (stored) setMode(stored);

    const handler = () => {
      const next = readStoredMode();
      if (next) setMode(next);
    };
    window.addEventListener("viewmode-change", handler);
    return () => window.removeEventListener("viewmode-change", handler);
  }, []);

  return mode;
}

/**
 * 表示モードから決めた実績の範囲（個人事業主モードは business）。モードを読むまでは null。
 * 画面は null の間は取得しない（useQuery の enabled）。家庭の数字が一瞬見えてから事業の数字に
 * 切り替わるのを防ぐため。取得のキーには範囲を入れる。
 */
export function useActualsScope(): ActualsScope | null {
  const [scope, setScope] = useState<ActualsScope | null>(null);
  useEffect(() => {
    const read = () => setScope(scopeOfMode(readStoredMode() ?? "household"));
    read();
    window.addEventListener("viewmode-change", read);
    return () => window.removeEventListener("viewmode-change", read);
  }, []);
  return scope;
}
