// Pure: what closing the window has to ask about.
import { isDirty } from './tabs.js';

// The dirty tabs, in tab-bar order: each gets the "Save changes?" prompt.
export function planWindowClose(state) {
  return state.tabs.filter(isDirty);
}

// Window close: prompt (via closeTabFlow) for the first dirty tab, then plan
// again, so a tab that became dirty while a prompt or save was pending is
// asked about too. closeTabFlow(id) resolves true once the tab is gone,
// false to keep the window open. Resolves true to let the window close.
export async function runWindowClose({ getState, closeTabFlow }) {
  for (let tab; (tab = planWindowClose(getState())[0]);) {
    if (!(await closeTabFlow(tab.id))) return false;
  }
  return true;
}
