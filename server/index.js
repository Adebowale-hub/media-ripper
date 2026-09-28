const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve application base directory (supports pkg standalone executable)
const APP_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DOWNLOADS_DIR = path.join(APP_DIR, 'downloads');
const COOKIES_FILE = path.join(APP_DIR, 'cookies.txt');

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// If YOUTUBE_COOKIES env var is present, auto-write to cookies.txt (convenient for cloud deployment)
if (process.env.YOUTUBE_COOKIES) {
  try {
    fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
    console.log('🍪 Loaded YouTube cookies from YOUTUBE_COOKIES environment variable');
  } catch (err) {
    console.error('Failed to write YOUTUBE_COOKIES:', err);
  }
}

// Locate bundled or system yt-dlp and ffmpeg
const BUNDLED_YTDLP = path.join(APP_DIR, 'yt-dlp.exe');
const BUNDLED_FFMPEG = path.join(APP_DIR, 'ffmpeg.exe');

let EXEC_CMD = '';
let DEFAULT_ARGS = [];

if (fs.existsSync(BUNDLED_YTDLP)) {
  EXEC_CMD = BUNDLED_YTDLP;
  DEFAULT_ARGS = [];
  if (fs.existsSync(BUNDLED_FFMPEG)) {
    DEFAULT_ARGS.push('--ffmpeg-location', APP_DIR);
  }
} else if (process.platform !== 'win32' && fs.existsSync('/usr/local/bin/yt-dlp')) {
  EXEC_CMD = '/usr/local/bin/yt-dlp';
  DEFAULT_ARGS = [];
} else if (process.platform !== 'win32' && fs.existsSync('/usr/bin/yt-dlp')) {
  EXEC_CMD = '/usr/bin/yt-dlp';
  DEFAULT_ARGS = [];
} else {
  EXEC_CMD = process.platform === 'win32' ? 'python' : (fs.existsSync('/usr/bin/python3') ? 'python3' : 'python');
  DEFAULT_ARGS = ['-m', 'yt_dlp'];
}

function getYtDlpArgs(extraArgs = []) {
  const args = [...DEFAULT_ARGS];
  if (fs.existsSync(COOKIES_FILE)) {
    args.push('--cookies', COOKIES_FILE);
  }
  args.push('--no-check-certificates');
  // Android client bypasses YouTube bot detection on cloud IPs and supports
  // DASH streams (separate video+audio) unlike the iOS client.
  args.push('--extractor-args', 'youtube:player_client=android,web');
  return args.concat(extraArgs);
}

// API: Check if cookies are loaded
app.get('/api/cookies/status', (req, res) => {
  const hasCookies = fs.existsSync(COOKIES_FILE);
  let cookieInfo = null;
  if (hasCookies) {
    try {
      const stat = fs.statSync(COOKIES_FILE);
      const content = fs.readFileSync(COOKIES_FILE, 'utf8');
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      cookieInfo = { size: stat.size, entries: lines.length, modified: stat.mtime };
    } catch (e) { /* ignore */ }
  }
  res.json({ hasCookies, cookieInfo });
});

// API: Upload cookies.txt content from browser
app.post('/api/cookies', express.text({ limit: '5mb', type: '*/*' }), (req, res) => {
  const content = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'No cookie content provided.' });
  }
  // Basic validation: must look like a Netscape cookie file or have cookie entries
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const validLines = lines.filter(l => l.split('\t').length >= 6);
  if (validLines.length === 0) {
    return res.status(400).json({ error: 'Invalid cookies.txt format. Export from browser using a cookie exporter extension (Netscape format).' });
  }
  try {
    fs.writeFileSync(COOKIES_FILE, content, 'utf8');
    console.log(`🍪 Cookies updated via browser upload (${validLines.length} entries)`);
    res.json({ success: true, entries: validLines.length });
  } catch (err) {
    console.error('Failed to write cookies:', err);
    res.status(500).json({ error: 'Failed to save cookies file.' });
  }
});

// API: Delete cookies
app.delete('/api/cookies', (req, res) => {
  try {
    if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove cookies file.' });
  }
});

// Serve public static assets
const PUBLIC_DIR = fs.existsSync(path.join(APP_DIR, 'public'))
  ? path.join(APP_DIR, 'public')
  : path.join(__dirname, '..', 'public');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const sseClients = new Map();
