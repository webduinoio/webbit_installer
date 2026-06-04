/**
 * 選單在地化：載入 i18n/<lang>.json
 * 支援語系：en / zh-hant（簡體中文已移除，中文系統一律使用繁體）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '..', 'i18n');
const SUPPORTED = ['en', 'zh-hant'];

let currentLang = 'zh-hant';
let strings = {};

/** 由系統語系推測預設語言 */
function detectSystemLang(systemLocale) {
  const locale = (systemLocale || '').toLowerCase();
  if (locale.startsWith('zh')) return 'zh-hant';
  return 'en';
}

function setLang(lang) {
  if (!SUPPORTED.includes(lang)) {
    // 不支援的語系：中文（含舊設定檔的 zh-hans）退回繁體，其餘退回英文
    lang = String(lang || '').startsWith('zh') ? 'zh-hant' : 'en';
  }
  currentLang = lang;
  strings = JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
}

function getLang() {
  return currentLang;
}

/** 翻譯：_('KEY', arg0, arg1...)，{0}/{1} 為參數佔位 */
function _(key, ...args) {
  let msg = strings[key];
  if (msg === undefined || msg === null || msg === '') msg = key;
  return msg.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? args[i] : m));
}

module.exports = { detectSystemLang, setLang, getLang, _, SUPPORTED };
