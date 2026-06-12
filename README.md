# Web:Bit 安裝版 for Windows

Web:Bit 教育版 Windows 安裝程式（x64），以現代工具鏈重新打造，
取代 2022 年的 NW.js 舊版（`WebBitSetup.exe`，保留於本 repo 供參考）。

| 元件 | 舊版（2022） | 本版 |
|------|-------------|------|
| 桌面框架 | NW.js 0.36.2 (win-ia32) | Electron 42 (win-x64) |
| 打包 | 手刻 NSIS 腳本 | electron-builder → NSIS 安裝程式 |
| 前端套件管理 | bower（已停止維護） | npm |
| 前端建置 | gulp + gulp-uglify | esbuild + less |
| USB 連線 | chrome.serial + node-serialport | Web Serial API（UI 內建） |
| 韌體燒錄 | esptool.exe | esp-web-flasher（UI 內建，瀏覽器端燒錄） |
| CH340 驅動 | NSIS 安裝時靜默執行 | 同樣保留（installer.nsh），App 選單也可手動安裝 |

UI 來源為 `../simulator-bit-edu`（即雲端版 https://webbit.webduino.io/blockly/ 的原始碼），
本版將其建置為離線可用的本地版本。與 macOS 版（`../webbit_installer_mac`）共用相同架構與程式碼。

## 檔案說明

```
webbit_installer/
├── WebBitSetup.exe        # 【舊版】2022 NW.js 安裝程式（git-lfs，保留參考）
├── WebBitOTA/             # 【舊版】OTA 更新檔（OTA 伺服器已停用）
│
├── electron/              # Electron 主程序（跨平台 Windows / macOS）
│   ├── main.js            #   express 伺服器、視窗、Web Serial、單一實例鎖
│   ├── menu.js            #   原生選單（zh-hant / en；Windows 含 USB 驅動安裝項目）
│   ├── i18n.js            #   選單在地化
│   └── preload.js         #   USB 裝置偵測（視窗標題提示）
├── i18n/                  # 選單語系檔（en / zh-hant；簡體中文已移除）
├── scripts/
│   ├── build-ui.mjs       # UI 建置（取代 bower + gulp）
│   └── mirror-simulator.mjs  # 模擬器雲端鏡像
├── ui-deps/               # 前端相依套件（npm 取代 bower）
├── drivers/usb_driver/    # CH340 USB 驅動（v1 開發板用）
├── build/
│   ├── icon.ico           # App 圖示（多解析度）
│   └── installer.nsh      # NSIS 自訂腳本（安裝時靜默裝 CH340 驅動）
├── app-ui/                # 建置輸出（gitignore）
└── release/               # 安裝程式輸出（gitignore）
    └── WebBitSetup-2.0.5-x64.exe
```

## 系統需求

- **執行**：Windows 10 / 11（64 位元）
- **建置**：Node.js 20+（macOS / Linux / Windows 皆可建置）、上層目錄需有 `simulator-bit-edu` repo

## 建置步驟

```bash
# 0. 確認上層目錄已 clone simulator-bit-edu
#    git clone https://github.com/webduinoio/simulator-bit-edu.git ../simulator-bit-edu

# 1. 安裝相依套件
npm install
cd ui-deps && npm install --legacy-peer-deps && cd ..

# 2. 建置 UI + 鏡像模擬器
npm run build:all

# 3.（開發）直接執行（macOS / Windows 皆可）
npm start

# 4. 打包 Windows 安裝程式（在 macOS / Linux 上會自動下載 Windows 版 Electron 與 NSIS 工具）
npm run dist
# 產出：release/WebBitSetup-2.0.5-x64.exe
```

## 安裝方式（給使用者）

1. 執行 `WebBitSetup-2.0.5-x64.exe`
2. 安裝程式會要求系統管理員權限（需要安裝到 Program Files 與 CH340 驅動）
3. 可自選安裝路徑；安裝過程會自動靜默安裝 CH340 USB 驅動
4. 完成後桌面與開始選單會有「Web:Bit」捷徑
5. **未簽章**：Windows SmartScreen 可能顯示「Windows 已保護您的電腦」→
   點「**其他資訊**」→「**仍要執行**」

