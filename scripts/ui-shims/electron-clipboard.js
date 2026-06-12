/**
 * Web:Bit 安裝版（Electron）— 剪貼簿與對話框焦點 shim（Redmine #8882）
 *
 * 問題：Windows 安裝版以滑鼠右鍵反覆複製貼上積木 2-3 次後出現「無合法內容」，
 *       之後複製貼上完全失效；鍵盤快捷鍵則正常。
 *
 * 根因（兩個 Windows 特有的失效模式疊加）：
 *   1. Chromium 的 navigator.clipboard 要求視窗有焦點，否則拋出
 *      NotAllowedError: Document is not focused（即使已授權 clipboard-read）。
 *   2. Electron 在 Windows 的已知 bug：window.alert() / window.confirm()
 *      關閉後 webContents 失去鍵盤焦點。
 *      因此第一次 alert（任何來源的「無合法內容」或 confirm 刪除確認）之後，
 *      所有剪貼簿操作都因失焦而失敗——滑鼠路徑的右鍵「複製」沒有 await/catch，
 *      writeText 失敗完全無聲，貼上就讀到舊內容 → 持續跳「無合法內容」。
 *
 * 修法：
 *   1. navigator.clipboard.readText / writeText 改走 Electron 原生 clipboard
 *      模組（preload.js 的 webbitDesktop.clipboard bridge）：同步 API，
 *      不受視窗焦點與權限檢查影響，Windows 上由 Electron 處理 OLE 重試。
 *   2. window.alert / window.confirm 關閉後呼叫 webbitDesktop.refocusWindow()
 *      恢復焦點（main.js 對視窗做 blur + focus）。
 *
 * 此檔僅在 Electron 安裝版由 build-ui.mjs 注入 index.html，不影響雲端版。
 */
(function () {
  'use strict';

  var bridge = window.webbitDesktop;

  /* ---------- 1. navigator.clipboard → Electron clipboard bridge ---------- */

  if (bridge && bridge.clipboard && navigator.clipboard) {
    navigator.clipboard.readText = function () {
      return Promise.resolve().then(function () {
        return bridge.clipboard.readText();
      });
    };
    navigator.clipboard.writeText = function (text) {
      return Promise.resolve().then(function () {
        bridge.clipboard.writeText(text);
      });
    };
    // 驗證用 flag（scripts/verify-8882.mjs 會檢查）
    window.__electronClipboardBridge__ = true;
    console.log('[electron-clipboard] navigator.clipboard 已接上 Electron clipboard bridge');
  } else {
    console.warn('[electron-clipboard] webbitDesktop.clipboard 不存在，維持 Chromium 原生剪貼簿');
  }

  /* ---------- 2. alert / confirm 後恢復鍵盤焦點 ---------- */

  if (bridge && typeof bridge.refocusWindow === 'function') {
    var refocus = function () {
      try {
        bridge.refocusWindow();
      } catch (e) {
        /* ignore */
      }
    };
    var nativeAlert = window.alert.bind(window);
    window.alert = function (message) {
      try {
        return nativeAlert(message);
      } finally {
        refocus();
      }
    };
    var nativeConfirm = window.confirm.bind(window);
    window.confirm = function (message) {
      try {
        return nativeConfirm(message);
      } finally {
        refocus();
      }
    };
    console.log('[electron-clipboard] alert/confirm 焦點恢復已啟用');
  }
})();
