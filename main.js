const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');

let mainWindow;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function createWindow() {
  const port = await findFreePort();
  const { startServer } = require('./server');
  await startServer(port);

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: 'YouTube Downloader',
    icon: path.join(__dirname, 'public', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.setMenuBarVisibility(false);
}

ipcMain.handle('save-file', async (_event, fileId, filename) => {
  const { TEMP_DIR } = require('./server');
  const src = path.join(TEMP_DIR, fileId, filename);

  if (!fs.existsSync(src)) return { ok: false, error: 'Fichier source introuvable' };

  const downloadsDir = path.join(os.homedir(), 'Downloads');
  let dest = path.join(downloadsDir, filename);

  // Avoid overwriting: append (2), (3)…
  if (fs.existsSync(dest)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    let n = 2;
    while (fs.existsSync(dest)) {
      dest = path.join(downloadsDir, `${base} (${n})${ext}`);
      n++;
    }
  }

  fs.copyFileSync(src, dest);
  fs.rmSync(path.join(TEMP_DIR, fileId), { recursive: true, force: true });
  return { ok: true, dest };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
