/**
 * Лендинг V3.4 — минимальный клиент без зависимостей.
 *
 * Правила:
 *   • кнопка скачивания активируется ТОЛЬКО когда сервер подтвердил наличие
 *     APK-файла и вернул manifest; иначе показывается честная причина;
 *   • SHA-256 и размер берутся из того же манифеста, что и сам файл;
 *   • все тексты из API вставляются через textContent (никакого innerHTML);
 *   • при недоступности API страница остаётся рабочей и сообщает об этом.
 */
(function () {
  'use strict';

  var els = {
    version: document.getElementById('apk-version'),
    size: document.getElementById('apk-size'),
    sha: document.getElementById('apk-sha'),
    signature: document.getElementById('apk-signature'),
    status: document.getElementById('apk-status'),
    status2: document.getElementById('apk-status-2'),
    btn: document.getElementById('download-btn'),
    btn2: document.getElementById('download-btn-2'),
    btnSub: document.getElementById('download-btn-sub'),
    btn2Sub: document.getElementById('download-btn-2-sub'),
    symbols: document.getElementById('meta-symbols'),
    timeframes: document.getElementById('meta-timeframes'),
    research: document.getElementById('research-status'),
    serverStatus: document.getElementById('server-status'),
    footerVersion: document.getElementById('footer-version')
  };

  function setText(el, value) {
    if (el) el.textContent = value == null ? '—' : String(value);
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-ok', 'is-warn', 'is-error');
    if (kind) el.classList.add(kind);
  }

  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '—';
    var units = ['Б', 'КБ', 'МБ', 'ГБ'];
    var i = 0;
    var value = bytes;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return (i === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
  }

  function disableButton(btn, sub, text) {
    if (!btn) return;
    btn.setAttribute('aria-disabled', 'true');
    btn.removeAttribute('href');
    if (sub) setText(sub, text);
  }

  function enableButton(btn, sub, href, text) {
    if (!btn) return;
    btn.setAttribute('aria-disabled', 'false');
    btn.setAttribute('href', href);
    if (sub) setText(sub, text);
  }

  function renderApk(apk) {
    if (apk && apk.available) {
      setText(els.version, apk.version || '—');
      setText(els.size, formatBytes(apk.sizeBytes));
      setText(els.sha, apk.sha256 || '—');
      if (els.sha && apk.sha256) els.sha.setAttribute('title', apk.sha256);
      setText(els.signature, apk.signedWithReleaseKey
        ? 'релизный ключ владельца'
        : 'проверочная сборка (не релизный ключ)');
      var label = 'v' + (apk.version || '?') + ' · Android 8+';
      enableButton(els.btn, els.btnSub, apk.downloadPath, label);
      enableButton(els.btn2, els.btn2Sub, apk.downloadPath, label);
      var note = apk.signedWithReleaseKey
        ? 'Файл подписан релизным ключом. Сверьте SHA-256 после скачивания.'
        : 'Это проверочная сборка, а не подписанный релиз: ключ подписи владельца не предоставлен.';
      setStatus(els.status, note, apk.signedWithReleaseKey ? 'is-ok' : 'is-warn');
      setStatus(els.status2, note, apk.signedWithReleaseKey ? 'is-ok' : 'is-warn');
      return;
    }
    var reason = (apk && apk.reason) ? apk.reason : 'манифест APK недоступен';
    setText(els.version, '—');
    setText(els.size, '—');
    setText(els.sha, '—');
    setText(els.signature, '—');
    disableButton(els.btn, els.btnSub, 'APK ещё не опубликован');
    disableButton(els.btn2, els.btn2Sub, 'APK ещё не опубликован');
    setStatus(els.status, 'Скачивание недоступно: ' + reason + '.', 'is-warn');
    setStatus(els.status2, 'Скачивание недоступно: ' + reason + '.', 'is-warn');
  }

  function renderMeta(meta) {
    var strategy = meta.strategy || {};
    var universe = meta.universe || {};
    var tf = strategy.timeframes || {};
    if (Array.isArray(universe.symbols) && universe.symbols.length > 0) {
      setText(els.symbols, universe.symbols.join(', '));
    }
    if (tf.exec) setText(els.timeframes, tf.exec + ' (исполнение) · ' + (tf.context || '4h') + ' (контекст)');
    if (strategy.badgeLabel) {
      setText(els.research, 'Статус исследования: ' + strategy.badgeLabel
        + '. Отдельного бэктеста V3.4 нет; исходный вариант V3.3 — TRAIN only, без валидации на отложенной выборке. '
        + 'Это не «проверенная» и не «прибыльная» стратегия.');
    }
    var engine = meta.engine || {};
    var statusMap = {
      fresh: ['Данные источника свежие.', 'is-ok'],
      stale: ['Данные источника устарели: ' + (engine.staleReason || 'причина не указана'), 'is-warn'],
      error: ['Источник данных недоступен: ' + (engine.staleReason || 'ошибки по всем символам'), 'is-error'],
      unknown: ['Сервер ещё не выполнил ни одного скана.', 'is-warn']
    };
    var state = statusMap[engine.dataStatus] || ['Состояние источника неизвестно.', 'is-warn'];
    var scanTail = engine.lastSuccessfulScanAt ? ' Последний успешный скан: ' + engine.lastSuccessfulScanAt + ' UTC.' : '';
    setStatus(els.serverStatus, 'Состояние сервера: ' + state[0] + scanTail, state[1]);
    setText(els.footerVersion, 'server ' + (meta.serverVersion || '—') + ' · api ' + (meta.apiVersion || '—'));
  }

  function fetchJson(url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // APK-манифест: сначала API, затем статический файл (если API недоступен).
  fetchJson('/api/v1/apk')
    .then(renderApk)
    .catch(function () {
      return fetchJson('/apk/manifest.json').then(renderApk).catch(function () {
        renderApk({ available: false, reason: 'сервер не отдал манифест APK' });
      });
    });

  fetchJson('/api/v1/meta')
    .then(renderMeta)
    .catch(function () {
      setStatus(els.serverStatus, 'Не удалось получить состояние сервера: API недоступен.', 'is-error');
      setText(els.footerVersion, 'API недоступен');
    });
})();
