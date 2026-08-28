import { Activity, BarChart3, Building2, GitCompareArrows, MapPinned, Settings2 } from "lucide-react";
import type { AppTab } from "../../types";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import { appConfig } from "../../utils/config";

const tabs: { id: AppTab; label: string; icon: typeof MapPinned }[] = [
  { id: "site", label: "Site", icon: MapPinned },
  { id: "climate", label: "Climate DNA", icon: Activity },
  { id: "design", label: "Design", icon: Building2 },
  { id: "compare", label: "Compare", icon: GitCompareArrows },
  { id: "trace", label: "Trace", icon: BarChart3 },
];

export function AppHeader() {
  const activeTab = useSiteMorphStore((state) => state.activeTab);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  return (
    <header className="app-header">
      <div className="brand-row">
        <div>
          <div className="flex items-center gap-2"><img className="brand-mark" src="/sitemorph-logo.svg" alt="" /><h1>SiteMorph</h1></div>
          <p>Climate-to-Design Agent</p>
        </div>
        <button className="icon-button" aria-label="Settings"><Settings2 size={18} /></button>
      </div>
      <nav className="tab-list" aria-label="SiteMorph sections">
        {tabs.filter((tab) => appConfig.mockMode || tab.id !== "compare").map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? "page" : undefined}>
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
