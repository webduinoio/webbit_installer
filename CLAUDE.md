# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

Web:Bit 教育版 Windows 安裝程式（Electron 42 + electron-builder/NSIS，win-x64）。
UI 原始碼來自上層目錄的 `../simulator-bit-edu`（雲端版 https://webbit.webduino.io/blockly/ 的原始碼），本 repo 將其建置成離線可用的本地版本。

**與 `../webbit_installer_mac` 共用相同架構與程式碼：修改 `electron/` 或 `scripts/` 時必須同步兩個 repo。**

根目錄的 `WebBitSetup.exe` 與 `WebBitOTA/` 是 2022 年 NW.js 舊版的遺留檔案，僅供參考，不要修改。

## 常用指令

```bash
# 前置：上層目錄需有 simulator-bit-edu repo
npm install
cd ui-deps && npm install --legacy-peer-deps && cd ..

npm run build:ui         # 建置 Blockly UI → app-ui/blockly/（需網路：下載韌體 .bin）
npm run build:simulator  # 從雲端正式站鏡像模擬器 → app-ui/blockly/simulator/（需網路）
npm run build:all        # 上面兩者

npm start                # 開發執行（macOS / Windows 皆可；需先 build:all）
npm run dist             # 打包 Windows 安裝程式 → release/WebBitSetup-<version>-x64.exe
npm run clean            # 刪除 app-ui/ 與 release/
```

沒有測試與 lint 設定。建置驗證方式：

- `build-ui.mjs` 結尾的 `verifyOutput()` 會檢查 index.html 與 runtime 引用的所有本地資源是否存在
- `WEBBIT_VERIFY=/tmp/shot.png npm start` — 載入完成 10 秒後自動截圖並結束，確認 UI 正常渲染
- 完整功能（CH340 驅動、USB 連線、燒錄）需在實際 Windows 機器測試（清單見 README.md）

## 架構

執行時的流程（`electron/main.js`）：

1. express 靜態伺服器（port 20975 起，被占用則往上遞增）服務建置好的 `app-ui/`（打包後在 `process.resourcesPath/app-ui`）
2. BrowserWindow 載入 `http://127.0.0.1:<port>/blockly/?lang=<lang>`
3. USB 連線與韌體燒錄由 UI 端的 Web Serial API + esp-web-flasher 完成；主程序只負責權限白名單與 `select-serial-port` 自動選擇 Web:Bit 開發板（vendorId 6790 = CH340 v1 板、12346 = ESP32-S2 v2 板）
4. `preload.js` 用 `navigator.serial.getPorts()` 偵測開發板插拔，在視窗標題列顯示提示

建置時的流程（`scripts/build-ui.mjs`，取代舊的 bower + gulp）：

- `../simulator-bit-edu/client/public/blockly` 的 `src/**/*.js` → esbuild minify → `dist/**/*.min.js`；less 編譯 → `dist/css/`
- npm 套件（`ui-deps/node_modules`）依 `COMPONENTS_MAP` 佈局成 bower 時代的 `components/` 路徑
- 韌體 .bin 從 wafirmata GitHub Pages 下載打包，並改寫 `vue-enum.min.js` 中的韌體網址為本地路徑（燒錄不需網路）
- `patchIndexHtml()` 注入安裝版設定與 Electron prompt shim（`scripts/ui-shims/`）

`scripts/mirror-simulator.mjs`：模擬器（私有 repo，parcel 1.x 建置）無法在新版 Node 重建，因此直接從雲端正式站鏡像已建置的輸出。

## 關鍵限制（違反會壞掉）

- **本地伺服器絕對不可加 SPA catch-all fallback**：UI 的 boot.js 靠 `fetch('/auth/isLogin')` 收到 404 來判定安裝版模式（免登入、隱藏雲端功能）。`/api`、`/auth`、`/mlapi` 必須回 JSON 格式的 404。
- **`window.isInstalledVersion__` 必須建置為 `false`**：`true` 是舊版 NW.js 專用，會讓 USB 積木改連不存在的 127.0.0.1:8080 橋接服務，導致 USB 完全無法用。安裝版模式由 404 觸發，與此 flag 無關。
- **安裝版設定要寫在 index.html（建置時），不能放 preload.js**：頁面 inline script 在 preload 之後執行，會覆蓋 preload 設定的值。
- **Express 5 的 `app.listen()` 不可直接傳 callback**：callback 會同時被註冊成 error handler，EADDRINUSE 時照樣 resolve 到錯的 port。要用 `listener.once('listening'/'error')`（見 main.js `tryListen`）。
- **權限白名單需含 `clipboard-read`**：積木 Ctrl+V 貼上依賴它，缺了會 NotAllowedError。
- `build-ui.mjs` 對 index.html 的修改採嚴格 regex 比對，simulator-bit-edu 改版導致比對失敗時會直接 throw — 屆時需更新 `patchIndexHtml()`。

## 語言慣例

程式碼註解、commit message、文件皆使用正體中文（技術名詞保留原文）。
