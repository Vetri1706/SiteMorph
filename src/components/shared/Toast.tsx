import { CheckCircle2, X } from "lucide-react";
import { useEffect } from "react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";

export function Toast() {
  const toast = useSiteMorphStore((state) => state.toast);
  const setToast = useSiteMorphStore((state) => state.setToast);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast, setToast]);
  if (!toast) return null;
  return <div className="toast" role="status"><CheckCircle2 size={16} /><span>{toast}</span><button aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button></div>;
}
