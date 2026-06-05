/**
 * Web:Bit 安裝版（Electron）— prompt 對話框 shim
 *
 * 問題：Electron 不支援 window.prompt()（直接回傳 null、不彈視窗），
 *       而 Blockly 建立 / 重新命名變數是靠 Blockly.dialog.prompt → window.prompt 取名，
 *       因此在安裝版按「建立變數…」不會出現輸入名稱的視窗。
 *       （舊版 NW.js 基於 Chrome 有原生 window.prompt，所以沒這問題。）
 *
 * 修法：用 Blockly 官方擴充點 Blockly.dialog.setPrompt() 換成自訂 HTML 對話框
 *       （支援非同步 callback，不需要同步的 window.prompt）。
 *
 * 此檔僅在 Electron 安裝版由 build-ui.mjs 注入 index.html，不影響雲端版。
 * index.html 在 blockly_compressed.js 之後載入，此時 Blockly.dialog 已存在。
 */
(function () {
  'use strict';

  function pickLang(zh, en) {
    var lang = '';
    try {
      lang =
        new URLSearchParams(location.search).get('lang') ||
        document.documentElement.lang ||
        navigator.language ||
        '';
    } catch (e) {
      /* ignore */
    }
    return /^en/i.test(lang) ? en : zh;
  }

  function showPrompt(message, defaultValue, callback) {
    var prev = document.getElementById('webbit-prompt-overlay');
    if (prev) prev.remove();

    var overlay = document.createElement('div');
    overlay.id = 'webbit-prompt-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(0,0,0,.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft JhengHei",sans-serif',
    ].join(';');

    var box = document.createElement('div');
    box.style.cssText = [
      'background:#fff',
      'border-radius:8px',
      'padding:20px 22px',
      'min-width:320px',
      'max-width:90vw',
      'box-shadow:0 8px 32px rgba(0,0,0,.3)',
    ].join(';');

    var label = document.createElement('div');
    label.textContent = message || '';
    label.style.cssText =
      'font-size:15px;color:#222;margin-bottom:12px;white-space:pre-wrap;';

    var input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue != null ? String(defaultValue) : '';
    input.style.cssText = [
      'width:100%',
      'box-sizing:border-box',
      'padding:8px 10px',
      'font-size:15px',
      'border:1px solid #bbb',
      'border-radius:5px',
      'outline:none',
    ].join(';');

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'margin-top:16px;text-align:right;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = pickLang('取消', 'Cancel');
    cancelBtn.style.cssText =
      'margin-right:8px;padding:7px 16px;font-size:14px;border:1px solid #ccc;' +
      'background:#f5f5f5;border-radius:5px;cursor:pointer;';

    var okBtn = document.createElement('button');
    okBtn.textContent = pickLang('確定', 'OK');
    okBtn.style.cssText =
      'padding:7px 18px;font-size:14px;border:none;background:#4597f7;color:#fff;' +
      'border-radius:5px;cursor:pointer;';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    (document.body || document.documentElement).appendChild(overlay);

    input.focus();
    input.select();

    var done = false;
    function close(value) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      callback(value);
    }
    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    }

    okBtn.addEventListener('click', function () {
      close(input.value);
    });
    cancelBtn.addEventListener('click', function () {
      close(null);
    });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey, true);
  }

  function install() {
    if (!window.Blockly || !Blockly.dialog || !Blockly.dialog.setPrompt) return false;
    Blockly.dialog.setPrompt(showPrompt);
    return true;
  }

  if (!install()) {
    // 保險：Blockly 尚未載入完成時輪詢（正常情況下 install() 會立即成功）
    var tries = 0;
    var timer = setInterval(function () {
      if (install() || ++tries > 100) clearInterval(timer);
    }, 50);
  }
})();
