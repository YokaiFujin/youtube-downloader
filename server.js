const express = require('express');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

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

      // ── Infos techniques ────────────────────────────────────────
      // Meilleur format vidéo (résolution max, H.264 préféré)
      const bestVideo = (info.formats || [])
        .filter(f => f.height && f.vcodec && f.vcodec !== 'none')
        .sort((a, b) => b.height !== a.height
          ? b.height - a.height
          : (b.vcodec.startsWith('avc') ? 1 : 0) - (a.vcodec.startsWith('avc') ? 1 : 0)
        )[0];

      // Meilleur format audio-only (bitrate max)
      const bestAudio = (info.formats || [])
        .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
        .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];

      const totalSize = (bestVideo?.filesize_approx || bestVideo?.filesize || 0)
                      + (bestAudio?.filesize_approx  || bestAudio?.filesize  || 0);

      res.json({
        title:       info.title,
        thumbnail:   info.thumbnail,
        duration:    info.duration,
        duration_str: info.duration_string,
        channel:     info.uploader || info.channel,
        view_count:  info.view_count,
        heights:     heights.slice(0, 8),
        tech: {
          fps:      bestVideo?.fps || info.fps || null,
          vcodec:   bestVideo?.vcodec || null,
          vbr:      Math.round(bestVideo?.vbr || bestVideo?.tbr || 0) || null,
          abr:      Math.round(bestAudio?.abr  || bestAudio?.tbr  || 0) || null,
          filesize: totalSize || null,
        }
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
    // Prefer H.264 (avc) for Premiere Pro / broad compatibility
    // Falls back to any codec if H.264 unavailable at that resolution
    const qualityMap = {
      'best': 'bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best',
      '2160': 'bestvideo[height<=2160][vcodec^=avc]+bestaudio/bestvideo[height<=2160]+bestaudio/best[height<=2160]',
      '1440': 'bestvideo[height<=1440][vcodec^=avc]+bestaudio/bestvideo[height<=1440]+bestaudio/best[height<=1440]',
      '1080': 'bestvideo[height<=1080][vcodec^=avc]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '720':  'bestvideo[height<=720][vcodec^=avc]+bestaudio/bestvideo[height<=720]+bestaudio/best[height<=720]',
      '480':  'bestvideo[height<=480][vcodec^=avc]+bestaudio/bestvideo[height<=480]+bestaudio/best[height<=480]',
      '360':  'bestvideo[height<=360][vcodec^=avc]+bestaudio/bestvideo[height<=360]+bestaudio/best[height<=360]',
    };
    args = args.concat(['-f', qualityMap[quality] || qualityMap['best'], '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k']);
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

// GET /api/update-ytdlp — mise à jour de yt-dlp.exe (Server-Sent Events)
app.get('/api/update-ytdlp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Helper : téléchargement HTTPS avec suivi de progression (suit les redirections)
  function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const follow = (u) => {
        https.get(u, { headers: { 'User-Agent': 'ytdl-electron' } }, r => {
          if (r.statusCode === 301 || r.statusCode === 302) {
            return follow(r.headers.location);
          }
          if (r.statusCode !== 200) {
            return reject(new Error(`HTTP ${r.statusCode}`));
          }
          const total = parseInt(r.headers['content-length'] || '0', 10);
          let received = 0;
          const file = fs.createWriteStream(dest);
          r.on('data', chunk => {
            received += chunk.length;
            file.write(chunk);
            if (total > 0 && onProgress) onProgress(Math.round(received / total * 100));
          });
          r.on('end',   () => { file.end(); resolve(); });
          r.on('error', err => { file.destroy(); reject(err); });
        }).on('error', reject);
      };
      follow(url);
    });
  }

  (async () => {
    const tmpPath = YTDLP_EXE + '.new';
    try {
      // 1. Version courante
      let current = '?';
      try { current = execSync(`"${YTDLP_EXE}" --version`, { encoding: 'utf8' }).trim(); } catch {}
      send({ type: 'status', message: `Version actuelle : ${current}. Vérification de la dernière release…` });

      // 2. Dernière release GitHub
      const releaseData = await fetch(
        'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
        { headers: { 'User-Agent': 'ytdl-electron' } }
      ).then(r => r.json());
      const latest = releaseData.tag_name;
      if (!latest) throw new Error('Impossible de récupérer la version GitHub');

      if (current === latest) {
        send({ type: 'uptodate', version: current });
        res.end(); return;
      }

      // 3. Téléchargement
      send({ type: 'status', message: `Mise à jour vers ${latest} en cours…` });
      const dlUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${latest}/yt-dlp.exe`;
      await downloadFile(dlUrl, tmpPath, pct => send({ type: 'progress', percent: pct }));

      // 4. Remplacement
      if (fs.existsSync(YTDLP_EXE)) fs.unlinkSync(YTDLP_EXE);
      fs.renameSync(tmpPath, YTDLP_EXE);

      send({ type: 'done', version: latest });
    } catch (e) {
      if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch {}
      send({ type: 'error', message: e.message });
    }
    res.end();
  })();
});

// Démarrage du serveur — exporté pour Electron
function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

module.exports = { startServer, TEMP_DIR };
