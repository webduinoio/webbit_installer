#!/usr/bin/env node
/**
 * Redmine #8882 驗證腳本：安裝版滑鼠複製貼上積木
 *
 * 驗證項目：
 *   1. 視窗「無焦點」時剪貼簿仍可讀寫（Windows 失效模式：
 *      Chromium navigator.clipboard 需要焦點，alert/confirm 後焦點遺失）
 *   2. navigator.clipboard 已接上 Electron clipboard bridge
 *   3. 滑鼠右鍵 複製→貼上 多輪正常
 *   4. 鍵盤 Ctrl/Cmd+C→V 多輪正常
 *
 * 前置：
 *   npm i --no-save playwright-core
 *   open -n node_modules/electron/dist/Electron.app --args "$PWD" --remote-debugging-port=9333
 * 執行：
 *   node scripts/verify-8882.mjs
 */
import { chromium } from 'playwright-core';

const MOUSE_ROUNDS = 5;
const KEYBOARD_ROUNDS = 3;
let failures = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '：' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 15000 });
let win = null;
for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().includes('/blockly/')) win = p;
if (!win) {
  console.error('找不到 blockly 頁面，請先依檔頭說明啟動 app');
  process.exit(1);
}

const alerts = [];
win.on('dialog', async (d) => {
  alerts.push(d.message());
  await d.accept().catch(() => {});
});

// 重設工作區
await win.evaluate(() => {
  for (const el of document.querySelectorAll('.swal-overlay, .notification-open')) el.style.display = 'none';
  Code.workspace.clear();
  const xml = Blockly.utils.xml.textToDom(
    '<xml xmlns="https://developers.google.com/blockly/xml"><block type="text_print" x="100" y="60"></block></xml>'
  );
  Blockly.Xml.domToWorkspace(xml, Code.workspace);
});

/* ---------- 1. 無焦點時剪貼簿讀寫（核心：Windows 失效模式） ---------- */

// 真正讓視窗失焦：把 Finder 叫到前景（macOS）；CDP 預設的焦點模擬也要關閉
const { execSync } = await import('node:child_process');
if (process.platform === 'darwin') {
  execSync(`osascript -e 'tell application "Finder" to activate'`);
  await win.waitForTimeout(800);
}
const cdp = await win.context().newCDPSession(win);
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
const unfocused = await win.evaluate(async () => {
  const out = { hasFocus: document.hasFocus() };
  try {
    await navigator.clipboard.writeText('{"probe":"8882"}');
    out.write = 'OK';
  } catch (e) {
    out.write = e.name + ': ' + e.message;
  }
  try {
    const t = await navigator.clipboard.readText();
    out.read = t === '{"probe":"8882"}' ? 'OK' : 'MISMATCH: ' + t.slice(0, 40);
  } catch (e) {
    out.read = e.name + ': ' + e.message;
  }
  return out;
});
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
if (process.platform === 'darwin') {
  execSync(`osascript -e 'tell application "Electron" to activate' 2>/dev/null || true`);
  await win.waitForTimeout(500);
}
check('無焦點時 writeText', unfocused.write === 'OK', `hasFocus=${unfocused.hasFocus} → ${unfocused.write}`);
check('無焦點時 readText', unfocused.read === 'OK', `hasFocus=${unfocused.hasFocus} → ${unfocused.read}`);

/* ---------- 2. Electron clipboard bridge 已生效 ---------- */

const bridged = await win.evaluate(() => !!window.__electronClipboardBridge__);
check('navigator.clipboard 已接上 Electron bridge', bridged);

/* ---------- 3. 滑鼠右鍵 複製→貼上 ---------- */

async function clickMenuItem(itemText) {
  const item = win.locator('.blocklyMenuItem', { hasText: itemText }).first();
  try {
    await item.waitFor({ state: 'visible', timeout: 2000 });
  } catch {
    await win.keyboard.press('Escape');
    return false;
  }
  await item.click();
  return true;
}

const blockCenter = () =>
  win.evaluate(() => {
    const block = Code.workspace.getTopBlocks(true)[0];
    const r = block.getSvgRoot().getBoundingClientRect();
    return { x: r.x + 40, y: r.y + 14 };
  });

let mouseOk = true;
for (let i = 1; i <= MOUSE_ROUNDS; i++) {
  const c = await blockCenter();
  await win.mouse.click(c.x, c.y, { button: 'right' });
  const copied = await clickMenuItem('複製');
  await win.waitForTimeout(200);
  await win.mouse.click(c.x + 320, c.y + 120, { button: 'right' });
  const pasted = await clickMenuItem('貼上');
  await win.waitForTimeout(300);
  const count = await win.evaluate(() => Code.workspace.getAllBlocks(false).length);
  if (!copied || !pasted || count !== 2) {
    mouseOk = false;
    console.log(`   round ${i}: copy=${copied} paste=${pasted} blocks=${count}（預期 2）`);
  }
  // 清掉貼上的積木避免堆疊出視口
  await win.evaluate(() => Code.workspace.getTopBlocks(true).slice(1).forEach((b) => b.dispose(false)));
}
check(`滑鼠右鍵複製貼上 ${MOUSE_ROUNDS} 輪`, mouseOk && alerts.length === 0, alerts.join(' | ') || undefined);

/* ---------- 4. 鍵盤複製貼上 ---------- */

const mod = (await win.evaluate(() => navigator.platform.includes('Mac'))) ? 'Meta' : 'Control';
let kbOk = true;
for (let i = 1; i <= KEYBOARD_ROUNDS; i++) {
  const c = await blockCenter();
  await win.mouse.click(c.x, c.y); // 選取積木
  await win.waitForTimeout(150);
  await win.keyboard.press(`${mod}+c`);
  await win.waitForTimeout(200);
  await win.keyboard.press(`${mod}+v`);
  await win.waitForTimeout(300);
  const count = await win.evaluate(() => Code.workspace.getAllBlocks(false).length);
  if (count !== 2) {
    kbOk = false;
    console.log(`   round ${i}: blocks=${count}（預期 2）`);
  }
  await win.evaluate(() => Code.workspace.getTopBlocks(true).slice(1).forEach((b) => b.dispose(false)));
}
check(`鍵盤複製貼上 ${KEYBOARD_ROUNDS} 輪`, kbOk);

console.log(failures ? `\n❌ ${failures} 項失敗` : '\n✅ 全部通過');
await browser.close();
process.exit(failures ? 1 : 0);