## 運作原理

1. **離線 UI**：`build-ui.mjs` 把 `simulator-bit-edu/client/public/blockly` 的原始碼以 esbuild
   minify 成 `dist/`、用 less 編譯樣式、把 npm 套件佈局成 bower 的 `components/` 路徑、
   下載韌體 .bin 檔到本地（燒錄時不需網路）。
2. **安裝版模式**：UI 啟動時 `fetch('/auth/isLogin')` 收到 404 → 自動進入安裝版模式
   （免登入、隱藏雲端功能）。因此本地伺服器**不可**加入 SPA fallback。
3. **USB / 韌體燒錄**：新版 UI 內建 Web Serial 與 esp-web-flasher，
   Electron 主程序只負責 `select-serial-port` 自動選擇 Web:Bit 開發板
   （CH340 vendorId 6790 / ESP32-S2 vendorId 12346）。
   注意：`window.isInstalledVersion__` 必須建置為 `false`（見 build-ui.mjs patchIndexHtml）——
   `true` 是舊版 NW.js 專用，USB 積木會改連不存在的 127.0.0.1:8080 橋接服務，導致 USB 無法執行。
4. **USB 裝置偵測**：preload.js 透過 `navigator.serial.getPorts()` 偵測 Web:Bit 開發板插拔，
   並在視窗標題列顯示「已偵測到 USB 裝置」（還原舊版 NW.js 的行為）。

## Windows 實機測試清單

本安裝程式在 macOS 上跨平台建置，**請在實際 Windows 電腦上完成以下測試**：

- [ ] 執行 `WebBitSetup-2.0.5-x64.exe`，完成安裝（含 UAC 提權）
- [ ] CH340 驅動於安裝過程自動安裝成功（裝置管理員可確認）
- [ ] 開啟 Web:Bit：Blockly 編輯器與模擬器正常顯示
- [ ] 斷網狀態下開啟：依然正常（離線模式）
- [ ] 接上 Web:Bit 開發板（v1 與 v2），點 UI 右上角 USB 圖示可連線
- [ ] 韌體更新功能可正常燒錄
- [ ] 選單「語言」切換正常
- [ ] 選單「資訊 → 安裝 USB 驅動程式」可手動執行驅動安裝
- [ ] 解除安裝程式正常運作

## 已知限制

1. **雲端功能不可用**（與舊版安裝版相同）：登入、雲端存檔、分享連結、創意範例——
   UI 在安裝版模式會自動隱藏這些功能
2. **部分積木需要網路**：AI 影像辨識、Google 試算表、氣象資訊、LINE 等
3. **未簽章**：SmartScreen 會出現警告（如需大量發布，建議購買 Windows 程式碼簽章憑證，
   在 package.json 的 `build.win` 加入憑證設定）
4. **韌體版本**：韌體 .bin 在建置時下載打包（目前 1.3.0_0525_01），
   更新韌體版本需重新執行 `npm run build:ui` 並重新打包
5. **僅支援 64 位元 Windows**：如需 32 位元，需在 `build.win.target.arch` 加入 `ia32`
   （但 Electron 對 ia32 的支援已逐步淘汰，不建議）
6. **OTA 自動更新未實作**：舊版的 ota.webduino.io 伺服器已停用；
   如需自動更新可改用 electron-updater + GitHub Releases

## 與其他 repo 的關係

- **`../webbit_installer_mac`**：macOS 版（相同架構、共用程式碼）；
  修改 electron/ 或 scripts/ 時請同步兩邊
- **`../simulator-bit-edu`**：UI 原始碼；改完後重新執行 `npm run build:ui`
- **`../webbit-desktop`**：舊版 NW.js 原始碼（已不再使用，保留參考）
- **`WebBitSetup.exe`（本 repo 根目錄）**：舊版安裝程式，保留供舊專案參考
