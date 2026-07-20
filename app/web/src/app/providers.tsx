"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { installSessionExpiredFetch } from "@/lib/session-expired-fetch";

// クライアント全体で共有する React Query プロバイダ
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  useEffect(() => {
    installSessionExpiredFetch();
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
