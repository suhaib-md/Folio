// Pure: what closing the window has to ask about.
import { isDirty } from './tabs.js';

// The dirty tabs, in tab-bar order: each gets the "Save changes?" prompt.
export function planWindowClose(state) {
  return state.tabs.filter(isDirty);
}
