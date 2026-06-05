#!/usr/bin/env node
/**
 * Web:Bit 安裝版 for Mac — UI 建置腳本
 *
 * 以現代工具 (npm + esbuild + less) 取代舊的 bower + gulp 建置管線，
 * 從 ../simulator-bit-edu/client/public/blockly 建置出離線可用的 Blockly UI。
 *
 * 對應原本 simulator-bit-edu/gulpfile.js 的工作：
 *   - uglify             → esbuild minify (src/**\/*.js → dist/**\/*.min.js)
 *   - uglify-customBlocks → 複製 custom-blocks → dist/custom-blocks
 *   - less               → less 編譯 → dist/css/
 *   - argv (env 注入)     → environmentConfig.js 變數替換
 *   - pack-index/rev      → index.html ?rev=@@hash 替換
 *   - bower components    → ui-deps (npm) 佈局到 components/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import less from 'less';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, '../simulator-bit-edu/client/public/blockly');
const SRC_JS = path.join(SRC, 'src');
const DEPS = path.join(ROOT, 'ui-deps/node_modules');
const OUT = path.join(ROOT, 'app-ui/blockly');
const OUT_DIST = path.join(OUT, 'dist');

// Electron 專屬 shim（不在 simulator-bit-edu 內，由本 repo 維護並注入 index.html）
const SHIM_DIR = path.join(__dirname, 'ui-shims');
const ELECTRON_DIALOG_SHIM = 'electron-dialog.js'; // 修 Electron 無 window.prompt → 建立變數無視窗

const BUILD_TIME = new Date().toISOString();
const REV = Date.now().toString(36);

// production 環境設定（參照 simulator-bit-edu/env.config.js）
const ENV_CONFIG = {
  ENV: 'production',
  BUILD_TIME,
  TEMPO_FOREST_COMPLETE_URL: 'https://tech.st.tc.edu.tw/microservice/certify/flextask/complete',
  TEMPO_FOREST_HOME: 'https://tech.st.tc.edu.tw/manager/certify/studytask/student/list',
};

// 韌體離線化：建置時下載，燒錄時不需網路
const FIRMWARE_BASE = 'https://webduinoio.github.io/wafirmata/';
const FIRMWARE_FILES = [
  'bit_default.bin',
  'bit_boot_app1.bin',
  'bit_s2_default.bin',
  'bit_s2_boot_app1.bin',
  'bit_version.last',
  'bit_s2_version.last',
];

// 原樣複製的靜態目錄
const STATIC_DIRS = [
  'blocks', 'generators', 'css', 'fonts', 'msg', 'media',
  'samples', 'toolbox', 'templates', 'views', 'locales', 'custom-blocks',
];

// 原樣複製的根目錄檔案
const STATIC_FILES = [
  'favicon.ico', 'webduino.ico', 'launcher.html',
  'live-preview.html', 'live-preview-content.html',
  'prettify.css', 'prettify-tomorrow.css', 'telegram-settings.html',
  // index.html:53 直接引用原始 src/ 路徑（不經過 dist/）
  'src/goog-closure-shim.js',
];

// bower → npm 對應表：components/<bower 路徑> ← ui-deps/node_modules/<npm 路徑>
const COMPONENTS_MAP = {
  'jquery/dist/jquery.min.js': 'jquery/dist/jquery.min.js',
  // templates/default.html:7（網頁預覽模板）
  'jquery-ui/themes/base/jquery-ui.min.css': 'jquery-ui/dist/themes/base/jquery-ui.min.css',
  'axios/dist/axios.min.js': 'axios/dist/axios.min.js',
  'js-cookie/src/js.cookie.js': 'js-cookie/src/js.cookie.js',
  'i18next/i18next.min.js': 'i18next/i18next.min.js',
  'i18next-browser-languagedetector/i18nextBrowserLanguageDetector.min.js':
    'i18next-browser-languagedetector/i18nextBrowserLanguageDetector.min.js',
  'i18next-xhr-backend/i18nextXHRBackend.min.js': 'i18next-xhr-backend/i18nextXHRBackend.min.js',
  'jquery-i18next/jquery-i18next.min.js': 'jquery-i18next/jquery-i18next.min.js',
  // bower 套件名 webcomponentsjs = npm 套件名 webcomponents.js
  'webcomponentsjs/webcomponents-lite.min.js': 'webcomponents.js/webcomponents-lite.min.js',
};

// bower-only 套件（無 package.json，無法用 npm 安裝）→ 從 GitHub raw 下載
const COMPONENTS_DOWNLOAD = {
  'querystring/querystring.min.js':
    'https://raw.githubusercontent.com/mingzeke/querystring/master/querystring.min.js',
};

// node_modules 子集（index.html 與 runtime 直接引用）
const NODE_MODULES_COPY = [
  // index.html
  'vue/dist/vue.global.prod.js',
  'vee-validate/dist/vee-validate.iife.js',
  'vue-social-sharing/dist/vue-social-sharing.js',
  'blockly/blockly_compressed.js',
  'blockly/blocks_compressed.js',
  'blockly/javascript_compressed.js',
  // code.js:1115 Blockly inject media、code.js:2358 語系檔
  'blockly/media',
  'blockly/msg',
  // live-preview-content.html
  'js-beautify/js/lib/beautifier.min.js',
];

/* ---------------------------------- utils ---------------------------------- */

