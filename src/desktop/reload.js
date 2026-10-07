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
  if (tab.savedText != null && lf(diskText) === tab.savedText) return 'ignore';
  return isDirty(tab) ? 'ask' : 'reload';
}
