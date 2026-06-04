/**
 * Web:Bit 安裝版 — Electron 主程序（跨平台：Windows / macOS）
 *
 * 架構：
 *   1. express 靜態伺服器（port 20975 起）提供建置好的 Blockly UI（離線可用）
 *   2. BrowserWindow 載入 http://127.0.0.1:<port>/blockly/?lang=<lang>
 *   3. Web Serial API 支援：USB 連線、韌體燒錄、WiFi 設定皆由 UI 端完成
 *      （新版 simulator-bit-edu 已內建，主程序只需處理裝置選擇與權限）
 *
 * 安裝版模式偵測：UI 的 boot.js 會 fetch('/auth/isLogin')，
 * 本伺服器沒有此路由 → 回 404 → UI 自動進入安裝版模式（免登入、隱藏雲端功能）。
 * 因此【絕對不可】加入 SPA catch-all fallback。
 */
'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { detectSystemLang, setLang, getLang } = require('./i18n');
const { buildMenu } = require('./menu');

// UI 靜態檔案根目錄（開發 vs 打包後路徑不同）
const UI_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app-ui')
  : path.join(__dirname, '..', 'app-ui');

const BASE_PORT = 20975; // 沿用原 NW.js 版的 port
const MAX_PORT_RETRY = 20;

// Web:Bit 開發板 USB vendor ID（同 simulator-bit-edu vue-enum.js）
//   v1: CH340 (0x1A86 = 6790)
//   v2: ESP32-S2 USB CDC (0x303A = 12346)
const WEBBIT_VENDOR_IDS = [6790, 12346];

let mainWindow = null;
let httpServer = null;
let serverPort = BASE_PORT;

/* ------------------------------ 設定檔（記住語言） ------------------------------ */

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('無法寫入設定檔：', err);
  }
}

/* ------------------------------ 靜態伺服器 ------------------------------ */

function startServer() {
  return new Promise((resolve, reject) => {
    const server = express();

    // 純靜態檔案服務；不存在的路徑（含 /auth/*、/api/*）回 404
    server.use(
      express.static(UI_ROOT, {
        index: ['index.html'],
        fallthrough: true,
      })
    );

    // 雲端 API 路由在安裝版不存在：回 JSON 格式的 404，
    // 讓 UI 端 response.json() 不會因收到 HTML 錯誤頁而拋出例外。
    // （/auth/isLogin 也回 404 → boot.js 判定為安裝版模式，這是預期行為）
    server.use(['/api', '/auth', '/mlapi'], (_req, res) => {
      res.status(404).json({ error: { statusCode: 404, message: 'offline (installed version)' } });
    });

    // 注意：不可把 callback 直接傳給 express 的 app.listen() ——
    // Express 5 會把該 callback 同時註冊成 error handler（server.once('error', done)），
    // 導致 port 被占用（EADDRINUSE）時 callback 照樣執行、resolve 到錯誤的 port，
    // 視窗就會載入「占用該 port 的其他程式」的網頁（例如舊版 Web:Bit 或其他本機服務）。
    const tryListen = (port, attempt) => {
      const listener = server.listen(port, '127.0.0.1');
      listener.once('listening', () => {
        console.log(`UI 伺服器啟動：http://127.0.0.1:${port}/blockly/`);
        resolve({ listener, port });
      });
      listener.once('error', (err) => {
        listener.close();
        if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRY) {
          console.log(`port ${port} 已被占用，改試 ${port + 1}`);
          tryListen(port + 1, attempt + 1);
        } else {
          reject(err);
        }
      });
    };
    tryListen(BASE_PORT, 0);
  });
}

/* ------------------------------ Web Serial ------------------------------ */

function setupWebSerial(win) {
  const ses = win.webContents.session;

  // Web Serial 權限
  ses.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'serial';
  });

  ses.setDevicePermissionHandler((details) => {
    return details.deviceType === 'serial';
  });

  // 裝置選擇：UI 呼叫 navigator.serial.requestPort({filters}) 時觸發。
  // Chromium 已先依 filters（usbVendorId）過濾 portList，
  // 這裡自動選擇第一個 Web:Bit 裝置，使用者不需再看到系統選擇視窗。
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();

    const isWebbit = (port) => {
      const vid = parseInt(port.vendorId, 10);
      return WEBBIT_VENDOR_IDS.includes(vid);
    };

    const matched = portList.find(isWebbit) || portList[0];
    if (matched) {
      console.log(`選擇序列埠：${matched.portName || matched.portId} (vendorId=${matched.vendorId})`);
      callback(matched.portId);
    } else {
      console.log('找不到 Web:Bit 裝置');
      callback(''); // UI 端會收到 NotFoundError 並顯示「未偵測到裝置」
    }
  });

  // USB 熱插拔 log（Chromium 會自動對已連線的 port 發出 disconnect 事件）
  ses.on('serial-port-added', (_event, port) => {
    console.log('USB 裝置插入：', port.portName || port.portId);
  });
  ses.on('serial-port-removed', (_event, port) => {
    console.log('USB 裝置移除：', port.portName || port.portId);
  });
}

/* ------------------------------ 主視窗 ------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Web:Bit',
    // Windows 工作列/視窗圖示（macOS 由 app bundle 提供，不需設定）
    ...(process.platform === 'win32'
      ? { icon: path.join(__dirname, '..', 'build', 'icon.ico') }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  setupWebSerial(mainWindow);
  buildMenu(mainWindow);

  // 外部連結（教學文件、商店、分享）一律用系統瀏覽器開啟
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isLocal = url.startsWith(`http://127.0.0.1:${serverPort}`) || url.startsWith(`http://localhost:${serverPort}`);
    if (!isLocal) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 載入 UI
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/blockly/?lang=${getLang()}`);

  // 驗證模式（建置驗證用）：WEBBIT_VERIFY=<截圖輸出路徑> npm start
  // 載入完成 10 秒後截圖存檔並結束，供確認 UI 是否正常渲染
  if (process.env.WEBBIT_VERIFY) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.WEBBIT_VERIFY, image.toPNG());
          console.log(`VERIFY: 截圖已存至 ${process.env.WEBBIT_VERIFY}`);
        } catch (err) {
          console.error('VERIFY: 截圖失敗', err);
        }
        app.quit();
      }, 10000);
    });
  }

  // UI 內切換語言（?lang=）時同步選單語言
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    try {
      const lang = new URL(url).searchParams.get('lang');
      if (lang && lang !== getLang()) {
        setLang(lang);
        buildMenu(mainWindow);
        saveConfig({ ...loadConfig(), lang });
      }
    } catch {
      /* ignore */
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/* ------------------------------ App 生命週期 ------------------------------ */

// Windows：避免重複開啟多個實例（port 衝突）
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 語言：上次選擇 > 系統語系
    const config = loadConfig();
    setLang(config.lang || detectSystemLang(app.getLocale()));

    // 確認 UI 已建置
    if (!fs.existsSync(path.join(UI_ROOT, 'blockly', 'index.html'))) {
      dialog.showErrorBox(
        'Web:Bit',
        `找不到 UI 檔案（${UI_ROOT}）。\n\n開發模式請先執行：\n  npm run build:all`
      );
      app.quit();
      return;
    }

    try {
      const { listener, port } = await startServer();
      httpServer = listener;
      serverPort = port;
    } catch (err) {
      dialog.showErrorBox('Web:Bit', `無法啟動本地伺服器：${err.message}`);
      app.quit();
      return;
    }

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('quit', () => {
  if (httpServer) httpServer.close();
});
