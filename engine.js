// ═══════ PITAYAS MEDIA — SILNIK POBIERANIA ═══════
// Kolejka zadań: yt-dlp (YouTube i ~1800 innych stron), zwykłe linki HTTP (także ⚡ debrid z Pitaya Streams)
// i torrenty (torrent-stream). yt-dlp pobiera się sam przy pierwszym użyciu do folderu danych aplikacji,
// ffmpeg jest w paczce (ffmpeg-static).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|webm|mov|ts|wmv|mpg|mpeg|flv)$/i;
const MAX_PARALLEL = 2;

function ytdlpAsset() {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

const fmtBytes = (n) => (!n ? '' : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtEta = (s) => (!isFinite(s) || s <= 0 ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const safeName = (s) => String(s || 'plik').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'plik';

// Nazwa, która jeszcze nie istnieje: „Film.mkv”, „Film (2).mkv”…
function freePath(dir, name) {
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    for (let i = 1; ; i++) {
        const p = path.join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
        if (!fs.existsSync(p)) return p;
    }
}

function killTree(child) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    else child.kill('SIGTERM');
}

function createEngine({ dataDir, ffmpeg, getDownloadDir, log, onChange }) {
    const binDir = path.join(dataDir, 'bin');
    const tmpDir = path.join(dataDir, 'torrents');
    const ytdlp = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    const jobsFile = path.join(dataDir, 'jobs.json');
    let jobs = [];
    try { jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')); } catch {}
    // Po ponownym uruchomieniu niedokończone zadania są przerwane; gotowe zostają, jeśli plik jeszcze istnieje
    jobs = jobs.filter((j) => j.state !== 'done' || (j.output && fs.existsSync(j.output)));
    jobs.forEach((j) => { if (!['done', 'err', 'canceled'].includes(j.state)) Object.assign(j, { state: 'err', error: 'Przerwane — aplikacja została zamknięta' }); });
    const running = new Map();   // id → { cancel() }
    let installing = null;

    let saveTimer = null;
    function changed() {
        onChange && onChange();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { fs.writeFileSync(jobsFile, JSON.stringify(jobs.slice(0, 200), null, 2)); } catch {}
        }, 1000);
    }

    // ───── yt-dlp ─────
    async function ensureYtdlp(onProgress) {
        if (fs.existsSync(ytdlp)) return ytdlp;
        if (installing) return installing;
        installing = (async () => {
            fs.mkdirSync(binDir, { recursive: true });
            const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpAsset()}`;
            log.info('Pobieram yt-dlp:', url);
            const r = await fetch(url);
            if (!r.ok) throw new Error(`Pobieranie yt-dlp: HTTP ${r.status}`);
            const total = Number(r.headers.get('content-length')) || 0;
            let got = 0;
            const tmp = `${ytdlp}.part`;
            const body = Readable.fromWeb(r.body);
            body.on('data', (c) => { got += c.length; onProgress && onProgress(total ? got / total : 0); });
            await pipeline(body, fs.createWriteStream(tmp));
            fs.chmodSync(tmp, 0o755);
            fs.renameSync(tmp, ytdlp);
            return ytdlp;
        })().finally(() => { installing = null; });
        return installing;
    }

    function runYtdlp(args, onLine) {
        return new Promise((resolve, reject) => {
            const child = spawn(ytdlp, args, { windowsHide: true });
            let out = '', err = '';
            const lines = (cb) => {
                let rest = '';
                return (chunk) => {
                    rest += chunk.toString();
                    const parts = rest.split(/\r?\n|\r/);
                    rest = parts.pop();
                    parts.forEach(cb);
                };
            };
            child.stdout.on('data', lines((l) => { out += `${l}\n`; onLine && onLine(l); }));
            child.stderr.on('data', (c) => { err += c.toString(); if (err.length > 20000) err = err.slice(-10000); });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) resolve(out);
                else reject(new Error((err.trim().split('\n').filter((l) => /ERROR/.test(l)).pop() || err.trim().split('\n').pop() || `yt-dlp zakończył się kodem ${code}`).replace(/^ERROR:\s*/, '')));
            });
            if (onLine) onLine.child = child;
        });
    }

    async function analyze(url) {
        await ensureYtdlp();
        const out = await runYtdlp(['-J', '--no-playlist', '--no-warnings', url]);
        const data = JSON.parse(out);
        const heights = [...new Set((data.formats || [])
            .filter((f) => f.vcodec !== 'none' && f.width && f.height)
            .map((f) => Math.min(f.width, f.height))
            .filter((h) => h >= 240))].sort((a, b) => b - a);
        return {
            title: data.title || data.id,
            thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : ''),
            duration: data.duration || 0,
            uploader: data.uploader || data.channel || '',
            heights,
            isLive: Boolean(data.is_live),
        };
    }

    function ytdlpArgs(job, dir) {
        const args = [job.url, '--no-playlist', '--newline', '--progress', '--no-warnings', '--trim-filenames', '150',
            '--ffmpeg-location', ffmpeg, '-o', path.join(dir, '%(title)s.%(ext)s'),
            '--progress-template', 'download:@@P %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s',
            '--print', 'after_move:@@F %(filepath)s'];
        if (['mp3', 'wav', 'flac'].includes(job.format)) {
            args.push('-x', '--audio-format', job.format, '--audio-quality', '0');
            if (job.format !== 'wav') args.push('--embed-thumbnail', '--add-metadata', '--convert-thumbnails', 'jpg', '--ppa', "ThumbnailsConvertor:-vf crop='ih:ih'");
        } else {
            // „res” w yt-dlp to krótszy bok, więc pionowe filmy też trafiają w wybraną jakość.
            // Przy równej jakości H.264 + AAC — odtworzy je każdy telefon.
            const h = Number(job.height) || 1080;
            args.push('-f', 'bv*+ba/b', '-S', job.format === 'mp4' ? `res:${h},vcodec:h264,acodec:m4a` : `res:${h}`,
                '--merge-output-format', job.format === 'mkv' ? 'mkv' : 'mp4', '--embed-thumbnail', '--add-metadata');
        }
        return args;
    }

    async function doYtdlp(job, ctl) {
        await ensureYtdlp();
        const dir = getDownloadDir();
        fs.mkdirSync(dir, { recursive: true });
        const onLine = (line) => {
            if (line.startsWith('@@P ')) {
                const [pct, speed, eta, total, estimate] = line.slice(4).split('|').map((s) => s.trim());
                const p = parseFloat(pct);
                Object.assign(job, {
                    percent: Math.min(99, isFinite(p) ? p : job.percent),
                    speed: speed && speed !== 'NA' && !/Unknown/.test(speed) ? speed : '',
                    eta: eta && eta !== 'NA' && !/Unknown/.test(eta) ? eta : '',
                    size: [total, estimate].find((s) => s && s !== 'NA' && !/N\/A|Unknown/.test(s)) || job.size,
                });
                changed();
            } else if (line.startsWith('@@F ')) {
                job.output = line.slice(4).trim();
            } else if (/^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|FFmpeg)/.test(line) && job.state === 'run') {
                job.state = 'post';
                changed();
            }
        };
        const p = runYtdlp(ytdlpArgs(job, dir), onLine);
        ctl.cancel = () => killTree(onLine.child);
        await p;
        if (!job.output || !fs.existsSync(job.output)) throw new Error('yt-dlp nie zapisał pliku');
    }

    // ───── Zwykły link (debrid, plik .mp4…) ─────
    function nameFromResponse(r, url, hint) {
        const cd = r.headers.get('content-disposition') || '';
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
        if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
        if (hint) return hint;
        try { return decodeURIComponent(new URL(r.url || url).pathname.split('/').pop()) || 'plik'; } catch { return 'plik'; }
    }

    async function doHttp(job, ctl) {
        const ac = new AbortController();
        ctl.cancel = () => ac.abort();
        const r = await fetch(job.url, { signal: ac.signal, redirect: 'follow' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        let name = safeName(nameFromResponse(r, job.url, job.name));
        if (!path.extname(name)) name += '.mp4';
        const dir = getDownloadDir();
        fs.mkdirSync(dir, { recursive: true });
        const out = freePath(dir, name);
        job.output = out;
        job.file = path.basename(out);
        const total = Number(r.headers.get('content-length')) || 0;
        let got = 0, lastT = Date.now(), lastGot = 0;
        const body = Readable.fromWeb(r.body);
        body.on('data', (c) => {
            got += c.length;
            const now = Date.now();
            if (now - lastT >= 1000) {
                const bps = (got - lastGot) * 1000 / (now - lastT);
                lastT = now; lastGot = got;
                Object.assign(job, { percent: total ? got * 100 / total : 0, speed: `${fmtBytes(bps)}/s`, eta: total ? fmtEta((total - got) / bps) : '', size: fmtBytes(total || got) });
                changed();
            }
        });
        try { await pipeline(body, fs.createWriteStream(`${out}.part`)); }
        catch (err) { try { fs.unlinkSync(`${out}.part`); } catch {} throw err; }
        fs.renameSync(`${out}.part`, out);
        job.size = fmtBytes(got);
    }

    // ───── Torrent ─────
    function pickFile(files, job) {
        if (Number.isInteger(job.fileIdx) && files[job.fileIdx]) return files[job.fileIdx];
        const videos = files.filter((f) => VIDEO_EXT.test(f.name) && !/sample/i.test(f.name));
        if (job.fileMustInclude && job.fileMustInclude.length) {
            const res = job.fileMustInclude.map((p) => { try { return new RegExp(p, 'i'); } catch { return null; } }).filter(Boolean);
            const hit = videos.find((f) => res.some((re) => re.test(f.name)));
            if (hit) return hit;
        }
        return (videos.length ? videos : files).reduce((a, b) => (b.length > a.length ? b : a));
    }

    async function doTorrent(job, ctl) {
        const torrentStream = require('torrent-stream');
        let magnet = job.magnet;
        if (!magnet) {
            if (!/^[a-f0-9]{40}$/i.test(job.infoHash || '')) throw new Error('Brak infoHash');
            magnet = `magnet:?xt=urn:btih:${job.infoHash}${(job.trackers || []).slice(0, 40).map((t) => `&tr=${encodeURIComponent(t)}`).join('')}`;
        }
        const work = path.join(tmpDir, job.id);
        const engine = torrentStream(magnet, { path: work, connections: 100, trackers: job.trackers && job.trackers.length ? job.trackers : undefined });
        let finished = false;
        const cleanup = () => new Promise((res) => engine.destroy(() => { fs.rm(work, { recursive: true, force: true }, () => res()); }));
        ctl.cancel = () => { if (!finished) { finished = true; engine.emit('pitaya-cancel'); } };
        job.state = 'run';
        job.eta = 'szukam źródeł…';
        changed();
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Nie znaleziono nikogo, kto udostępnia ten torrent')), 3 * 60 * 1000);
                engine.on('pitaya-cancel', () => { clearTimeout(timeout); reject(new Error('Przerwane')); });
                engine.on('ready', async () => {
                    clearTimeout(timeout);
                    try {
                        const file = pickFile(engine.files, job);
                        engine.files.forEach((f) => (f === file ? f.select() : f.deselect()));
                        const dir = getDownloadDir();
                        fs.mkdirSync(dir, { recursive: true });
                        const out = freePath(dir, safeName(path.basename(file.name)));
                        job.output = out;
                        job.file = path.basename(out);
                        job.title = job.title || engine.torrent.name;
                        let got = 0;
                        const timer = setInterval(() => {
                            const bps = engine.swarm.downloadSpeed();
                            Object.assign(job, {
                                percent: got * 100 / file.length, speed: `${fmtBytes(bps)}/s · ${engine.swarm.wires.length} peerów`,
                                eta: bps ? fmtEta((file.length - got) / bps) : '', size: fmtBytes(file.length),
                            });
                            changed();
                        }, 1000);
                        const rs = file.createReadStream();
                        rs.on('data', (c) => { got += c.length; });
                        engine.on('pitaya-cancel', () => rs.destroy(new Error('Przerwane')));
                        try { await pipeline(rs, fs.createWriteStream(`${out}.part`)); }
                        finally { clearInterval(timer); }
                        fs.renameSync(`${out}.part`, out);
                        resolve();
                    } catch (err) {
                        if (job.output) try { fs.unlinkSync(`${job.output}.part`); } catch {}
                        reject(err);
                    }
                });
            });
        } finally {
            finished = true;
            await cleanup();
        }
    }

    // ───── Kolejka ─────
    const RUNNERS = { ytdlp: doYtdlp, http: doHttp, torrent: doTorrent };

    function pump() {
        while (running.size < MAX_PARALLEL) {
            const job = [...jobs].reverse().find((j) => j.state === 'queued');
            if (!job) return;
            const ctl = { cancel: () => {} };
            running.set(job.id, ctl);
            job.state = 'run';
            job.startedAt = Date.now();
            changed();
            log.info(`Start [${job.type}] ${job.title || job.name || job.url || job.infoHash}`);
            RUNNERS[job.type](job, ctl).then(() => {
                let bytes = 0;
                try { bytes = fs.statSync(job.output).size; } catch {}
                Object.assign(job, { state: 'done', percent: 100, speed: '', eta: '', file: path.basename(job.output), size: fmtBytes(bytes) || job.size });
                log.info(`Gotowe: ${job.output}`);
            }).catch((err) => {
                if (job.state === 'canceled') return;
                Object.assign(job, { state: 'err', error: err.message, speed: '', eta: '' });
                log.warn(`Błąd [${job.type}]: ${err.message}`);
            }).finally(() => {
                running.delete(job.id);
                changed();
                pump();
            });
        }
    }

    function add(input) {
        const type = input.type;
        if (!RUNNERS[type]) throw new Error('Nieznany rodzaj zadania');
        if ((type === 'ytdlp' || type === 'http') && !/^https?:\/\//i.test(input.url || '')) throw new Error('Zły link');
        if (type === 'torrent' && !input.magnet && !input.infoHash) throw new Error('Brak torrenta');
        if (type === 'torrent' && input.magnet && !/^magnet:\?/i.test(input.magnet)) throw new Error('Zły link magnet');
        const job = {
            id: crypto.randomBytes(6).toString('hex'), type, state: 'queued', createdAt: Date.now(),
            url: input.url || '', magnet: input.magnet || '', infoHash: input.infoHash || '',
            fileIdx: Number.isInteger(input.fileIdx) ? input.fileIdx : undefined,
            fileMustInclude: Array.isArray(input.fileMustInclude) ? input.fileMustInclude.slice(0, 5).map(String) : undefined,
            trackers: Array.isArray(input.trackers) ? input.trackers.filter((t) => /^(udp|https?|wss?):\/\//.test(t)).slice(0, 60) : [],
            name: input.name ? safeName(input.name) : '', title: String(input.title || input.name || '').slice(0, 200),
            format: ['mp4', 'mkv', 'mp3', 'wav', 'flac'].includes(input.format) ? input.format : 'mp4',
            height: Number(input.height) || 0, forPhone: Boolean(input.forPhone),
            percent: 0, speed: '', eta: '', size: '', file: '', output: '', error: '',
        };
        jobs.unshift(job);
        changed();
        pump();
        return job;
    }

    function cancel(id) {
        const job = jobs.find((j) => j.id === id);
        if (!job) return false;
        if (job.state === 'queued') job.state = 'canceled';
        const ctl = running.get(id);
        if (ctl) { job.state = 'canceled'; ctl.cancel(); }
        changed();
        return true;
    }

    function remove(id) {
        cancel(id);
        jobs = jobs.filter((j) => j.id !== id);
        changed();
    }

    const publicJob = (j) => ({
        id: j.id, type: j.type, state: j.state, title: j.title || j.name || j.url, file: j.file, percent: j.percent,
        speed: j.speed, eta: j.eta, size: j.size, error: j.error, forPhone: j.forPhone, format: j.format, createdAt: j.createdAt,
    });

    return {
        analyze,
        add,
        cancel,
        remove,
        list: () => jobs.map(publicJob),
        get: (id) => jobs.find((j) => j.id === id),
        hasYtdlp: () => fs.existsSync(ytdlp),
        ensureYtdlp,
        updateYtdlp: async () => {
            await ensureYtdlp();
            return (await runYtdlp(['-U'])).trim().split('\n').pop();
        },
        ytdlpVersion: async () => (fs.existsSync(ytdlp) ? (await runYtdlp(['--version'])).trim() : ''),
        cancelAll: () => { for (const id of running.keys()) cancel(id); },
        active: () => running.size,
    };
}

module.exports = { createEngine };
