// Helpers for wall-clock tests. GitHub Actions (CI=true) runners, Windows
// especially, are 2-4x slower than a dev machine, so absolute budgets get a
// 4x allowance there. Ratio (linearity) checks need no scaling.
export function budget(ms) {
  return ms * (process.env.CI ? 4 : 1);
}

// Run fn once as warm-up, then n timed runs; return the fastest in ms.
export function bestOf(n, fn) {
  fn();
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}
