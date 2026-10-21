// Vite's base is '/' on root hosts and '/REPOSITORY/' on GitHub project Pages.
// Keep public assets and update checks on the same deployed site as the bundle.
export function publicAsset(path, base = import.meta.env?.BASE_URL || '/') {
  if (/^(https?:|data:|blob:|\/\/)/i.test(path)) return path;
  const root = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/\/+/g, '/');
  return path.startsWith(root) ? path : root + path.replace(/^\/+/, '');
}
