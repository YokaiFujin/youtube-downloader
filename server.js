const express = require('express');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TEMP_DIR = path.join(os.tmpdir(), 'yt-downloader');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Clean temp subdirs older than 2 hours
setInterval(() => {
  try {
    fs.readdirSync(TEMP_DIR).forEach(f => {
      const fp = path.join(TEMP_DIR, f);
      if (Date.now() - fs.statSync(fp).mtimeMs > 7200000)
        fs.rmSync(fp, { recursive: true, force: true });
    });
  } catch {}
}, 600000);

const YTDLP_EXE = path.join(__dirname, 'yt-dlp.exe');

// Detect ffmpeg: local bin/ folder → PATH → AutoPod fallback
function getFfmpegDir() {
  const local = path.join(__dirname, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(local)) return path.join(__dirname, 'bin');
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return null; } catch {}
  const autopod = 'C:\\Program Files (x86)\\Common Files\\AutoPod\\ffmpeg\\bin';
  if (fs.existsSync(path.join(autopod, 'ffmpeg.exe'))) return autopod;
  return null;
}
const FFMPEG_DIR = getFfmpegDir();

function ytdlp(args) {
  const ffmpegArgs = FFMPEG_DIR ? ['--ffmpeg-location', FFMPEG_DIR] : [];
  return spawn(YTDLP_EXE, [...ffmpegArgs, ...args], { shell: false });
}

// GET /api/info?url=...
app.get('/api/info', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL manquante' });

  const proc = ytdlp(['--dump-json', '--no-playlist', url]);
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: err.trim() || 'Impossible de récupérer les infos' });
    try {
      const info = JSON.parse(out);
      const heights = [...new Set(
        (info.formats || [])
          .filter(f => f.height && f.vcodec !== 'none')
          .map(f => f.height)
          .sort((a, b) => b - a)
      )];
      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        duration_str: info.duration_string,
        channel: info.uploader || info.channel,
        view_count: info.view_count,
        heights: heights.slice(0, 8)
      });
    } catch {
      res.status(500).json({ error: 'Parsing JSON échoué' });
    }
  });
});

// GET /api/download — Server-Sent Events
app.get('/api/download', (req, res) => {
  const { url, format, quality } = req.query;
  if (!url) return res.status(400).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const id = crypto.randomBytes(8).toString('hex');
  const dlDir = path.join(TEMP_DIR, id);
  fs.mkdirSync(dlDir, { recursive: true });
  const outTemplate = path.join(dlDir, '%(title)s - %(channel)s.%(ext)s');

  let args = ['--no-playlist', '-o', outTemplate];

  if (format === 'mp3') {
    args = args.concat(['-x', '--audio-format', 'mp3', '--audio-quality', '0']);
  } else {
    const qualityMap = {
      'best': 'bestvideo+bestaudio/best',
      '2160': 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
      '1440': 'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
      '1080': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '720':  'bestvideo[height<=720]+bestaudio/best[height<=720]',
      '480':  'bestvideo[height<=480]+bestaudio/best[height<=480]',
      '360':  'bestvideo[height<=360]+bestaudio/best[height<=360]',
    };
    args = args.concat(['-f', qualityMap[quality] || qualityMap['best'], '--merge-output-format', 'mp4']);
  }

  args.push(url);

  const proc = ytdlp(args);
  let foundFile = null;

  const parseOutput = (text) => {
    const destMatch = text.match(/\[download\] Destination: (.+)/);
    const mergeMatch = text.match(/\[Merger\] Merging formats into "(.+)"/);
    const alreadyMatch = text.match(/\[download\] (.+) has already been downloaded/);
    if (destMatch) foundFile = destMatch[1].trim();
    if (mergeMatch) foundFile = mergeMatch[1].trim();
    if (alreadyMatch) foundFile = alreadyMatch[1].trim();

    const pctMatch = text.match(/(\d+\.?\d*)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)/);
    const simplePctMatch = text.match(/\[download\]\s+(\d+\.?\d*)%/);

    if (pctMatch) {
      send({ type: 'progress', percent: parseFloat(pctMatch[1]), size: pctMatch[2], speed: pctMatch[3] });
    } else if (simplePctMatch) {
      send({ type: 'progress', percent: parseFloat(simplePctMatch[1]) });
    } else if (text.trim()) {
      send({ type: 'log', message: text.trim() });
    }
  };

  proc.stdout.on('data', d => d.toString().split('\n').forEach(parseOutput));
  proc.stderr.on('data', d => d.toString().split('\n').forEach(line => {
    if (line.trim()) send({ type: 'log', message: line.trim() });
  }));

  proc.on('close', code => {
    if (code === 0) {
      if (!foundFile || !fs.existsSync(foundFile)) {
        const files = fs.readdirSync(dlDir);
        if (files.length > 0) foundFile = path.join(dlDir, files[0]);
      }
      if (foundFile && fs.existsSync(foundFile)) {
        send({ type: 'done', fileId: id, filename: path.basename(foundFile) });
      } else {
        send({ type: 'error', message: 'Fichier introuvable après téléchargement' });
      }
    } else {
      send({ type: 'error', message: 'Téléchargement échoué (code ' + code + ')' });
    }
    res.end();
  });

  req.on('close', () => proc.kill());
});

// Démarrage du serveur — exporté pour Electron
function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

module.exports = { startServer, TEMP_DIR };
