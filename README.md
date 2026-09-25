# 🎵 MediaRipper

> A high-performance YouTube media downloader for music, high-res video, and zipped playlists — with an ultra-dark OLED aesthetic, real-time download streaming, and zero cloud storage requirements.

---

## ✨ Features

- 🎬 **Video + Audio**: Download in up to 4K, 1440p, 1080p, 720p (MP4, WebM, MKV).
- 🎵 **Audio Only**: High-bitrate audio extraction (MP3, M4A, FLAC Lossless, WAV, Opus).
- 📹 **Video Only**: Direct stream extraction without audio tracks.
- 📦 **Full Playlists to ZIP**: Automatically packages entire playlists into a single downloadable `.zip` file.
- ⚡ **Live Progress Updates**: Real-time progress bar with live download speed, file size, and percentage (via Server-Sent Events).
- 🔒 **Zero Cloud Storage**: All processing is local and temporary; files stream directly onto the user's device and auto-clean.
- 🖤 **OLED Dark Aesthetic**: Pitch-black interface with razor-sharp geometric styling, responsive for desktop and mobile phones.

---

## 🚀 Quick Start (Local)

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or higher)
- [Python 3](https://python.org) & `yt-dlp` (`pip install yt-dlp`)
- [FFmpeg](https://ffmpeg.org) installed and added to PATH

### Installation & Run

```bash
# 1. Clone repository
git clone https://github.com/Adebowale-hub/media-ripper.git
cd media-ripper

# 2. Install dependencies
npm install

# 3. Start the application
npm start
```

Open your browser to: **`http://localhost:3000`**

---

## ☁️ 24/7 Cloud Hosting (Oracle Cloud Free Tier)

This repository includes a 1-step automated setup script for **Oracle Cloud Always-Free Ubuntu instances**:

```bash
chmod +x oracle-setup.sh
./oracle-setup.sh
```

The script automatically configures:
- Python 3 & latest `yt-dlp`
- `ffmpeg`
- Node.js LTS & PM2 process manager
- Ubuntu `iptables` firewall rules for port 3000 & 80

---

## 🐳 Docker Deployment

You can also run MediaRipper with Docker or Docker Compose:

```bash
docker compose up -d --build
```

---

## ⚠️ Legal Notice

This application is strictly for personal, fair-use archival and educational purposes. Please respect YouTube's Terms of Service and copyright laws.
