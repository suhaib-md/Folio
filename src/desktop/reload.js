// Pure decision: what to do with a tab whose file changed on disk.
//   kind      'modified' | 'removed' (from the file-changed event)
//   diskText  the file's text as read_file returns it (LF endings, no BOM);
//             ignored for 'removed'
// Returns 'ignore' | 'reload' | 'ask' | 'removed'.
import { isDirty } from './tabs.js';

const lf = (s) => String(s).replace(/\r\n/g, '\n');

export function decide(tab, kind, diskText) {
  if (kind === 'removed') return 'removed';
  // Our own save (or a touch that changed nothing).
  const disk = lf(diskText);
  if (tab.savedText != null && disk === tab.savedText) return 'ignore';
  // The disk already holds exactly what the tab shows (restored after a
  // removal, or edited elsewhere to the same text): nothing to ask about.
  if (disk === lf(tab.text)) return 'reload';
  return isDirty(tab) ? 'ask' : 'reload';
}
