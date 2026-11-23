const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const { workbenchEndpoint, allowsNavigation, downloadName } = require('./policy.cjs');

const settings = app.isPackaged
  ? require('./distribution.json')
  : { appUrl: process.env.JINGXU_APP_URL || 'http://127.0.0.1:3000/workbench', channel: 'dev' };
const target = workbenchEndpoint(settings.appUrl, !app.isPackaged);
const origin = target.origin;
let window;
let updater;
let activeDownloads = 0;
let state = { phase: 'idle', version: app.getVersion(), channel: settings.channel };

function publish(phase, details = {}) {
  state = { phase, version: app.getVersion(), channel: settings.channel, ...details };
  if (window && !window.isDestroyed()) window.webContents.send('jingxu:update-changed', state);
}

function trusted(event) {
  const frame = event.senderFrame;
  return frame && window && !window.isDestroyed() && event.sender === window.webContents &&
    frame === window.webContents.mainFrame && allowsNavigation(frame.url, origin);
}

function installHandlers() {
  const actions = {
    status: () => state,
    check: checkUpdates,
    download: async () => {
      if (!updater || state.phase !== 'available') return;
      publish('downloading', { percent: 0 });
      try { await updater.downloadUpdate(); }
      catch { publish('error'); }
    },
    install: async () => {
      if (!updater || state.phase !== 'ready') return;
      if (activeDownloads) return { blocked: true };
      const result = await dialog.showMessageBox(window, {
        type: 'question', buttons: ['稍后', '重启并安装'], defaultId: 0, cancelId: 0,
        message: '现在安装镜序更新？',
        detail: '请先保存正在编辑的内容，确认素材已上传。已提交的云端制作任务会继续运行。',
      });
      if (result.response === 1 && !activeDownloads && !window.isDestroyed()) updater.quitAndInstall();
      return { blocked: Boolean(activeDownloads) };
    },
  };
  for (const [name, run] of Object.entries(actions)) {
    ipcMain.handle('jingxu:update-' + name, (event) => {
      if (!trusted(event)) throw new Error('不允许此页面调用桌面更新');
      return run();
    });
  }
}

async function checkUpdates() {
  if (!updater || !['idle', 'current', 'error'].includes(state.phase)) return;
  publish('checking');
  try { await updater.checkForUpdates(); }
  catch { publish('error'); }
}

function attachUpdates() {
  if (!app.isPackaged || process.platform !== 'win32' || settings.channel === 'test') return;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = settings.channel === 'beta';
  updater.on('update-available', info => publish('available', { nextVersion: info.version }));
  updater.on('update-not-available', () => publish('current'));
  updater.on('download-progress', progress => publish('downloading', { percent: Math.round(progress.percent) }));
  updater.on('update-downloaded', info => publish('ready', { nextVersion: info.version }));
  updater.on('error', () => publish('error'));
  void checkUpdates();
  setInterval(checkUpdates, 6 * 60 * 60 * 1000).unref();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 610, backgroundColor: '#141518',
    autoHideMenuBar: true, title: '镜序',
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (allowsNavigation(url, origin)) void contents.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    contents.on(event, (navigation, value) => {
      const url = navigation.url || (typeof value === 'string' ? value : value?.url);
      if (!allowsNavigation(url, origin)) navigation.preventDefault();
    });
  }
  void contents.loadURL(target.href).catch(() => {
    if (!window.isDestroyed()) dialog.showErrorBox('无法打开镜序', '请检查网络，确认镜序服务可以访问后重新打开客户端。');
  });
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(() => {
    const desktopSession = session.defaultSession;
    desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    desktopSession.setPermissionCheckHandler(() => false);
    desktopSession.on('will-download', (event, item, source) => {
      if (!window || source !== window.webContents || !allowsNavigation(source.getURL(), origin)) {
        event.preventDefault();
        return;
      }
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), downloadName(item.getFilename())) });
      activeDownloads++;
      item.once('done', () => { activeDownloads--; });
    });
    installHandlers();
    createWindow();
    attachUpdates();
  });
  app.on('window-all-closed', () => app.quit());
} else {
  app.quit();
}