const log = (...args) => console.log('[build-ui]', ...args);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copy(src, dest) {
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function download(url, dest, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      log(`  ⚠ 下載失敗（第 ${attempt} 次），重試中... ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/* ---------------------------------- steps ---------------------------------- */

// 1. 清空輸出目錄（保留 simulator/，由 mirror-simulator.mjs 另行產生）
function clean() {
  if (fs.existsSync(OUT)) {
    for (const entry of fs.readdirSync(OUT)) {
      if (entry === 'simulator') continue;
      rmrf(path.join(OUT, entry));
    }
  }
  ensureDir(OUT);
  log('清空輸出目錄（保留 simulator/）');
}

// 2. 複製靜態檔案
function copyStatic() {
  for (const dir of STATIC_DIRS) {
    const from = path.join(SRC, dir);
    if (!fs.existsSync(from)) {
      log(`  ⚠ 找不到 ${dir}/，略過`);
      continue;
    }
    copy(from, path.join(OUT, dir));
  }
  for (const file of STATIC_FILES) {
    const from = path.join(SRC, file);
    if (!fs.existsSync(from)) {
      log(`  ⚠ 找不到 ${file}，略過`);
      continue;
    }
    copy(from, path.join(OUT, file));
  }
  log('複製靜態檔案完成');
}

// 3. dist/：src/**/*.js → esbuild minify → dist/**/*.min.js
//    （*.min.js 與 lib-bit-firmware/ 原樣複製，與 gulpfile uglify task 行為一致）
async function buildDist() {
  let minified = 0;
  let copied = 0;
  let fallback = 0;

  for (const file of walk(SRC_JS)) {
    const rel = path.relative(SRC_JS, file);
    if (!file.endsWith('.js')) {
      // 非 JS 檔（如 .map、文件）原樣複製
      copy(file, path.join(OUT_DIST, rel));
      copied++;
      continue;
    }

    const isMinified = file.endsWith('.min.js');
    const inFirmwareLib = rel.startsWith('lib-bit-firmware' + path.sep);

    if (isMinified || inFirmwareLib) {
      // 原樣複製，不改名（lib-bit-firmware 由 dynamic import 以原檔名載入）
      copy(file, path.join(OUT_DIST, rel));
      copied++;
      continue;
    }

    // environmentConfig.js：先做環境變數注入
    let source = fs.readFileSync(file, 'utf8');
    if (rel === 'environmentConfig.js') {
      source = source.replace(/\{\{process\.env\.(\w+)\}\}/g, (_, name) => ENV_CONFIG[name] ?? '');
    }

    const outFile = path.join(OUT_DIST, rel.replace(/\.js$/, '.min.js'));
    ensureDir(path.dirname(outFile));
    try {
      const result = await esbuild.transform(source, {
        minify: true,
        target: 'es2020',
        legalComments: 'none',
      });
      fs.writeFileSync(outFile, result.code);
      minified++;
    } catch (err) {
      // minify 失敗（語法過舊/特殊）→ 直接以原始內容輸出
      fs.writeFileSync(outFile, source);
      fallback++;
      log(`  ⚠ esbuild 無法處理 ${rel}，改用原始內容：${err.message.split('\n')[0]}`);
    }
  }

  log(`dist/ 建置完成：minify ${minified} 檔、複製 ${copied} 檔、fallback ${fallback} 檔`);
}

// 4. dist/custom-blocks/：複製（index.html 引用 dist/custom-blocks/image-classifier/*）
function buildDistCustomBlocks() {
  copy(path.join(SRC, 'custom-blocks'), path.join(OUT_DIST, 'custom-blocks'));
  log('dist/custom-blocks/ 複製完成');
}

// 5. dist/css/：less 編譯（css/less/*.less + css/template/*.less）
async function buildLess() {
  const lessDirs = [path.join(SRC, 'css/less'), path.join(SRC, 'css/template')];
  const outCss = path.join(OUT_DIST, 'css');
  ensureDir(outCss);

  let count = 0;
  for (const dir of lessDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.less')) continue;
      const source = fs.readFileSync(path.join(dir, entry), 'utf8');
      const result = await less.render(source, {
        paths: [dir],
        compress: true,
        filename: entry,
      });
      fs.writeFileSync(path.join(outCss, entry.replace(/\.less$/, '.css')), result.css);
      count++;
    }
  }
  log(`dist/css/ less 編譯完成：${count} 檔`);
}

// 6. components/：npm 套件佈局成 bower 路徑
async function layoutComponents() {
  for (const [dest, src] of Object.entries(COMPONENTS_MAP)) {
    const from = path.join(DEPS, src);
    if (!fs.existsSync(from)) {
      throw new Error(`找不到 npm 套件檔案：${from}（請先在 ui-deps/ 執行 npm install）`);
    }
    copy(from, path.join(OUT, 'components', dest));
  }
  for (const [dest, url] of Object.entries(COMPONENTS_DOWNLOAD)) {
    const target = path.join(OUT, 'components', dest);
    log(`  下載 ${url}`);
    await download(url, target);
  }
  log('components/ 佈局完成');
}

// 7. node_modules/ 子集
function layoutNodeModules() {
  for (const rel of NODE_MODULES_COPY) {
    const from = path.join(DEPS, rel);
    if (!fs.existsSync(from)) {
      throw new Error(`找不到 npm 套件檔案：${from}（請先在 ui-deps/ 執行 npm install）`);
    }
    copy(from, path.join(OUT, 'node_modules', rel));
  }
  log('node_modules/ 子集複製完成');
}

// 8. index.html：rev 替換 + 安裝版設定
function patchIndexHtml() {
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

  // cache-busting hash → 建置版本
  html = html.replaceAll('@@hash', REV);

  // 安裝版設定：
  //   isInstalledVersion__ 必須是 false —— true 是給「舊版 NW.js 安裝版」用的，
  //   會讓 USB 積木改連 127.0.0.1:8080 的 chrome.serial 橋接服務（Electron 版沒有），
  //   並跳過 Code.createBoardForWebSerial()，導致 USB 無法執行。
  //   Electron 版的 USB 與雲端版相同，一律走 Web Serial API。
  //   （安裝版模式「免登入、隱藏雲端功能」由 /auth/isLogin 回 404 觸發，與此 flag 無關）
  //   origin__ 指向雲端，讓網頁預覽/分享的專案存到遠端伺服器（手機掃 QR code 才連得到）。
  const devBlock =
    /\/\/ 本機開發時，請使用\s*\n\s*window\.isInstalledVersion__ = false;\s*\n\s*window\.origin__ = location\.origin;/;
  const installedBlock = [
    '// Web:Bit 安裝版 (Electron)：USB 走 Web Serial，與雲端版相同',
    '    window.isInstalledVersion__ = false;',
    '    window.origin__ = "https://webbit.webduino.io";',
  ].join('\n');

  if (!devBlock.test(html)) {
    throw new Error('index.html 結構改變，找不到 isInstalledVersion__ 設定區塊，請更新 build-ui.mjs');
  }
  html = html.replace(devBlock, installedBlock);

  // Electron prompt shim：Electron 不支援 window.prompt()，Blockly 建立/重新命名變數
  // 會因此無法跳出輸入視窗。注入自訂對話框（Blockly.dialog.setPrompt）修正。
  // 放在 blockly_compressed.js 之後（此時 Blockly.dialog 已存在）。
  copy(path.join(SHIM_DIR, ELECTRON_DIALOG_SHIM), path.join(OUT, ELECTRON_DIALOG_SHIM));
  const blocklyTag = '<script src="node_modules/blockly/javascript_compressed.js"></script>';
  const shimTag = `<script src="${ELECTRON_DIALOG_SHIM}?rev=${REV}"></script>`;
  if (!html.includes(blocklyTag)) {
    throw new Error('index.html 找不到 javascript_compressed.js 引用，無法注入 prompt shim，請更新 build-ui.mjs');
  }
  html = html.replace(blocklyTag, `${blocklyTag}\n  ${shimTag}`);

  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  log('index.html 處理完成（安裝版模式 + prompt shim + rev=' + REV + '）');
}

// 9. 韌體離線化：下載 .bin 並改寫 vue-enum 的韌體位址
async function bundleFirmware() {
  const fwDir = path.join(OUT, 'firmware');
  ensureDir(fwDir);

  for (const file of FIRMWARE_FILES) {
    log(`  下載韌體 ${file}`);
    await download(FIRMWARE_BASE + file, path.join(fwDir, file));
  }

  // 改寫 dist/vue-enum.min.js：韌體網址 → 本地相對路徑
  const vueEnumPath = path.join(OUT_DIST, 'vue-enum.min.js');
  let code = fs.readFileSync(vueEnumPath, 'utf8');
  if (!code.includes(FIRMWARE_BASE)) {
    throw new Error('dist/vue-enum.min.js 中找不到韌體網址，請確認 vue-enum.js 是否已改版');
  }
  code = code.replaceAll(FIRMWARE_BASE, 'firmware/');
  fs.writeFileSync(vueEnumPath, code);

  const version = fs.readFileSync(path.join(fwDir, 'bit_version.last'), 'utf8').trim();
  log(`韌體離線化完成（版本 ${version}）`);
}

// 10. 驗證：index.html 引用的每個本地檔案都必須存在
//     另外驗證 code.js document.write 動態載入的語系檔
function verifyOutput() {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const refs = [];
  const re = /(?:src|href)=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);

  // code.js:2356-2361 在 runtime 用 document.write 載入的語系檔
  for (const lang of ['en', 'zh-hant', 'zh-hans']) {
    refs.push(
      `msg/${lang}.js`,
      `node_modules/blockly/msg/${lang}.js`,
      `blocks/msg/${lang}.js`,
      `msg/notification/${lang}.js`
    );
  }
  // boot.js / views 載入的資源（simulator/ 由 mirror-simulator.mjs 另行產生，
  // 不在此檢查——main() 結尾已有提醒）
  refs.push('views/index.handlebars', 'toolbox/index.xml');

  const missing = [];
  for (const ref of refs) {
    const clean = ref.split('?')[0].split('#')[0];
    if (!clean || /^(https?:)?\/\//.test(clean) || clean.startsWith('data:')) continue;
    if (!fs.existsSync(path.join(OUT, clean))) missing.push(clean);
  }

  if (missing.length > 0) {
    log('❌ 驗證失敗，以下引用的檔案不存在：');
    for (const file of missing) log(`   - ${file}`);
    throw new Error(`缺少 ${missing.length} 個檔案`);
  }
  log(`驗證通過：index.html 與 runtime 引用的 ${refs.length} 個資源皆存在`);
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const t0 = Date.now();
  log(`來源：${SRC}`);
  log(`輸出：${OUT}`);

  if (!fs.existsSync(SRC)) {
    console.error(`錯誤：找不到 simulator-bit-edu 原始碼（${SRC}）`);
    console.error('請先在上層目錄 clone：git clone https://github.com/webduinoio/simulator-bit-edu.git');
    process.exit(1);
  }
  if (!fs.existsSync(DEPS)) {
    console.error(`錯誤：找不到前端相依套件（${DEPS}）`);
    console.error('請先執行：cd ui-deps && npm install --legacy-peer-deps');
    process.exit(1);
  }

  clean();
  copyStatic();
  await buildDist();
  buildDistCustomBlocks();
  await buildLess();
  await layoutComponents();
  layoutNodeModules();
  patchIndexHtml();
  await bundleFirmware();
  verifyOutput();

  log(`✅ UI 建置完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  if (!fs.existsSync(path.join(OUT, 'simulator/dist/index.html'))) {
    log('⚠ 尚未產生 simulator/，請執行：npm run build:simulator');
  }
}

main().catch((err) => {
  console.error('[build-ui] 建置失敗：', err);
  process.exit(1);
});
