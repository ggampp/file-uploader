(function () {
  var form = document.getElementById('reel-form');
  var urlInput = document.getElementById('reel-url');
  var submitBtn = document.getElementById('submit-btn');
  var statusEl = document.getElementById('status');
  var resultEl = document.getElementById('result');
  var preview = document.getElementById('preview');
  var captionEl = document.getElementById('caption');
  var downloadLink = document.getElementById('download-link');

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = kind || '';
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return;

    submitBtn.disabled = true;
    resultEl.hidden = true;
    preview.removeAttribute('src');
    preview.load();
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
