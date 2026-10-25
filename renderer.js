// ═══════ PITAYAS MEDIA — OKNO ═══════
const $ = (id) => document.getElementById(id);
const esc = (s) => PitayaUI.escapeHTML(s);
const FORMATS = [['mp4', 'MP4'], ['mkv', 'MKV'], ['mp3', 'MP3'], ['flac', 'FLAC'], ['wav', 'WAV']];
const STATE = { queued: 'W kolejce', run: 'Pobieranie', post: 'Przetwarzanie', done: 'Gotowe', err: 'Błąd', canceled: 'Przerwane' };
const KIND = { ytdlp: 'yt-dlp', http: 'link', torrent: 'torrent' };

let info = null;          // wynik analizy linku
let format = 'mp4', height = 1080;

function setStatus(text, err) {
  $('status').textContent = text || '';
  $('status').className = `status-box${err ? ' err' : ''}`;
}

function renderOpts() {
  $('formats').innerHTML = FORMATS.map(([id, label]) => `<button class="chip-btn ${format === id ? 'on' : ''}" data-fmt="${id}">${label}</button>`).join('');
  const audio = ['mp3', 'flac', 'wav'].includes(format);
  const heights = (info && info.heights) || [];
  if (!heights.includes(height)) height = heights.find((h) => h <= height) || heights[0] || 1080;
  $('resBox').style.display = audio || !heights.length ? 'none' : '';
  $('heights').innerHTML = heights.map((h) => `<button class="chip-btn ${height === h ? 'on' : ''}" data-h="${h}">${h}p</button>`).join('');
  $('formats').querySelectorAll('[data-fmt]').forEach((b) => (b.onclick = () => { format = b.dataset.fmt; renderOpts(); }));
  $('heights').querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { height = Number(b.dataset.h); renderOpts(); }));
}

function resetPreview() {
  info = null;
  $('preview').classList.remove('show');
  $('opts').classList.remove('show');
}

