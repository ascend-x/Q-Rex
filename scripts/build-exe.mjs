// Builds the standalone desktop application into release/.
// usage: node scripts/build-exe.mjs [platform] [arch]   (platform: linux | win32 | darwin)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
execSync('npm run build:single', { stdio: 'inherit' });
fs.copyFileSync('dist-single/q-rex.html', 'desktop/q-rex.html');
const { packager } = await import('@electron/packager');
const out = await packager({ dir: 'desktop', out: 'release', name: 'q-rex', platform, arch, overwrite: true, asar: true, quiet: true });
console.log('built', out);
