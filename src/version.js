import { publicAsset } from './publicAsset.js';
// Which build is running, and whether a newer one has been published.
export const BUILD = typeof __APP_BUILD__ === 'undefined' ? { commit: 'dev', builtAt: '', id: 'dev' } : __APP_BUILD__;

export function versionLabel(build = BUILD) {
  if (!build.builtAt) return `Version ${build.commit}`;
  const date = new Date(build.builtAt);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `Version ${build.commit} · built ${day}, ${time}`;
}

// Resolves to the published build when it differs from this one, else null.
// The development server has no version.json, so it never reports an update.
export async function checkForUpdate(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(`${publicAsset('/version.json')}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const live = await response.json();
    return live?.id && live.id !== BUILD.id ? live : null;
  } catch { return null; }
}
