// A gate that work can wait at while something else is in progress. Used so
// a save never reads a tab's path while a rename of that file is in flight:
// the save would write the OLD path with the newest text, and the rename's
// retarget would then point the tab at a file holding older text.
//
// hold(promise): the gate is closed until `promise` settles (and every other
// held promise has). wait(): resolves when it is open; open already -> next
// microtask. Never rejects.
export function createGate() {
  const held = new Set();
  return {
    hold(promise) {
      const p = Promise.resolve(promise).then(() => {}, () => {});
      held.add(p);
      p.then(() => held.delete(p));
      return promise;
    },
    async wait() {
      while (held.size) await Promise.all([...held]);
    },
    get closed() {
      return held.size > 0;
    },
  };
}
