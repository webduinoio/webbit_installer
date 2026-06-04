#!/usr/bin/env node
/**
 * Web:Bit 安裝版 for Mac — Simulator 鏡像腳本
 *
 * 模擬器（webduinoio/simulator 私有 repo）使用 parcel-bundler 1.x 建置，
 * 在新版 Node 上重建風險高，因此改從雲端正式站鏡像已建置好的輸出：
 *   https://webbit.webduino.io/blockly/simulator/dist/
 *
 * 鏡像策略（parcel 1.x 輸出特性）：
 *   1. index.html → 解析 <script src> / <link href> / <img src>
 *   2. CSS 檔 → 解析 url(...) 引用（字型、圖片）
 *   3. JS 檔 → 解析 parcel 雜湊資產字串（"name.xxxxxxxx.ext"）
 *   4. locales/*.json + locales/components/*.json（i18next 動態載入）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://webbit.webduino.io/blockly/simulator/dist/';
const OUT = path.join(ROOT, 'app-ui/blockly/simulator/dist');

// i18next 動態載入的語系檔（無法從 HTML/JS 靜態解析出完整清單）
const LOCALE_FILES = [
  'locales/en.json',
  'locales/zh-tw.json',
  'locales/zh-cn.json',
  'locales/components/en.json',
  'locales/components/zh-tw.json',
  'locales/components/zh-cn.json',
];

const log = (...args) => console.log('[mirror-simulator]', ...args);

const downloaded = new Set();
let failed = 0;

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** 下載相對路徑資產，回傳內容；已下載過則回傳 null */
async function mirror(relPath) {
  // 正規化（移除 query string、URL fragment、開頭的 ./ 與 /）
  relPath = relPath.split('?')[0].split('#')[0].replace(/^\.?\//, '');
  if (!relPath || downloaded.has(relPath)) return null;
  if (/^(https?:)?\/\//.test(relPath) || relPath.startsWith('data:')) return null; // 外部資源不鏡像

  downloaded.add(relPath);
  const url = BASE_URL + relPath;
  const dest = path.join(OUT, relPath);

  try {
    const content = await fetchWithRetry(url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    log(`  ✓ ${relPath} (${(content.length / 1024).toFixed(1)} KB)`);
    return content;
  } catch (err) {
    failed++;
    log(`  ✗ ${relPath}：${err.message}`);
    return null;
  }
}

/** 從 HTML 解析資產引用 */
function parseHtmlRefs(html) {
  const refs = [];
  const re = /(?:src|href)=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  return refs;
}

/** 從 CSS 解析 url(...) 引用 */
function parseCssRefs(css) {
  const refs = [];
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(css))) refs.push(m[1]);
  return refs;
}

/** 從 JS 解析 parcel 1.x 雜湊資產字串（"name.xxxxxxxx.ext"） */
function parseJsAssetRefs(js) {
  const refs = [];
  const re = /["']([a-zA-Z0-9_/-]+\.[0-9a-f]{8}\.[a-z0-9]{2,5})["']/g;
  let m;
  while ((m = re.exec(js))) refs.push(m[1]);
  return refs;
}

async function main() {
  const t0 = Date.now();
  log(`鏡像來源：${BASE_URL}`);
  log(`輸出：${OUT}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1. index.html
  const html = (await mirror('index.html'))?.toString('utf8');
  if (!html) {
    console.error('錯誤：無法下載 simulator index.html，請確認網路連線');
    process.exit(1);
  }

  // 2. HTML 引用的資產（CSS/JS/icon）
  const htmlRefs = parseHtmlRefs(html);
  const cssContents = [];
  const jsContents = [];
  for (const ref of htmlRefs) {
    const content = await mirror(ref);
    if (!content) continue;
    if (ref.endsWith('.css')) cssContents.push(content.toString('utf8'));
    if (ref.endsWith('.js')) jsContents.push(content.toString('utf8'));
  }

  // 3. CSS 內的 url() 引用（字型、圖片）
  for (const css of cssContents) {
    for (const ref of parseCssRefs(css)) {
      await mirror(ref);
    }
  }

  // 4. JS 內的 parcel 雜湊資產（SVG/PNG 元件圖、子 chunk）
  for (const js of jsContents) {
    const refs = parseJsAssetRefs(js);
    for (const ref of refs) {
      const content = await mirror(ref);
      // 子 chunk JS/CSS 再遞迴解析一層
      if (content && ref.endsWith('.js')) {
        for (const sub of parseJsAssetRefs(content.toString('utf8'))) await mirror(sub);
      }
      if (content && ref.endsWith('.css')) {
        for (const sub of parseCssRefs(content.toString('utf8'))) await mirror(sub);
      }
    }
  }

  // 5. 語系檔
  for (const file of LOCALE_FILES) {
    await mirror(file);
  }

  const total = downloaded.size - failed;
  log(`✅ Simulator 鏡像完成：${total} 檔成功、${failed} 檔失敗（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  if (failed > 0) {
    log('⚠ 有檔案下載失敗，模擬器可能無法完整運作，請重新執行此腳本');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[mirror-simulator] 失敗：', err);
  process.exit(1);
});
