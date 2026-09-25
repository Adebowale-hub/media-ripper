#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  MediaRipper — Oracle Cloud Always-Free Automated Setup Script
# ═══════════════════════════════════════════════════════════════

set -e

echo "🚀 [1/5] Updating Ubuntu packages..."
sudo apt update && sudo apt upgrade -y

echo "📦 [2/5] Installing FFmpeg, Python3, and system dependencies..."
sudo apt install -y curl git build-essential ffmpeg python3 python3-pip python3-venv iptables-persistent

echo "⚡ [3/5] Installing latest yt-dlp..."
sudo python3 -m pip install -U --break-system-packages yt-dlp

echo "🟢 [4/5] Installing Node.js 20 LTS & PM2..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

echo "🛡️ [5/5] Configuring Ubuntu Firewall for Port 3000..."
# Oracle Ubuntu comes with strict internal iptables rules by default:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT || sudo iptables -I INPUT 1 -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo netfilter-persistent save

echo "📦 Installing project dependencies..."
npm install --only=production

echo "🚀 Starting MediaRipper 24/7 with PM2..."
pm2 delete media-ripper 2>/dev/null || true
pm2 start server/index.js --name "media-ripper"
pm2 save
sudo pm2 startup systemd -u ubuntu --hp /home/ubuntu || true

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🎉 SUCCESS! MediaRipper is live 24/7 on Oracle Cloud!"
echo "  🌐 Open your browser at: http://$(curl -s ifconfig.me):3000"
echo "═══════════════════════════════════════════════════════════════"
