import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/shared/AppErrorBoundary";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><App /></QueryClientProvider></AppErrorBoundary></React.StrictMode>,
);
