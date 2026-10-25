// ═══════ PITAYAS MEDIA — SERWER DLA TELEFONU ═══════
// Moduł „Pitayas Media” w aplikacji Pitayas na telefonie rozmawia z komputerem przez sieć lokalną:
//   GET  /info                     czy działa (kropka na ekranie startowym telefonu)
//   POST /api/analyze {url}        yt-dlp: tytuł, miniatura, dostępne jakości
//   GET  /api/jobs                 lista zadań
//   POST /api/jobs {...}           nowe zadanie (ytdlp | http | torrent)
//   POST /api/jobs/<id>/cancel     przerwij
//   DELETE /api/jobs/<id>          usuń z listy (plik zostaje)
//   GET  /files/<id>               gotowy plik (z obsługą Range) — tak plik przechodzi na telefon
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.opus': 'audio/ogg' };

function createServer({ engine, info, log }) {
    function send(res, status, body) {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
    }

    function readBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.setEncoding('utf8');
            req.on('data', (c) => {
                data += c;
                if (data.length > 200000) { reject(new Error('Za duże zapytanie')); req.destroy(); }
            });
            req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Niepoprawny JSON')); } });
            req.on('error', reject);
        });
    }

    function sendFile(req, res, file) {
        const stat = fs.statSync(file);
        const name = path.basename(file);
        const headers = {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
        };
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (m && (m[1] || m[2])) {
            let start = m[1] ? Number(m[1]) : stat.size - Number(m[2]);
            let end = m[1] && m[2] ? Number(m[2]) : stat.size - 1;
            start = Math.max(0, start); end = Math.min(end, stat.size - 1);
            if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
            if (req.method === 'HEAD') return res.end();
            return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'Content-Length': stat.size });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
    }

    return http.createServer(async (req, res) => {
        if (req.method === 'OPTIONS') return send(res, 204, {});
        const url = new URL(req.url, 'http://x');
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const route = `${req.method} ${parts.join('/')}`;
        try {
            if (route === 'GET info' || route === 'GET ') return send(res, 200, await info());
            if (route === 'POST api/analyze') {
                const body = await readBody(req);
                if (!/^https?:\/\//i.test(body.url || '')) return send(res, 400, { error: 'Zły link' });
                return send(res, 200, await engine.analyze(body.url));
            }
            if (route === 'GET api/jobs') return send(res, 200, { jobs: engine.list() });
            if (route === 'POST api/jobs') {
                const body = await readBody(req);
                const job = engine.add(body);
                log.info(`Telefon: nowe zadanie ${job.type} ${job.title || job.url || job.infoHash}`);
                return send(res, 200, { id: job.id });
            }
            if (parts[0] === 'api' && parts[1] === 'jobs' && parts[2]) {
                if (req.method === 'POST' && parts[3] === 'cancel') return send(res, engine.cancel(parts[2]) ? 200 : 404, { ok: true });
                if (req.method === 'DELETE' && parts.length === 3) { engine.remove(parts[2]); return send(res, 200, { ok: true }); }
            }
            if ((req.method === 'GET' || req.method === 'HEAD') && parts[0] === 'files' && parts[1]) {
                const job = engine.get(parts[1]);
                if (!job || job.state !== 'done' || !job.output || !fs.existsSync(job.output)) return send(res, 404, { error: 'Nie ma takiego pliku' });
                return sendFile(req, res, job.output);
            }
            send(res, 404, { error: 'not found' });
        } catch (err) {
            log.warn(`${route}: ${err.message}`);
            if (!res.headersSent) send(res, 500, { error: err.message });
        }
    });
}

module.exports = { createServer };
