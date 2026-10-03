// Desktop shell: opens the self-contained q-rex.html in a native window (fully offline).
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({ width: 1500, height: 950, title: 'Q-Rex FSOC Tracker', backgroundColor: '#f3f2ee', webPreferences: { backgroundThrottling: false } });
  win.loadFile(path.join(__dirname, 'q-rex.html'));
});
app.on('window-all-closed', () => app.quit());
