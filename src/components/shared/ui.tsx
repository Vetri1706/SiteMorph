import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, Check, Circle, LoaderCircle, Minus, X } from "lucide-react";
import type { AsyncStatus, SourceKind } from "../../types";

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`section ${className}`}>{children}</section>;
}

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>{eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}<h2 className="section-title">{title}</h2></div>
      {action}
    </div>
  );
}

export function SourceChip({ source, children }: { source: SourceKind; children: ReactNode }) {
  return <span className={`source-chip source-${source}`}>{children}</span>;
}

export function StatusGlyph({ status }: { status: AsyncStatus }) {
  if (status === "completed") return <Check size={13} strokeWidth={2.4} />;
  if (status === "running") return <LoaderCircle className="animate-spin" size={13} />;
  if (status === "failed") return <X size={13} />;
  if (status === "skipped") return <Minus size={13} />;
  if (status === "pending") return <Circle size={9} />;
  return <Circle size={9} />;
}

export function StatusPill({ label, tone = "success" }: { label: string; tone?: "success" | "warning" | "danger" | "neutral" | "info" }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{label}</span>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <AlertTriangle size={20} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function MetricRow({ label, value, accent }: { label: string; value: string; accent?: "hot" | "cool" | "green" }) {
  return <div className="metric-row"><span>{label}</span><strong className={accent ? `text-${accent}` : ""}>{value}</strong></div>;
}

export function Score({ value }: { value: number }) {
  const tone = value >= 82 ? "good" : value >= 74 ? "review" : "bad";
  return <span className={`score score-${tone}`}>{value}</span>;
}