const jobMeta = new Map();

// API: Fetch video / playlist metadata
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const args = getYtDlpArgs(['--dump-json', '--no-playlist', '--no-warnings', url]);
  let output = '';
  let errorOutput = '';
  const proc = spawn(EXEC_CMD, args);

  proc.stdout.on('data', (d) => { output += d.toString(); });
  proc.stderr.on('data', (d) => { errorOutput += d.toString(); });
  proc.on('error', (err) => {
    console.error('[proc error]:', err);
    errorOutput += err.message;
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.warn(`[yt-dlp info failed, trying playlist mode. code: ${code}]:`, errorOutput);
      const plArgs = getYtDlpArgs(['--dump-json', '--flat-playlist', '--no-warnings', url]);
      let plOutput = '';
      let plErrorOutput = '';
      const plProc = spawn(EXEC_CMD, plArgs);
      plProc.stdout.on('data', (d) => { plOutput += d.toString(); });
      plProc.stderr.on('data', (d) => { plErrorOutput += d.toString(); });
      plProc.on('error', (err) => { plErrorOutput += err.message; });

      plProc.on('close', (plCode) => {
        if (plCode !== 0) {
          console.error(`[yt-dlp playlist failed. code: ${plCode}]:`, plErrorOutput);
          const rawErr = (errorOutput || plErrorOutput || '').trim();
          let userMsg = 'Could not fetch media info. Please verify the URL.';
          if (rawErr.includes("Sign in to confirm you're not a bot")) {
            userMsg = 'YouTube detected cloud hosting IP (Bot check). YouTube cookies needed.';
          } else if (rawErr) {
            const errLine = rawErr.split('\n').find(l => l.includes('ERROR:'));
            if (errLine) userMsg = errLine.replace(/^ERROR:\s*/, '');
          }
          return res.status(400).json({ error: userMsg, details: rawErr });
        }
        const lines = plOutput.trim().split('\n').filter(Boolean);
        const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        res.json({
          isPlaylist: true,
          title: entries[0]?.playlist_title || 'Playlist',
          count: entries.length,
          entries: entries.map(e => ({ id: e.id, title: e.title, duration: e.duration }))
        });
      });
      return;
    }
    try {
      const lines = output.trim().split('\n').filter(Boolean);
      const info = JSON.parse(lines[0]);
      res.json({
        isPlaylist: false,
        title: info.title,
        channel: info.channel || info.uploader,
        duration: info.duration,
        thumbnail: info.thumbnail,
        formats: (info.formats || []).filter(f => f.ext && (f.vcodec !== 'none' || f.acodec !== 'none')).map(f => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : null),
          filesize: f.filesize,
          vcodec: f.vcodec,
          acodec: f.acodec,
          note: f.format_note
        })).filter(f => f.resolution || f.acodec !== 'none')
      });
    } catch (e) {
      console.error('Failed to parse video info:', e, 'Raw output:', output);
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

// API: Start download job
app.post('/api/download', (req, res) => {
  const { url, type, format, quality, isPlaylist } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const jobId = uuidv4();
  const jobDir = path.join(DOWNLOADS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const args = getYtDlpArgs();
  if (type === 'audio') {
    const audioFmt = format || 'mp3';
    args.push('-x', '--audio-format', audioFmt, '--audio-quality', '0');
  } else if (type === 'video-only') {
    const res_q = quality || '1080';
    args.push('-f', `bestvideo[height<=${res_q}][ext=mp4]/bestvideo[height<=${res_q}]/bestvideo`);
  } else {
    const res_q = quality || '1080';
    args.push('-f', `bestvideo[height<=${res_q}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${res_q}]+bestaudio/best[height<=${res_q}]/best`);
    args.push('--merge-output-format', format || 'mp4');
  }

  if (isPlaylist) {
    args.push('--yes-playlist');
  } else {
    args.push('--no-playlist');
  }

  args.push('--newline', '--progress', '-o', path.join(jobDir, '%(title)s.%(ext)s'), url);
  jobMeta.set(jobId, { outputDir: jobDir, type, isPlaylist, done: false, files: [] });
  res.json({ jobId });

  const proc = spawn(EXEC_CMD, args);

  proc.stdout.on('data', (data) => {
    const line = data.toString();
    const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+[\w/]+)/);
    if (progressMatch) {
      sendSSE(jobId, {
        event: 'progress',
        percent: parseFloat(progressMatch[1]),
        size: progressMatch[2],
        speed: progressMatch[3]
      });
    }

    const destMatch = line.match(/\[download\] Destination: (.+)/);
    if (destMatch) {
      const meta = jobMeta.get(jobId);
      if (meta) meta.files.push(destMatch[1].trim());
    }

    const mergeMatch = line.match(/\[Merger\] Merging formats into "(.+)"/);
    if (mergeMatch) {
      const meta = jobMeta.get(jobId);
      if (meta) meta.finalFile = mergeMatch[1].trim();
    }

    const ffmpegMatch = line.match(/\[ffmpeg\] Destination: (.+)/);
    if (ffmpegMatch) {
      const meta = jobMeta.get(jobId);
      if (meta) meta.finalFile = ffmpegMatch[1].trim();
    }
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString();
    if (line.includes('ERROR')) {
      sendSSE(jobId, { event: 'error', message: line.replace(/\u001b\[.*?m/g, '') });
    }
  });

  proc.on('close', async (code) => {
    const meta = jobMeta.get(jobId);
    if (!meta) return;
    meta.done = true;

    if (code !== 0) {
      sendSSE(jobId, { event: 'error', message: 'Download failed. Check the URL or try again.' });
      return;
    }

    if (isPlaylist) {
      sendSSE(jobId, { event: 'zipping', message: 'Creating zip archive...' });
      const zipPath = path.join(DOWNLOADS_DIR, `${jobId}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(output);
      archive.directory(jobDir, false);
      archive.finalize();

      output.on('close', () => {
        meta.zipPath = zipPath;
        sendSSE(jobId, { event: 'done', downloadUrl: `/api/file/${jobId}?zip=1` });
        fs.rmSync(jobDir, { recursive: true, force: true });
      });
    } else {
      let filePath = meta.finalFile;
      if (!filePath) {
        const files = fs.readdirSync(jobDir);
        if (files.length > 0) filePath = path.join(jobDir, files[0]);
      }
      meta.singleFile = filePath;
      const fileName = path.basename(filePath || 'download');
      sendSSE(jobId, { event: 'done', downloadUrl: `/api/file/${jobId}`, fileName });
    }
  });
});

// API: SSE Progress Stream
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.set(jobId, res);
  res.write('data: {"event":"connected"}\n\n');
  req.on('close', () => { sseClients.delete(jobId); });
});

// API: Serve finished download
app.get('/api/file/:jobId', (req, res) => {
  const { jobId } = req.params;
  const { zip } = req.query;
  const meta = jobMeta.get(jobId);
  if (!meta) return res.status(404).json({ error: 'Job not found' });

  if (zip === '1' && meta.zipPath) {
    res.download(meta.zipPath, 'playlist.zip', (err) => {
      if (!err) {
        setTimeout(() => {
          if (fs.existsSync(meta.zipPath)) fs.unlinkSync(meta.zipPath);
          jobMeta.delete(jobId);
        }, 5000);
      }
    });
  } else if (meta.singleFile && fs.existsSync(meta.singleFile)) {
    res.download(meta.singleFile, path.basename(meta.singleFile), (err) => {
      if (!err) {
        setTimeout(() => {
          const dir = path.dirname(meta.singleFile);
          if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
          jobMeta.delete(jobId);
        }, 5000);
      }
    });
  } else {
    res.status(404).json({ error: 'File not ready yet' });
  }
});

function sendSSE(jobId, data) {
  const client = sseClients.get(jobId);
  if (client) client.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Fallback to single page app
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  🎵 MediaRipper is running!');
  console.log(`  🌐 URL: http://localhost:${PORT}`);
  console.log('========================================\n');

  // If running as packaged standalone .exe, auto-open browser
  if (process.pkg || process.env.AUTO_OPEN === 'true') {
    if (process.platform === 'win32') {
      exec(`start http://localhost:${PORT}`);
    } else if (process.platform === 'darwin') {
      exec(`open http://localhost:${PORT}`);
    } else {
      exec(`xdg-open http://localhost:${PORT}`);
    }
  }
});
