import Gantt from "frappe-gantt";

// Frappe Gantt 1.2.2 binds an anonymous document mouseup handler and has no
// destroy API: https://github.com/frappe/gantt/blob/v1.2.2/src/index.js
// Capture only synchronous constructor registrations and restore immediately.
// This lets each React mount remove exactly its own document handlers.
export function createOwnedGantt(element, rows, options) {
  const add = document.addEventListener;
  const owned = [];
  document.addEventListener = function (type, listener, opts) {
    owned.push([type, listener, opts]);
    return add.call(this, type, listener, opts);
  };
  const dispose = () => {
    owned.forEach(([type, listener, opts]) =>
      document.removeEventListener(type, listener, opts),
    );
    element.replaceChildren();
  };
  try {
    return { chart: new Gantt(element, rows, options), dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    document.addEventListener = add;
  }
}
