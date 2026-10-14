import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three', 'build');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');

const TRACK_IDS = new Set(['gruene-welle', 'schanzen', 'steilkurven']);
const MAX_ENTRIES = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- Bestenliste (im Speicher, mit JSON-Datei als Sicherung) ----------
let board = {};
try {
  board = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  board = {};
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.writeFile(DATA_FILE, JSON.stringify(board));
    } catch (err) {
      console.error('Bestenliste konnte nicht gespeichert werden:', err.message);
    }
  }, 1000);
}

function topEntries(track, limit = 10) {
  return (board[track] || []).slice(0, limit);
}

function submitTime(track, name, time) {
  const list = board[track] || (board[track] = []);
  const existing = list.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (time >= existing.time) return list.indexOf(existing) + 1;
    existing.time = time;
    existing.name = name;
    existing.date = Date.now();
  } else {
    list.push({ name, time, date: Date.now() });
  }
  list.sort((a, b) => a.time - b.time);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  scheduleSave();
  const idx = list.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
  return idx === -1 ? null : idx + 1;
}

// ---------- HTTP ----------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveFile(res, baseDir, relPath) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir + path.sep) && filePath !== baseDir) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/health') return sendJson(res, 200, { ok: true });

  if (pathname === '/api/leaderboard') {
    if (req.method === 'GET') {
      const track = url.searchParams.get('track');
      if (!TRACK_IDS.has(track)) return sendJson(res, 400, { error: 'Unbekannte Strecke' });
      return sendJson(res, 200, { entries: topEntries(track) });
    }
    if (req.method === 'POST') {
      try {
        const data = JSON.parse(await readBody(req));
        const track = String(data.track || '');
        const name = String(data.name || '').trim().replace(/[^\p{L}\p{N} _\-.]/gu, '').slice(0, 16);
        const time = Number(data.time);
        if (!TRACK_IDS.has(track)) return sendJson(res, 400, { error: 'Unbekannte Strecke' });
        if (!name) return sendJson(res, 400, { error: 'Name fehlt' });
        if (!Number.isFinite(time) || time < 5000 || time > 30 * 60 * 1000) {
          return sendJson(res, 400, { error: 'Ungültige Zeit' });
        }
        const rank = submitTime(track, name, Math.round(time));
        return sendJson(res, 200, { rank, entries: topEntries(track) });
      } catch {
        return sendJson(res, 400, { error: 'Ungültige Anfrage' });
      }
    }
    return sendJson(res, 405, { error: 'Methode nicht erlaubt' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  if (pathname.startsWith('/vendor/three/')) {
    return serveFile(res, THREE_DIR, pathname.slice('/vendor/three/'.length));
  }

  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  return serveFile(res, PUBLIC_DIR, rel);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TrackRush läuft auf Port ${PORT}`);
});