async function analyze() {
  const url = $('url').value.trim();
  if (!url) return;
  resetPreview();
  if (/^magnet:\?/i.test(url)) {
    await window.api.add({ type: 'torrent', magnet: url });
    $('url').value = '';
    return setStatus('Torrent dodany do zadań');
  }
  if (!/^https?:\/\//i.test(url)) return setStatus('Wklej link zaczynający się od https:// albo magnet:', true);
  $('btnAnalyze').disabled = true;
  setStatus('Sprawdzam link… (za pierwszym razem pobiera się też yt-dlp)');
  try {
    info = await window.api.analyze(url);
    $('thumb').src = info.thumbnail || 'icon.png';
    $('title').textContent = info.title;
    $('meta').textContent = [info.uploader, info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.round(info.duration % 60)).padStart(2, '0')}` : '', info.isLive ? 'na żywo' : ''].filter(Boolean).join(' · ');
    $('preview').classList.add('show');
    $('opts').classList.add('show');
    renderOpts();
    setStatus('');
  } catch (err) {
    const msg = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    // Strona nieobsługiwana przez yt-dlp — może to zwykły plik (np. link ⚡ z Pitaya Streams)
    setStatus(`yt-dlp: ${msg}`, true);
    $('status').insertAdjacentHTML('beforeend', ' <button class="m-btn small" id="btnPlain">Pobierz jako zwykły plik</button>');
    $('btnPlain').onclick = async () => {
      await window.api.add({ type: 'http', url });
      $('url').value = '';
      setStatus('Plik dodany do zadań');
    };
  } finally {
    $('btnAnalyze').disabled = false;
  }
}

async function start() {
  if (!info) return;
  await window.api.add({ type: 'ytdlp', url: $('url').value.trim(), title: info.title, format, height });
  $('url').value = '';
  resetPreview();
  setStatus('Dodano do zadań');
}

function renderJobs(jobs) {
  $('jobCount').textContent = jobs.filter((j) => ['queued', 'run', 'post'].includes(j.state)).length
    ? `${jobs.filter((j) => ['queued', 'run', 'post'].includes(j.state)).length} w toku` : String(jobs.length);
  if (!jobs.length) { $('jobs').innerHTML = '<div class="empty">Brak zadań. Wklej link powyżej albo zleć pobieranie z telefonu.</div>'; return; }
  $('jobs').innerHTML = jobs.map((j) => {
    const busy = ['queued', 'run', 'post'].includes(j.state);
    const detail = [STATE[j.state] || j.state,
      j.state === 'run' ? `${Math.round(j.percent || 0)}%` : '', j.speed, j.eta && (j.state === 'run' ? `zostało ${j.eta}` : ''), j.size, j.error,
      j.forPhone ? '📱 dla telefonu' : ''].filter(Boolean).join(' · ');
    return `
      <div class="job ${j.state === 'err' ? 'err' : ''}">
        <div class="job-head">
          <span class="kind">${esc(KIND[j.type] || j.type)}</span>
          <div class="t"><b title="${esc(j.file || j.title)}">${esc(j.file || j.title)}</b><small>${esc(detail)}</small></div>
          ${j.state === 'done' ? `<button class="m-btn small" data-open="${esc(j.id)}"><svg class="ico"><use href="#i-folder"/></svg>Pokaż</button>` : ''}
          ${busy ? `<button class="m-btn small danger" data-cancel="${esc(j.id)}">Przerwij</button>` : `<button class="m-btn small" data-remove="${esc(j.id)}">Usuń</button>`}
        </div>
        ${busy ? `<div class="bar"><i style="width:${Math.round(j.percent || 0)}%"></i></div>` : ''}
      </div>`;
  }).join('');
  $('jobs').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => window.api.openFile(b.dataset.open)));
  $('jobs').querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => window.api.cancel(b.dataset.cancel)));
  $('jobs').querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => window.api.remove(b.dataset.remove)));
}

function renderServer(s) {
  $('portInput').value = s.port;
  if (s.error) { $('phoneBox').innerHTML = `<span style="color:var(--m-danger)">${esc(s.error)}</span>`; return; }
  $('phoneBox').innerHTML = `
    <div>W aplikacji <b>Pitayas</b> na telefonie: <b>Moduły → Pitayas Media</b>, a jako komputer wpisz:</div>
    <div>${s.addresses.length ? s.addresses.map((a) => `<code>${esc(a)}</code>`).join(' ') : '<code>brak sieci</code>'} &nbsp;port <code>${esc(s.port)}</code></div>
    <div>Telefon musi być w tej samej sieci Wi‑Fi albo Tailscale. Z telefonu zlecisz pobieranie (YouTube, torrenty z Pitaya Streams), a gotowy plik przejdzie na telefon.</div>`;
}

$('btnAnalyze').onclick = analyze;
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });
$('url').addEventListener('input', () => { if (info) resetPreview(); });
$('btnStart').onclick = start;
$('btnOpenDir').onclick = () => window.api.openDir();
$('btnChooseDir').onclick = async () => { $('dirText').textContent = await window.api.chooseDir(); };
$('btnPort').onclick = async () => {
  try { renderServer(await window.api.setPort($('portInput').value)); PitayaUI.showToast('Port zmieniony — wpisz go też w telefonie', 'success'); }
  catch (err) { PitayaUI.showToast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }
};
$('btnYtdlp').onclick = async () => {
  $('btnYtdlp').disabled = true;
  $('ytdlpStatus').textContent = 'Aktualizuję…';
  try { $('ytdlpStatus').textContent = await window.api.ytdlpUpdate(); }
  catch (err) { $('ytdlpStatus').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  $('btnYtdlp').disabled = false;
};
$('btnSettings').addEventListener('click', async () => {
  $('ytdlpStatus').textContent = (await window.api.ytdlpVersion()) || 'pobierze się przy pierwszym użyciu';
});

window.api.onJobs(renderJobs);
window.api.onServer(renderServer);
window.api.state().then((s) => {
  format = s.format || 'mp4';
  height = Number(s.height) || 1080;
  renderJobs(s.jobs);
  renderServer(s.server);
  $('dirText').textContent = s.downloadDir;
});
