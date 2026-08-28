import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createSiteAnalyzeMiddleware } from "./server/fortyguard";

function siteMorphBackend(env: Record<string, string>): Plugin {
  const defaultDates = [
    "2023-07-15", "2024-07-15", "2025-07-15",
  ];
  const analysisDates = (env.FORTYGUARD_ANALYSIS_DATES ? env.FORTYGUARD_ANALYSIS_DATES.split(",") : defaultDates)
    .map((date) => date.trim())
    .filter((date, index, dates) => /^\d{4}-\d{2}-\d{2}$/.test(date) && dates.indexOf(date) === index)
    .slice(0, 16);
  const configuredActivityLimit = Number(env.FORTYGUARD_MAX_NEW_ACTIVITIES);
  const maxNewActivities = Number.isFinite(configuredActivityLimit) && configuredActivityLimit >= 0
    ? Math.floor(configuredActivityLimit)
    : 0;
  return {
    name: "sitemorph-backend",
    configureServer(server) {
      server.middlewares.use(createSiteAnalyzeMiddleware({
        apiKey: env.FORTYGUARD_API_KEY,
        baseUrl: (env.FORTYGUARD_API_URL || "https://api.fortyguard.com/v1").replace(/\/$/, ""),
        analysisDates,
        granularity: [60, 80, 100].includes(Number(env.FORTYGUARD_GRANULARITY)) ? Number(env.FORTYGUARD_GRANULARITY) as 60 | 80 | 100 : 60,
        pollIntervalMs: Number(env.FORTYGUARD_POLL_INTERVAL_MS) || 2000,
        maxPollAttempts: Number(env.FORTYGUARD_MAX_POLL_ATTEMPTS) || 60,
        maxNewActivities,
        includeOptionalEvidence: env.FORTYGUARD_INCLUDE_OPTIONAL_EVIDENCE === "true",
        cacheVersion: env.FORTYGUARD_CACHE_VERSION || "v1",
      }));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    build: { outDir: "dist/client" },
    optimizeDeps: {
      include: ["react", "react-dom/client", "zustand", "lucide-react", "proj4"],
    },
    server: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
      allowedHosts: ["terminal.local"],
      warmup: { clientFiles: ["./src/main.tsx"] },
    },
    plugins: [react(), tailwindcss(), siteMorphBackend(env)],
  };
});
