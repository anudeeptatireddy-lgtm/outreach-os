/** Only in-app paths are valid redirect targets: /app or /app/... with no backslash. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || next.includes("\\") || !/^\/app(\/|$|\?|#)/.test(next)) return fallback;
  return next;
}
