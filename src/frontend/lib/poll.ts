/**
 * Creates a polling interval that auto-cleans on component destroy.
 * Returns a stop function.
 */
export function poll(fn: () => void | Promise<void>, intervalMs: number): () => void {
  fn(); // immediate first call
  const id = setInterval(fn, intervalMs);
  return () => clearInterval(id);
}

/** Default polling intervals */
export const POLL = {
  FAST: 5_000,    // 5s — sessions, active status
  NORMAL: 15_000, // 15s — dashboard, memories
  SLOW: 60_000,   // 60s — plans, agents, skills (rarely change)
} as const;
