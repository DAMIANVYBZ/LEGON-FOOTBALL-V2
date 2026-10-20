import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Every build gets an identity: the Git commit it was built from (Netlify
// provides COMMIT_REF) and the build time. It is baked into the game and also
// published as /version.json, so an open game can see when a newer build is live.
function commit() {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'local'; }
}
const build = { commit: commit(), builtAt: new Date().toISOString() };
const id = `${build.commit}-${build.builtAt}`;

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify({ ...build, id }) },
  plugins: [{
    name: 'legon-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...build, id }) });
    },
  }],
});
