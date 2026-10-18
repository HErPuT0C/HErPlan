const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const autobench = process.argv.includes('--autobench');
const reportPath = process.env.HERPLAN_REPORT_PATH || path.resolve('herplan-report.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'HErPlan — прототип (Electron)',
    backgroundColor: '#14161b',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'web', 'index.html'), autobench ? { hash: 'autobench' } : undefined);
}

ipcMain.handle('report', (_event, json) => fs.writeFileSync(reportPath, json));
ipcMain.handle('quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
