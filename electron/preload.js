/**
 * Preload script（contextIsolation 環境）
 *
 * 注意：安裝版設定（window.isInstalledVersion__ / window.origin__）是在建置時直接寫入
 * index.html（見 scripts/build-ui.mjs patchIndexHtml），不在這裡設定——
 * 因為頁面內的 inline script 執行順序在 preload 之後，會覆蓋這裡設定的值。
 */
'use strict';

const { contextBridge, clipboard, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webbitDesktop', {
  platform: process.platform,
  appVersion: process.env.npm_package_version || '',

  // 剪貼簿 bridge（Redmine #8882）：
  // Chromium 的 navigator.clipboard 要求視窗有焦點（Document is not focused），
  // Windows 上 alert/confirm 關閉後焦點遺失，積木複製貼上會整個失效。
  // Electron 的 clipboard 模組為同步 API，不受焦點與權限檢查影響。
  clipboard: {
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(String(text ?? '')),
  },

  // alert/confirm 關閉後恢復鍵盤焦點（Electron 在 Windows 的已知 bug：
  // 原生對話框關閉後 webContents 失去焦點，需 blur + focus 才能復原）
  refocusWindow: () => ipcRenderer.invoke('webbit:refocus'),
});

/* ------------------------- USB 裝置偵測（視窗標題提示） ------------------------- */
// 還原舊版（NW.js）行為：偵測到 Web:Bit USB 裝置時，在視窗標題列（左上方）顯示提示。
// 主程序 setDevicePermissionHandler 已授予 serial 權限，
// 因此 getPorts() 不需使用者手勢即可列出序列埠，connect/disconnect 事件也會在插拔時觸發。

// Web:Bit 開發板 USB vendor ID（同 electron/main.js WEBBIT_VENDOR_IDS）
const WEBBIT_VENDOR_IDS = [6790, 12346]; // v1: CH340 / v2: ESP32-S2 USB CDC

// 標題提示文字（依 UI 語言 ?lang= 決定）
const DETECTED_MSG = {
  'zh-hant': '已偵測到 USB 裝置',
  en: 'USB device detected',
};

window.addEventListener('DOMContentLoaded', () => {
  if (!('serial' in navigator)) {
    console.warn('[webbit-preload] Web Serial API 不可用，停用 USB 裝置偵測');
    return;
  }
  console.log('[webbit-preload] USB 裝置偵測已啟用');

  const lang = new URLSearchParams(location.search).get('lang');
  const detectedMsg = DETECTED_MSG[lang] || DETECTED_MSG['zh-hant'];
  const suffix = ' - ' + detectedMsg;

  const hasWebbitDevice = async () => {
    const ports = await navigator.serial.getPorts();
    return ports.some((port) => WEBBIT_VENDOR_IDS.includes(port.getInfo().usbVendorId));
  };

  const updateTitle = async () => {
    try {
      const connected = await hasWebbitDevice();
      // 頁面（code.js）會自行設定 title，故每次都以「目前標題去掉提示字」為基底
      const base = document.title.split(suffix)[0];
      const next = connected ? base + suffix : base;
      if (document.title !== next) document.title = next;
    } catch {
      /* ignore：無 serial 權限或列舉失敗時不影響頁面 */
    }
  };

  // 插拔事件 + 定期同步（涵蓋頁面改寫 title、事件未觸發的情況）
  navigator.serial.addEventListener('connect', updateTitle);
  navigator.serial.addEventListener('disconnect', updateTitle);
  setTimeout(updateTitle, 3000); // 等頁面初始化完 title 後做第一次檢查
  setInterval(updateTitle, 3000);
});
