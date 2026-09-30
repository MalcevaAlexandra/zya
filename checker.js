/*
 * Проверка наличия товаров в магазине Золотое Яблоко (goldapple.by).
 * Запускается закладкой (bookmarklet) на открытой странице goldapple.by:
 * запросы идут с того же сайта, в вашей сессии, как при открытии «Наличие в магазинах».
 */
(function () {
  'use strict';

  var HOST_OK = /(^|\.)goldapple\.by$/.test(location.hostname);
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (!s) {
      var all = document.querySelectorAll('script[src*="checker.js"]');
      s = all.length ? all[all.length - 1].src : '';
    }
    return s ? s.replace(/checker\.js.*$/, '') : '';
  })();

  if (!HOST_OK) {
    alert('Откройте сайт goldapple.by и нажмите закладку ещё раз.');
    return;
  }
  if (window.__gaChecker) { window.__gaChecker.show(); return; }

  // ---------- настройки ----------
  var CFG = {
    cityId: '03992f6a-a9a1-4b2c-b85a-63663114ef2f', // Минск
    storeId: '180',                                 // ТРЦ GALLERIA MINSK, пр-т Победителей, 9
    storeName: 'пр-т Победителей, 9 (Galleria)',
    sheetName: 'МНС Галерея',
    reportStore: 'Минск Галерея', // название магазина в итоговом тексте
    lowMax: 3,              // «мало» — от 1 до 3 шт. включительно; 0 — «нет в наличии»
    delayMs: 20000,         // пауза между запросами (сайт пропускает ~3 запроса в минуту)
    cooldownMs: 60000,      // пауза, если сайт ограничил частоту запросов
    maxCooldownMs: 180000
  };
  var LS_KEY = 'gaStockChecker.v1';

  // ---------- состояние ----------
  var state = load() || null; // {fileName, items:[{sku,name,brand,inMatrix}], onlyMatrix, results:{sku:{...}}, done}
  var running = false, stopFlag = false, timer = null;

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }
  function clearState() { try { localStorage.removeItem(LS_KEY); } catch (e) {} state = null; }

  // ---------- UI (shadow DOM, чтобы стили сайта не мешали) ----------
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}',
    '.bg{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;justify-content:center;align-items:flex-end}',
    '@media(min-width:700px){.bg{align-items:center}}',
    '.panel{background:#fff;color:#111;width:100%;max-width:640px;max-height:100%;height:100%;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)}',
    '@media(min-width:700px){.panel{height:auto;max-height:90vh;border-radius:14px}}',
    'header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #eee}',
    'h1{font-size:18px;margin:0;flex:1;font-weight:700;letter-spacing:.2px}',
    '.x{border:0;background:#f2f2f2;border-radius:50%;width:34px;height:34px;font-size:20px;line-height:34px;color:#111}',
    '.body{padding:14px 16px calc(16px + env(safe-area-inset-bottom));overflow:auto;-webkit-overflow-scrolling:touch;flex:1}',
    '.muted{color:#777;font-size:13px;line-height:1.4}',
    'label.file{display:block;border:1.5px dashed #bbb;border-radius:12px;padding:18px;text-align:center;font-size:15px;margin:10px 0}',
    'label.file input{display:none}',
    '.row{display:flex;gap:8px;align-items:center;margin:10px 0;font-size:14px}',
    'select{font-size:16px;padding:8px;border-radius:8px;border:1px solid #ccc;flex:1;background:#fff;color:#111}',
    '.btn{appearance:none;border:0;border-radius:10px;padding:13px 16px;font-size:15px;font-weight:600;letter-spacing:.3px;background:#000;color:#fff;width:100%;margin-top:6px}',
    '.btn.sec{background:#f0f0f0;color:#111}',
    '.btn:disabled{opacity:.4}',
    '.btns{display:flex;gap:8px}',
    '.bar{height:6px;background:#eee;border-radius:3px;overflow:hidden;margin:12px 0 6px}',
    '.bar i{display:block;height:100%;background:#000;width:0}',
    '.status{font-size:13px;color:#555;min-height:18px}',
    'textarea{width:100%;min-height:110px;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:15px;line-height:1.45;color:#111;background:#fafafa;resize:vertical}',
    'h2{font-size:15px;margin:18px 0 6px;display:flex;justify-content:space-between}',
    'h2 span{color:#777;font-weight:400}',
    'ul{list-style:none;margin:0;padding:0}',
    'li{padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;line-height:1.35}',
    'li a{color:#111;text-decoration:none}',
    'li .meta{color:#777;font-size:12px;margin-top:2px}',
    '.tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;margin-right:6px;vertical-align:1px}',
    '.out{background:#111;color:#fff}.low{background:#f3d34a;color:#111}.err{background:#eee;color:#555}',
    '.hide{display:none!important}',
    '</style>',
    '<div class="bg"><div class="panel">',
    ' <header><h1>Наличие: ' + esc(CFG.storeName) + '</h1><button class="x" id="close" aria-label="Закрыть">×</button></header>',
    ' <div class="body">',
    '  <div id="setup">',
    '   <div class="muted">Выберите xlsx-файл. Будет проверен лист «' + esc(CFG.sheetName) + '» (если его нет — выберите лист вручную).</div>',
    '   <label class="file"><input type="file" id="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">📄 <b id="fileLbl">Выбрать файл xlsx</b></label>',
    '   <div id="sheetRow" class="row hide"><span>Лист:</span><select id="sheet"></select></div>',
    '   <div id="matrixRow" class="row hide"><label><input type="checkbox" id="onlyMatrix"> <span id="matrixLbl"></span></label></div>',
    '   <div id="summary" class="muted"></div>',
    '  </div>',
    '  <div class="bar"><i id="bar"></i></div>',
    '  <div class="status" id="status"></div>',
    '  <div class="btns"><button class="btn" id="start" disabled>Проверить</button><button class="btn sec hide" id="reset">Новый файл</button></div>',
    '  <div id="results"></div>',
    ' </div>',
    '</div></div>'
  ].join('');
  document.documentElement.appendChild(host);
  var $ = function (id) { return root.getElementById(id); };

  var parsed = null; // {sheets:{name: rows}, names:[]}

  $('close').onclick = function () { hide(); };
  $('file').onchange = onFile;
  $('sheet').onchange = function () { buildItemsFromSheet(); };
  $('onlyMatrix').onchange = function () { buildItemsFromSheet(); };
  $('start').onclick = function () { running ? stop() : start(); };
  $('reset').onclick = function () {
    if (running) return;
    if (!confirm('Сбросить результаты и выбрать новый файл?')) return;
    clearState(); parsed = null; $('fileLbl').textContent = 'Выбрать файл xlsx';
    $('sheetRow').classList.add('hide'); $('matrixRow').classList.add('hide');
    $('file').value = ''; render();
  };

  function show() { host.style.display = ''; }
  function hide() { host.style.display = 'none'; }
  window.__gaChecker = { show: show };

  // ---------- чтение xlsx ----------
  function loadXLSX() {
    if (window.XLSX && window.XLSX.read) return Promise.resolve(window.XLSX);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = BASE + 'vendor/xlsx.mini.min.js';
      s.onload = function () { res(window.XLSX); };
      s.onerror = function () { rej(new Error('Не удалось загрузить модуль чтения xlsx')); };
      document.head.appendChild(s);
    });
  }

  function onFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    setStatus('Читаю файл…');
    loadXLSX().then(function (XLSX) {
      return f.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array' });
        parsed = { names: wb.SheetNames, sheets: {}, fileName: f.name };
        wb.SheetNames.forEach(function (n) {
          parsed.sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
        });
        $('fileLbl').textContent = f.name;
        var sel = $('sheet'); sel.innerHTML = '';
        var wanted = norm(CFG.sheetName), pick = wb.SheetNames[0];
        wb.SheetNames.forEach(function (n) {
          var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o);
          if (norm(n) === wanted) pick = n;
        });
        sel.value = pick;
        $('sheetRow').classList.remove('hide');
        buildItemsFromSheet();
      });
    }).catch(function (err) { setStatus('Ошибка: ' + err.message); });
  }

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }

  function buildItemsFromSheet() {
    if (!parsed) return;
    var rows = parsed.sheets[$('sheet').value] || [];
    // строка заголовков — первая, где есть «SKU» или «Название»
    var h = -1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      if ((rows[i] || []).some(function (c) { return /^(sku|артикул)$/i.test(String(c || '').trim()) || /^название$/i.test(String(c || '').trim()); })) { h = i; break; }
    }
    if (h < 0) { setStatus('Не нашёл строку заголовков (SKU / Название) на этом листе.'); $('start').disabled = true; return; }
    var head = rows[h].map(function (c) { return String(c || '').trim(); });
    var cSku = head.findIndex(function (c) { return /^(sku|артикул)$/i.test(c); });
    var cName = head.findIndex(function (c) { return /^название/i.test(c); });
    var cBrand = head.findIndex(function (c) { return /^бренд/i.test(c); });
    var cNum = head.findIndex(function (c) { return /^(номер|№|n)$/i.test(c); });
    if (cNum < 0) cNum = 0; // номер товара — в первой колонке
    var cMatrix = head.findIndex(function (c) { return c.indexOf('(' + CFG.storeId + ')') >= 0; });

    var onlyMatrix = cMatrix >= 0 && $('onlyMatrix').checked;
    if (cMatrix >= 0) {
      $('matrixRow').classList.remove('hide');
      $('matrixLbl').textContent = 'только товары с «1» в колонке «' + head[cMatrix] + '»';
    } else $('matrixRow').classList.add('hide');

    var items = [], seen = {}, total = 0;
    for (var r = h + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var name = cName >= 0 ? String(row[cName] || '').trim() : '';
      var sku = cSku >= 0 ? String(row[cSku] == null ? '' : row[cSku]).replace(/\.0+$/, '').trim() : '';
      if (!sku) { var m = name.match(/\b(19\d{9})\b/); if (m) sku = m[1]; }
      if (!sku && !name) continue;
      total++;
      var inMatrix = cMatrix >= 0 ? String(row[cMatrix] == null ? '' : row[cMatrix]).trim() !== '' && Number(row[cMatrix]) !== 0 : true;
      if (onlyMatrix && !inMatrix) continue;
      var key = sku || ('name:' + name);
      if (seen[key]) continue; seen[key] = 1;
      items.push({ key: key, num: String(row[cNum] == null ? '' : row[cNum]).replace(/\.0+$/, '').trim(), sku: sku, name: name, brand: cBrand >= 0 ? String(row[cBrand] || '') : '' });
    }
    state = { fileName: parsed.fileName, sheet: $('sheet').value, onlyMatrix: onlyMatrix, items: items, results: {}, done: false, startedAt: null };
    save();
    $('summary').textContent = 'Товаров на листе: ' + total + '. К проверке: ' + items.length + '.';
    render();
  }

  // ---------- запросы к сайту ----------
  function headers() {
    var h = { accept: 'application/json, text/plain, */*', 'plaid-platform': 'web', 'plaid-store-id': 'by', 'plaid-language-id': 'ru_RU' };
    try {
      var ga = document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$gaApp;
      Object.assign(h, ga.api.baseConfig.headers || {});
    } catch (e) {
      var m = document.cookie.match(/(?:^|;\s*)ga-device-id=([^;]+)/);
      if (m) h['plaid-device-id'] = decodeURIComponent(m[1]);
    }
    return h;
  }

  function fetchStock(sku) {
    var url = '/web/api/v1/retailstore/city/stores/stock?' + new URLSearchParams({ locale: 'ru', cityId: CFG.cityId, itemId: sku });
    return fetch(url, { headers: headers(), credentials: 'include' }).then(function (r) {
      if (r.status === 403 || r.status === 429) return { retry: true, code: r.status };
      if (r.status === 400 || r.status >= 500) return { soft: true, code: r.status };
      var ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.indexOf('json') < 0) return { error: 'ответ сайта ' + r.status + (r.status === 400 ? ' (товар не найден?)' : ''), code: r.status };
      return r.json().then(function (j) {
        var stores = (j && j.stores) || [];
        var st = stores.filter(function (s) { return String(s.id) === CFG.storeId; })[0];
        if (!st) return { count: 0, type: 'outOfStock', text: 'магазина нет в списке', address: '' };
        return { count: Number(st.count) || 0, type: st.status && st.status.type, text: st.status && st.status.text, address: st.address };
      });
    }, function (e) { return { retry: true, code: 'network' }; });
  }

  function classify(res) {
    if (res.error) return 'err';
    if (res.count <= 0 || res.type === 'outOfStock') return 'out';
    if (res.count <= CFG.lowMax || /low/i.test(res.type || '')) return 'low';
    return 'ok';
  }

  function sleep(ms, tick) {
    return new Promise(function (res) {
      var end = Date.now() + ms;
      (function step() {
        if (stopFlag) return res();
        var left = end - Date.now();
        if (tick) tick(Math.ceil(left / 1000));
        if (left <= 0) return res();
        timer = setTimeout(step, Math.min(1000, left));
      })();
    });
  }

  function start() {
    if (!state || !state.items.length) return;
    if (state.done) {
      if (!confirm('Проверить все товары заново?')) return;
      state.results = {}; state.done = false; state.startedAt = null; save(); render();
    }
    running = true; stopFlag = false;
    if (!state.startedAt) state.startedAt = Date.now();
    $('start').textContent = 'Пауза';
    $('reset').disabled = true;
    run();
  }
  function stop() {
    stopFlag = true; running = false; clearTimeout(timer);
    $('start').textContent = 'Продолжить'; $('reset').disabled = false;
    setStatus('Пауза. Прогресс сохранён.');
  }

  async function run() {
    var cooldown = CFG.cooldownMs;
    var lastWasBlocked = false;
    for (var i = 0; i < state.items.length; i++) {
      if (stopFlag) return;
      var it = state.items[i];
      var key = keyOf(it);
      if (state.results[key] && !state.results[key].error) continue;

      if (!it.sku) { state.results[key] = { error: 'нет SKU в файле' }; save(); render(); continue; }

      setStatus('Проверяю ' + (i + 1) + ' из ' + state.items.length + ': ' + (it.name || it.sku));
      var res = await fetchStock(it.sku);
      if (stopFlag) return;
      if (res.retry) {
        // сайт временно ограничил частоту — ждём и повторяем тот же товар
        await sleep(cooldown, function (s) { setStatus('Сайт просит подождать (' + res.code + '). Повтор через ' + s + ' с… Проверено ' + doneCount() + ' из ' + state.items.length); });
        if (lastWasBlocked) cooldown = Math.min(cooldown * 1.5, CFG.maxCooldownMs);
        lastWasBlocked = true;
        i--; continue;
      }
      lastWasBlocked = false; cooldown = CFG.cooldownMs;
      if (res.soft) {
        // временная ошибка сайта — пробуем ещё пару раз
        it.tries = (it.tries || 0) + 1;
        if (it.tries < 3) { await sleep(CFG.delayMs); i--; continue; }
        res = { error: 'сайт ответил ошибкой ' + res.code };
      }
      state.results[key] = res; save(); render();
      if (i < state.items.length - 1) await sleep(CFG.delayMs);
    }
    running = false;
    state.done = true; save();
    $('start').textContent = 'Проверить заново'; $('reset').disabled = false;
    setStatus('Готово. Проверено ' + doneCount() + ' товаров.');
    render();
  }

  function keyOf(it) { return it.key || it.sku || ('name:' + it.name); }

  function doneCount() { return state ? Object.keys(state.results).length : 0; }

  // ---------- вывод ----------
  function setStatus(t) { $('status').textContent = t; }

  function render() {
    var has = state && state.items && state.items.length;
    $('start').disabled = !has;
    $('reset').classList.toggle('hide', !state);
    if (!state) { $('results').innerHTML = ''; $('bar').style.width = '0'; $('summary').textContent = ''; return; }
    if (!parsed) $('summary').textContent = 'Файл: ' + state.fileName + ', лист «' + state.sheet + '». К проверке: ' + state.items.length + '.';
    var n = doneCount();
    $('bar').style.width = (state.items.length ? (100 * n / state.items.length) : 0) + '%';
    if (!running) {
      if (state.done) $('start').textContent = 'Проверить заново';
      else if (n > 0) { $('start').textContent = 'Продолжить'; setStatus('Проверено ' + n + ' из ' + state.items.length + '. Можно продолжить.'); }
      else $('start').textContent = 'Проверить';
    }

    var groups = { out: [], low: [], err: [] };
    state.items.forEach(function (it) {
      var r = state.results[keyOf(it)];
      if (!r) return;
      var c = classify(r);
      if (groups[c]) groups[c].push({ it: it, r: r });
    });
    var html = '';
    if (n > 0) {
      html += '<h2>Итог' + (state.done ? '' : ' (проверено ' + n + ' из ' + state.items.length + ')') + '</h2>' +
        '<textarea id="report" readonly>' + esc(reportText(groups)) + '</textarea>' +
        '<div class="btns"><button class="btn" id="copy">Скопировать текст</button>' +
        (navigator.share ? '<button class="btn sec" id="share">Поделиться</button>' : '') + '</div>';
    }
    html += section('Нет в наличии', 'out', groups.out);
    html += section('Мало (' + CFG.lowMax + ' шт. и меньше)', 'low', groups.low);
    html += section('Не удалось проверить', 'err', groups.err);
    $('results').innerHTML = html;
    var cp = $('copy'); if (cp) cp.onclick = function () { copyText(reportText(groups)); };
    var sh = $('share'); if (sh) sh.onclick = function () { navigator.share({ text: reportText(groups) }).catch(function () {}); };
  }

  function section(title, cls, list) {
    if (!list.length) return '';
    var label = { out: 'НЕТ', low: 'МАЛО', err: '?' }[cls];
    return '<h2>' + esc(title) + ' <span>' + list.length + '</span></h2><ul>' + list.map(function (x) {
      var url = 'https://goldapple.by/' + encodeURIComponent(x.it.sku);
      var meta = (x.it.num ? '№ ' + esc(x.it.num) + ' · ' : '') + 'SKU ' + esc(x.it.sku || '—') + (x.r.error ? ' · ' + esc(x.r.error) : ' · ' + esc(x.r.text || '') + (cls === 'low' ? ' · ' + x.r.count + ' шт.' : ''));
      return '<li><span class="tag ' + cls + '">' + label + '</span><a href="' + url + '" target="_blank" rel="noopener">' + esc(x.it.name || x.it.sku) + '</a><div class="meta">' + meta + '</div></li>';
    }).join('') + '</ul>';
  }

  function reportText(g) {
    var nums = function (list) {
      var v = list.map(function (x) { return x.it.num || x.it.sku; });
      v.sort(function (a, b) { return (Number(a) - Number(b)) || String(a).localeCompare(String(b)); });
      return v.length ? v.join(',') : 'нет';
    };
    return 'Добрый день!\n' +
      'Магазин: ' + CFG.reportStore + '\n' +
      'Нет в наличии: ' + nums(g.out) + '\n' +
      'Мало (' + CFG.lowMax + 'шт и меньше): ' + nums(g.low);
  }

  function copyText(t) {
    var done = function () { setStatus('Список скопирован.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(done, fallback);
    fallback();
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; root.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, t.length);
      try { document.execCommand('copy'); done(); } catch (e) { alert(t); }
      ta.remove();
    }
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  render();
})();
