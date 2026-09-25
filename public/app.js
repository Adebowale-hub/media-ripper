// ═══════════════════════════════════════
// MediaRipper — Frontend JavaScript
// ═══════════════════════════════════════

let currentInfo = null;
let currentType = 'video';

// Utility: Format seconds to HH:MM:SS or MM:SS
function formatDuration(secs) {
  if (!secs && secs !== 0) return '';
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Fetch media metadata
async function fetchInfo() {
  const input = document.getElementById('url-input');
  const url = input ? input.value.trim() : '';

  if (!url) {
    showUrlError('Please paste a YouTube URL or playlist link.');
    return;
  }

  // Basic client-side sanity check for YouTube URL
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
    showUrlError('Please enter a valid YouTube video or playlist URL.');
    return;
  }

  hideUrlError();
  setFetchLoading(true);

  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok) {
      showUrlError(data.error || 'Could not retrieve media info. Please verify the URL.');
      setFetchLoading(false);
      return;
    }

    currentInfo = data;
    displayInfo(data);
  } catch (err) {
    showUrlError('Network error. Check if the server is running.');
  } finally {
    setFetchLoading(false);
  }
}

// Display metadata in info card
function displayInfo(data) {
  document.getElementById('input-section').hidden = true;
  const card = document.getElementById('info-card');
  card.hidden = false;

  const thumbEl = document.getElementById('info-thumbnail');
  const titleEl = document.getElementById('info-title');
  const metaEl = document.getElementById('info-meta');
  const playlistBadge = document.getElementById('playlist-badge');
  const playlistCount = document.getElementById('playlist-count');
  const playlistOpt = document.getElementById('playlist-option');
  const playlistToggle = document.getElementById('playlist-toggle');

  if (data.isPlaylist) {
    const firstEntry = data.entries && data.entries[0];
    thumbEl.src = firstEntry && firstEntry.id
      ? `https://img.youtube.com/vi/${firstEntry.id}/mqdefault.jpg`
      : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400';
    titleEl.textContent = data.title || 'YouTube Playlist';
    metaEl.textContent = `${data.count || (data.entries ? data.entries.length : 0)} videos`;
    playlistBadge.hidden = false;
    playlistCount.textContent = `${data.count || 0} videos`;
    playlistOpt.hidden = false;
    playlistToggle.checked = true;
  } else {
    thumbEl.src = data.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400';
    titleEl.textContent = data.title || 'YouTube Video';
    const durStr = formatDuration(data.duration);
    metaEl.textContent = [data.channel, durStr].filter(Boolean).join(' • ');
    playlistBadge.hidden = true;
    playlistOpt.hidden = true;
    playlistToggle.checked = false;
  }

  // Populate dynamic quality options if available
  if (data.formats && Array.isArray(data.formats) && !data.isPlaylist) {
    const videoFormats = data.formats.filter(f => f.resolution);
    if (videoFormats.length > 0) {
      const heights = [...new Set(videoFormats.map(f => {
        const m = f.resolution.match(/(\d+)p?/);
        return m ? parseInt(m[1], 10) : null;
      }).filter(h => h && h >= 240))].sort((a, b) => b - a);

      if (heights.length > 0) {
        const qSelect = document.getElementById('quality-select');
        qSelect.innerHTML = '';
        heights.forEach((h, idx) => {
          const opt = document.createElement('option');
          opt.value = h;
          opt.textContent = `${h}p ${h >= 2160 ? '(4K)' : h >= 1440 ? '(2K)' : h >= 720 ? '(HD)' : ''}`.trim();
          if (idx === 0 || h === 1080) opt.selected = true;
          qSelect.appendChild(opt);
        });
      }
    }
  }

  // Reset type selection to default (video)
  selectType('video');
}

// Select download mode: video, audio, or video-only
function selectType(type) {
  currentType = type;
  document.querySelectorAll('.type-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  const isAudio = type === 'audio';
  document.getElementById('quality-group').hidden = isAudio;
  document.getElementById('format-group').hidden = isAudio;
  document.getElementById('audio-format-group').hidden = !isAudio;
}

// Trigger download job
async function startDownload() {
  if (!currentInfo) return;

  const urlInput = document.getElementById('url-input');
  const url = urlInput ? urlInput.value.trim() : '';
  const type = currentType;
  const quality = document.getElementById('quality-select').value;
  const format = type === 'audio'
    ? document.getElementById('audio-format-select').value
    : document.getElementById('format-select').value;

  const isPlaylist = !!(currentInfo.isPlaylist && document.getElementById('playlist-toggle').checked);

  // Transition UI to progress view
  document.getElementById('info-card').hidden = true;
  showCard('progress-card');
  setProgress(0, 'Initializing download...', 'Contacting server...');

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, format, quality, isPlaylist })
    });

    const json = await res.json();
    if (!res.ok || json.error) {
      showError(json.error || 'Failed to start download process.');
      return;
    }

    const { jobId } = json;

    // Listen for live SSE progress updates
    const evtSource = new EventSource(`/api/progress/${jobId}`);

    evtSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSSEEvent(payload, evtSource, isPlaylist);
      } catch (e) {
        console.error('SSE JSON parse error:', e);
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
      showError('Connection to server lost. Please check terminal logs.');
    };
  } catch (err) {
    showError(`Error starting download: ${err.message}`);
  }
}

