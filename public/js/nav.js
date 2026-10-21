// Lets pages move to another page or redraw the current one without importing app.js
// (which would be a circular import). app.js plugs in the real functions on start.

let impl = {
  navigate: (href) => location.assign(href),
  refresh: () => location.reload(),
};

export function setNav(next) {
  impl = next;
}

export const navigate = (href, options) => impl.navigate(href, options);
export const refresh = () => impl.refresh();
