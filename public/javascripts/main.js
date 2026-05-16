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
      setStatus('Não foi possível ler o clipboard: ' + (err && err.message ? err.message : err), 'error');
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return;

    submitBtn.disabled = true;
    resetResult();
    setStatus('Buscando vídeo...');

    try {
      var r = await fetch('/api/reel?url=' + encodeURIComponent(url));
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha na busca');

      preview.src = data.videoUrl;
      captionEl.textContent = data.caption || '';

      var filename = 'reel-' + (data.shortcode || Date.now()) + '.mp4';
      downloadLink.href =
        '/api/download?url=' + encodeURIComponent(data.videoUrl) +
        '&filename=' + encodeURIComponent(filename);

      resultEl.hidden = false;
      setStatus('Pronto! Use o botão abaixo para baixar.', 'success');
    } catch (err) {
      setStatus('Erro: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