// Handle Server-Sent Events from backend
function handleSSEEvent(data, evtSource, isPlaylist) {
  switch (data.event) {
    case 'connected':
      setProgress(2, 'Connected to download engine...', 'Preparing stream...');
      break;

    case 'progress': {
      const pct = typeof data.percent === 'number' ? data.percent : parseFloat(data.percent) || 0;
      const sizeStr = data.size ? `${data.size}` : '';
      const speedStr = data.speed ? `at ${data.speed}` : '';
      const detail = [sizeStr, speedStr].filter(Boolean).join(' ');
      setProgress(pct, `Downloading... ${Math.round(pct)}%`, detail);
      break;
    }

    case 'zipping':
      setProgress(98, 'Packaging playlist...', data.message || 'Creating ZIP archive...');
      break;

    case 'done':
      evtSource.close();
      hideCard('progress-card');
      showDone(data.downloadUrl, data.fileName, isPlaylist);
      break;

    case 'error':
      evtSource.close();
      showError(data.message || 'Download error encountered.');
      break;

    default:
      break;
  }
}

// Show completed download card
function showDone(downloadUrl, fileName, isPlaylist) {
  showCard('done-card');
  const link = document.getElementById('done-link');
  link.href = downloadUrl;

  const defaultName = isPlaylist ? 'playlist.zip' : 'media-ripper-download';
  const finalName = fileName || defaultName;
  link.setAttribute('download', finalName);

  document.getElementById('done-sub').textContent = isPlaylist
    ? 'All playlist tracks are bundled into a ZIP file ready for saving!'
    : `"${finalName}" is processed and ready to download!`;

  // Auto-trigger download
  try {
    const autoLink = document.createElement('a');
    autoLink.href = downloadUrl;
    autoLink.download = finalName;
    document.body.appendChild(autoLink);
    autoLink.click();
    document.body.removeChild(autoLink);
  } catch (e) {
    console.log('Auto-download blocked or deferred to button click:', e);
  }
}

// Show error card
function showError(message) {
  hideCard('progress-card');
  showCard('error-card');
  document.getElementById('error-msg-text').textContent = message;
}

// Reset UI back to initial search input
function resetApp() {
  currentInfo = null;
  currentType = 'video';
  const urlInput = document.getElementById('url-input');
  if (urlInput) urlInput.value = '';

  hideUrlError();
  hideCard('progress-card');
  hideCard('done-card');
  hideCard('error-card');
  document.getElementById('info-card').hidden = true;
  document.getElementById('input-section').hidden = false;

  // Reset tab selection
  document.querySelectorAll('.type-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.type === 'video');
  });
  document.getElementById('quality-group').hidden = false;
  document.getElementById('format-group').hidden = false;
  document.getElementById('audio-format-group').hidden = true;
}

// Helpers
function setProgress(percent, status, detail) {
  const bar = document.getElementById('progress-bar');
  const pctEl = document.getElementById('progress-percent');
  const statusEl = document.getElementById('progress-status');
  const detailEl = document.getElementById('progress-detail');

  const clamped = Math.min(Math.max(percent, 0), 100);
  if (bar) bar.style.width = `${clamped}%`;
  if (pctEl) pctEl.textContent = `${Math.round(clamped)}%`;
  if (statusEl) statusEl.textContent = status;
  if (detailEl) detailEl.textContent = detail || '';
}

function showCard(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function hideCard(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function showUrlError(msg) {
  const el = document.getElementById('url-error');
  if (el) {
    el.textContent = msg;
    el.hidden = false;
  }
}

function hideUrlError() {
  const el = document.getElementById('url-error');
  if (el) el.hidden = true;
}

function setFetchLoading(loading) {
  const btn = document.getElementById('fetch-btn');
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text) text.hidden = loading;
  if (loader) loader.hidden = !loading;
}

// Paste example buttons
function pasteExample(type) {
  const input = document.getElementById('url-input');
  if (!input) return;
  if (type === 'single') {
    input.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  } else {
    input.value = 'https://www.youtube.com/playlist?list=PLbpi6ZahtOH6Ar_3GPy3workFCo_6E60P';
  }
  fetchInfo();
}

// Enter key submission
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('url-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fetchInfo();
    });
  }
});
