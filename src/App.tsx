import { ExtensionPanel } from "./pages/ExtensionPanel";
import { ProgramPlanPreview } from "./pages/ProgramPlanPreview";

export function App() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("planPreview")) {
    return <ProgramPlanPreview />;
  }
  return <ExtensionPanel />;
}
