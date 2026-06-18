// Shared mutable app state. Held on one object so modules read live values
// without ES-module live-binding caveats (importers can't reassign an imported
// binding, but they can mutate a shared object's fields).
export const state = {
  lastStats: null,        // last stats snapshot rendered (charts/clock re-read it)
  explainOpen: false,     // persists the raw-vs-weighted panel across refreshes
  cardLayout: {},         // free-drag layout: { "<card-id>": {x, y, w, h} }
};
