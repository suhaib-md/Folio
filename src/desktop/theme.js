// The theme actually showing: 'light' | 'dark' (for Mermaid and anything else
// that can't read the CSS variables). data-theme on <html> forces one; absent
// means follow the system.
export function effectiveTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
