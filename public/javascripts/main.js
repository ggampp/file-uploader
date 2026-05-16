(function () {
  var form = document.getElementById('reel-form');
  var urlInput = document.getElementById('reel-url');
  var submitBtn = document.getElementById('submit-btn');
  var clearBtn = document.getElementById('clear-btn');
  var pasteBtn = document.getElementById('paste-btn');
  var statusEl = document.getElementById('status');
  var resultEl = document.getElementById('result');
  var preview = document.getElementById('preview');
  var captionEl = document.getElementById('caption');
  var downloadLink = document.getElementById('download-link');
  var versionBadge = document.getElementById('version-badge');
  var logPanel = document.getElementById('log-panel');
  var logEl = document.getElementById('log');
  var logClear = document.getElementById('log-clear');

  var currentEs = null;

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = kind || '';
  }

  function resetResult() {
    resultEl.hidden = true;
    preview.removeAttribute('src');
    preview.load();
    captionEl.textContent = '';
    downloadLink.removeAttribute('href');
  }

  function clearLog() {
    logEl.innerHTML = '';
  }

  function appendLog(entry) {
    logPanel.hidden = false;
    var line = document.createElement('div');
    line.className = 'log-line log-' + (entry.level || 'info');
    var t = entry.time
      ? new Date(entry.time).toLocaleTimeString()
      : new Date().toLocaleTimeString();
    line.textContent = '[' + t + '] ' + entry.msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  fetch('/api/version')
    .then(function (r) { return r.json(); })
    .then(function (d) { versionBadge.textContent = 'v' + d.version; })
    .catch(function () { versionBadge.textContent = ''; });

  clearBtn.addEventListener('click', function () {
    urlInput.value = '';
    urlInput.focus();
    setStatus('');
    resetResult();
  });

  logClear.addEventListener('click', function () {
    clearLog();
    logPanel.hidden = true;
  });

  pasteBtn.addEventListener('click', async function () {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setStatus('Seu navegador não permite ler o clipboard. Cole manualmente.', 'error');
      return;
    }
    try {
      var text = await navigator.clipboard.readText();
      if (!text) {
        setStatus('Clipboard vazio.', 'error');
        return;
      }
      urlInput.value = text.trim();
      setStatus('Link colado.', 'success');
    } catch (err) {
      setStatus(
        'Não foi possível ler o clipboard: ' +
          (err && err.message ? err.message : err),
        'error'
      );
    }
  });

  function startExtraction(url) {
    if (currentEs) {
      try { currentEs.close(); } catch (e) {}
      currentEs = null;
    }

    submitBtn.disabled = true;
    resetResult();
    clearLog();
    logPanel.hidden = false;
    setStatus('Processando...');

    var es = new EventSource('/api/extract?url=' + encodeURIComponent(url));
    currentEs = es;
    var finished = false;

    es.addEventListener('log', function (e) {
      try {
        appendLog(JSON.parse(e.data));
      } catch (err) {}
    });

    es.addEventListener('result', function (e) {
      finished = true;
      var data;
      try { data = JSON.parse(e.data); } catch (err) { data = { ok: false, error: 'JSON inválido' }; }
      es.close();
      currentEs = null;
      submitBtn.disabled = false;

      if (!data.ok) {
        setStatus('Erro: ' + (data.error || 'falha desconhecida'), 'error');
        return;
      }

      preview.src = data.videoUrl;
      captionEl.textContent = data.caption || '';

      var filename =
        (data.platform || 'video') +
        '-' +
        (data.shortcode || Date.now()) +
        '.mp4';
      downloadLink.href =
        '/api/download?url=' +
        encodeURIComponent(data.videoUrl) +
        '&filename=' +
        encodeURIComponent(filename);

      resultEl.hidden = false;
      setStatus(
        'Pronto via ' + (data.strategy || 'estratégia') + '. Use o botão abaixo para baixar.',
        'success'
      );
    });

    es.onerror = function () {
      if (finished) return;
      try { es.close(); } catch (e) {}
      currentEs = null;
      submitBtn.disabled = false;
      setStatus('Conexão com servidor interrompida.', 'error');
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return;
    startExtraction(url);
  });
})();
