export function resolve(...parts: string[]): string {
  const joined = parts.filter(Boolean).join("/").replaceAll("\\", "/").replaceAll(/\/{2,}/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}
