(function () {
  var form = document.getElementById('reel-form');
  var urlInput = document.getElementById('reel-url');
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
  var logCopy = document.getElementById('log-copy');
  var carouselSection = document.getElementById('carousel-section');
  var carouselEl = document.getElementById('carousel');
  var carouselCount = document.getElementById('carousel-count');
  var postResult = document.getElementById('post-result');
  var postCaption = document.getElementById('post-caption');
  var postItemsList = document.getElementById('post-items-list');

  var currentEs = null;
  var activeVid = null;

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = kind || '';
  }

  function formatTime(secs) {
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function resetPostResult() {
    postResult.hidden = true;
    postCaption.textContent = '';
    postItemsList.innerHTML = '';
  }

  function cancelExtraction() {
    if (activeVid) {
      activeVid._cancelled = true;
      try { activeVid.src = ''; } catch (e) {}
      try { activeVid.remove(); } catch (e) {}
      activeVid = null;
    }
  }

  function resetResult() {
    cancelExtraction();
    resetPostResult();
    resultEl.hidden = true;
    preview.removeAttribute('src');
    preview.load();
    captionEl.textContent = '';
    downloadLink.removeAttribute('href');
    carouselSection.hidden = true;
    carouselEl.innerHTML = '';
    carouselCount.textContent = '';
  }

  function renderPostCarousel(data) {
    postCaption.textContent = data.caption || '';
    postItemsList.innerHTML = '';

    data.items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'post-item';

      var mediaWrap = document.createElement('div');
      mediaWrap.className = 'post-item-media';

      if (item.type === 'video') {
        var vid = document.createElement('video');
        vid.controls = true;
        vid.playsInline = true;
        vid.preload = 'metadata';
        vid.src = item.streamUrl || item.url;
        mediaWrap.appendChild(vid);
      } else {
        var img = document.createElement('img');
        img.src = item.streamUrl || item.url;
        img.alt = 'Item ' + item.index;
        mediaWrap.appendChild(img);
      }

      var footer = document.createElement('div');
      footer.className = 'post-item-footer';

      var badge = document.createElement('span');
      badge.className = 'post-item-badge';
      badge.textContent = (item.type === 'video' ? 'Vídeo' : 'Foto') + ' ' + item.index;

      var dl = document.createElement('a');
      dl.href = item.downloadUrl;
      dl.download = '';
      dl.className = 'download-btn';
      dl.textContent = 'Baixar';

      footer.appendChild(badge);
      footer.appendChild(dl);
      card.appendChild(mediaWrap);
      card.appendChild(footer);
      postItemsList.appendChild(card);
    });

    postResult.hidden = false;
  }

  function extractFrames(streamUrl) {
    cancelExtraction();

    var vid = document.createElement('video');
    vid._cancelled = false;
    vid.muted = true;
    vid.preload = 'auto';
    vid.crossOrigin = 'anonymous';
    vid.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(vid);
    activeVid = vid;

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    vid.addEventListener('loadedmetadata', function () {
      if (vid._cancelled) { vid.remove(); return; }

      var duration = vid.duration;
      if (!duration || !isFinite(duration) || duration <= 0) {
        vid.remove();
        activeVid = null;
        return;
      }

      var MAX = 120;
      var count = Math.min(Math.ceil(duration), MAX);
      var step = duration / count;
      var timestamps = [];
      for (var i = 0; i < count; i++) timestamps.push(i * step);

      var vw = vid.videoWidth || 320;
      var vh = vid.videoHeight || 180;
      var thumbW = 160;
      var thumbH = Math.round(thumbW * vh / vw);
      canvas.width = thumbW;
      canvas.height = thumbH;

      var idx = 0;

      function captureFrame() {
        if (vid._cancelled) { vid.remove(); activeVid = null; return; }
        if (idx >= timestamps.length) {
          vid.remove();
          activeVid = null;
          if (carouselEl.children.length > 0) carouselSection.hidden = false;
          return;
        }

        function onSeeked() {
          vid.removeEventListener('seeked', onSeeked);
          if (vid._cancelled) { vid.remove(); activeVid = null; return; }

          try {
            ctx.drawImage(vid, 0, 0, thumbW, thumbH);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.72);
            var img = document.createElement('img');
            img.src = dataUrl;
            img.className = 'carousel-frame';
            var ts = timestamps[idx];
            img.title = formatTime(ts);
            (function (t) {
              img.addEventListener('click', function () {
                preview.currentTime = t;
                preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              });
            })(ts);
            carouselEl.appendChild(img);
            if (carouselEl.children.length === 1) carouselSection.hidden = false;
            carouselCount.textContent = '(' + carouselEl.children.length + '/' + timestamps.length + ')';
          } catch (e) {
            // SecurityError: canvas tainted — skip frame
          }

          idx++;
          captureFrame();
        }

        vid.addEventListener('seeked', onSeeked);
        vid.currentTime = timestamps[idx];
      }

      captureFrame();
    });

    vid.src = streamUrl;
    vid.load();
  }

  function clearLog() {
    logEl.innerHTML = '';
  }

  function appendLog(entry) {
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

  logCopy.addEventListener('click', async function () {
    var text = logEl.innerText || logEl.textContent || '';
    if (!text.trim()) {
      setStatus('Log vazio.', 'error');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      var prev = logCopy.textContent;
      logCopy.textContent = 'copiado ✓';
      setTimeout(function () { logCopy.textContent = prev; }, 1500);
    } catch (err) {
      setStatus(
        'Não foi possível copiar o log: ' +
          (err && err.message ? err.message : err),
        'error'
      );
    }
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
      var pasted = text.trim();
      urlInput.value = pasted;
      startExtraction(pasted);
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

    resetResult();
    clearLog();
    logPanel.hidden = true;
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

      if (!data.ok) {
        logPanel.hidden = false;
        setStatus('Erro: ' + (data.error || 'falha desconhecida'), 'error');
        return;
      }

      if (data.carousel) {
        renderPostCarousel(data);
        setStatus(
          data.items.length + ' itens via ' + (data.strategy || 'estratégia') + '.',
          'success'
        );
        return;
      }

      preview.src = data.videoUrl;
      captionEl.textContent = data.caption || '';
      downloadLink.href = data.downloadUrl;

      resultEl.hidden = false;
      setStatus(
        'Pronto via ' + (data.strategy || 'estratégia') + '. Use o botão abaixo para baixar.',
        'success'
      );

      if (data.streamUrl) extractFrames(data.streamUrl);
    });

    es.onerror = function () {
      if (finished) return;
      try { es.close(); } catch (e) {}
      currentEs = null;
      logPanel.hidden = false;
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
