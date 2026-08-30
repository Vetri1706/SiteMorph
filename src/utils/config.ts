export const isInsideForma = typeof window !== "undefined" && window !== window.parent;
const isHostedSite = typeof window !== "undefined" && window.location.hostname.endsWith(".chatgpt.site");
const optionalFortyGuardEvidence = !isHostedSite && import.meta.env.VITE_FORTYGUARD_OPTIONAL_EVIDENCE === "true";

export const appConfig = {
  // The Forma SDK requires an embedded host bridge. Standalone localhost is
  // always a safe, explicitly labelled preview; embedded Forma is always live.
  mockMode: !isInsideForma,
  backendUrl: import.meta.env.VITE_SITEMORPH_BACKEND_URL ?? "/api",
  hostedSite: isHostedSite,
  optionalFortyGuardEvidence,
  firstRunActivityLimit: optionalFortyGuardEvidence ? 15 : 12,
  paidFortyGuardAnalysis: isHostedSite || import.meta.env.VITE_FORTYGUARD_PAID_ANALYSIS === "true",
} as const;

export const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const content = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, content: string, mimeType = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
