import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { ClimateTab } from "../components/climate/ClimateTab";
import { CompareTab } from "../components/compare/CompareTab";
import { DesignTab } from "../components/design/DesignTab";
import { AppHeader } from "../components/shared/AppHeader";
import { Toast } from "../components/shared/Toast";
import { SiteTab } from "../components/site/SiteTab";
import { TraceTab } from "../components/trace/TraceTab";
import { useSiteMorphStore } from "../stores/useSiteMorphStore";

export function ExtensionPanel() {
  const activeTab = useSiteMorphStore((state) => state.activeTab);
  const initialize = useSiteMorphStore((state) => state.initialize);
  useEffect(() => { void initialize(); }, [initialize]);
  return (
    <main className="extension-shell">
      <AppHeader />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activeTab} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} transition={{ duration: 0.14, ease: "easeOut" }}>
          {activeTab === "site" && <SiteTab />}
          {activeTab === "climate" && <ClimateTab />}
          {activeTab === "design" && <DesignTab />}
          {activeTab === "compare" && <CompareTab />}
          {activeTab === "trace" && <TraceTab />}
        </motion.div>
      </AnimatePresence>
      <Toast />
    </main>
  );
}
