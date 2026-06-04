/**
 * 原生選單（語系：zh-hant / en，跨平台：Windows / macOS）
 *
 * 與原 Windows 版（NW.js）的差異：
 *   - 韌體更新、WiFi 設定、MQTT 設定、USB 連線等功能已內建在新版 Blockly UI 中
 *     （Web Serial + esp-web-flasher），不再需要選單項目。
 *   - 保留：以瀏覽器開啟、語言切換、版本資訊、說明、USB 驅動安裝（Windows）。
 */
'use strict';

const { app, Menu, shell, dialog } = require('electron');
const path = require('path');
const { _, getLang, setLang } = require('./i18n');

const CLOUD_URL = 'https://webbit.webduino.io/blockly/';
const TUTORIAL_URL = 'https://resource.webduino.io/';
const OFFICIAL_URL = 'https://webduino.io/';

const isMac = process.platform === 'darwin';

/** 切換 UI 與選單語言：改 URL ?lang= 參數後重新載入 */
function switchLanguage(win, lang) {
  setLang(lang);
  buildMenu(win);
  if (!win || win.isDestroyed()) return;
  const url = new URL(win.webContents.getURL());
  url.searchParams.set('lang', lang);
  win.loadURL(url.toString());
}

function showAbout(win) {
  dialog.showMessageBox(win, {
    type: 'info',
    title: _('ABOUT'),
    message: _('APPNAME'),
    detail: `${_('VERSION')}${app.getVersion()}\nElectron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
    buttons: ['OK'],
  });
}

function showHelp(win) {
  dialog.showMessageBox(win, {
    type: 'info',
    title: _('HELP'),
    message: _('APPNAME'),
    detail: _('HELP_MSG'),
    buttons: ['OK'],
  });
}

/** Windows：執行 CH340 USB 驅動安裝程式（v1 開發板需要） */
function installUsbDriver(win) {
  const driverSetup = app.isPackaged
    ? path.join(process.resourcesPath, 'drivers', 'usb_driver', 'SETUP.EXE')
    : path.join(__dirname, '..', 'drivers', 'usb_driver', 'SETUP.EXE');

  shell.openPath(driverSetup).then((err) => {
    if (err) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: _('INSTALL_USB_DRIVER'),
        message: err,
        buttons: ['OK'],
      });
    }
  });
}

function buildMenu(win) {
  const lang = getLang();

  const template = [
    // App 選單（僅 macOS）
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: _('ABOUT'), click: () => showAbout(win) },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { label: _('EXIT'), role: 'quit', accelerator: 'Cmd+Q' },
            ],
          },
        ]
      : []),
    // 檔案
    {
      label: _('FILE'),
      submenu: [
        {
          label: _('OPEN_BY_BROWSER'),
          click: () => shell.openExternal(`${CLOUD_URL}?lang=${lang}`),
        },
        { type: 'separator' },
        ...(isMac
          ? [{ label: _('CLOSE_WINDOW'), role: 'close' }]
          : [{ label: _('EXIT'), role: 'quit' }]),
      ],
    },
    // 編輯（積木文字輸入需要）
    {
      label: _('EDIT'),
      submenu: [
        { label: _('UNDO'), role: 'undo' },
        { label: _('REDO'), role: 'redo' },
        { type: 'separator' },
        { label: _('CUT'), role: 'cut' },
        { label: _('COPY'), role: 'copy' },
        { label: _('PASTE'), role: 'paste' },
        { label: _('SELECT_ALL'), role: 'selectAll' },
      ],
    },
    // 檢視
    {
      label: _('VIEW'),
      submenu: [
        { label: _('RELOAD'), role: 'reload' },
        { label: _('FORCE_RELOAD'), role: 'forceReload' },
        { type: 'separator' },
        { label: _('ZOOM_IN'), role: 'zoomIn' },
        { label: _('ZOOM_OUT'), role: 'zoomOut' },
        { label: _('ZOOM_RESET'), role: 'resetZoom' },
        { type: 'separator' },
        { label: _('FULLSCREEN'), role: 'togglefullscreen' },
        { type: 'separator' },
        { label: _('DEVTOOLS'), role: 'toggleDevTools' },
      ],
    },
    // 語言
    {
      label: _('LANGUAGE'),
      submenu: [
        {
          label: _('SWITCH_TO_TC'),
          type: 'radio',
          checked: lang === 'zh-hant',
          click: () => switchLanguage(win, 'zh-hant'),
        },
        {
          label: _('SWITCH_TO_EN'),
          type: 'radio',
          checked: lang === 'en',
          click: () => switchLanguage(win, 'en'),
        },
      ],
    },
    // 視窗（僅 macOS 慣例需要）
    ...(isMac
      ? [
          {
            label: _('WINDOW'),
            submenu: [
              { label: _('MINIMIZE'), role: 'minimize' },
              { label: _('ZOOM'), role: 'zoom' },
              { type: 'separator' },
              { role: 'front' },
            ],
          },
        ]
      : []),
    // 資訊
    {
      label: _('INFO'),
      submenu: [
        { label: `${_('VERSION')}${app.getVersion()}`, enabled: false },
        ...(isMac ? [] : [{ label: _('ABOUT'), click: () => showAbout(win) }]),
        { label: _('HELP'), click: () => showHelp(win) },
        { type: 'separator' },
        // Windows：CH340 USB 驅動安裝（v1 開發板）
        ...(isMac ? [] : [{ label: _('INSTALL_USB_DRIVER'), click: () => installUsbDriver(win) }, { type: 'separator' }]),
        { label: _('OFFICIAL_SITE'), click: () => shell.openExternal(OFFICIAL_URL) },
        { label: _('TUTORIAL_DOCS'), click: () => shell.openExternal(TUTORIAL_URL) },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu, switchLanguage };
