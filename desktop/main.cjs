// Desktop shell: opens the self-contained q-rex.html in a native window (fully offline).
// `q-rex --selftest [--selftest-shot=file.png]` loads the home page and the workstation, checks that they render and that the
// tracker locks, prints a JSON result and exits 0 (ok) / 1 (check failed) / 2 (error) / 3 (timeout). Used by the CI smoke tests.
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const selftest = process.argv.includes('--selftest');
const shotArg = process.argv.find((a) => a.startsWith('--selftest-shot='));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({ width: 1500, height: 950, title: 'Q-Rex FSOC Tracker', backgroundColor: '#f3f2ee', webPreferences: { backgroundThrottling: false } });
  win.loadFile(path.join(__dirname, 'q-rex.html'));
  if (!selftest) return;

  const timeout = setTimeout(() => { console.log(JSON.stringify({ selftest: 'timeout' })); app.exit(3); }, 90000);
  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(1500);
      const home = await win.webContents.executeJavaScript("({ hero: !!document.querySelector('.hhero'), diagrams: document.querySelectorAll('.diagram').length, fonts: document.fonts.check('700 16px \"Space Grotesk\"') })");
      await win.webContents.executeJavaScript("window.location.hash = '#/app'");
      await sleep(6000); // ~6 s of real-time simulation
      const ws = await win.webContents.executeJavaScript(`(() => ({
        camera: !!document.querySelector('canvas.cam'),
        tiles: document.querySelectorAll('.tile').length,
        state: (document.querySelector('.status') || {}).textContent || '',
        acquisition: ((document.querySelector('.tile .tile-value') || {}).textContent || '')
      }))()`);
      if (shotArg) { const img = await win.webContents.capturePage(); fs.writeFileSync(shotArg.split('=')[1], img.toPNG()); }
      const ok = home.hero && home.diagrams >= 2 && ws.camera && ws.tiles >= 6 && /TRACK/.test(ws.state);
      console.log(JSON.stringify({ selftest: ok ? 'pass' : 'fail', platform: process.platform, arch: process.arch, electron: process.versions.electron, home, ws }));
      clearTimeout(timeout);
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.log(JSON.stringify({ selftest: 'error', message: String(e) }));
      app.exit(2);
    }
  });
});
app.on('window-all-closed', () => app.quit());
