# Base Node image with Debian
FROM node:20-bookworm-slim

# Install system dependencies: Python3, pip, ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN python3 -m pip install --no-cache-dir --break-system-packages yt-dlp

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Expose server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["node", "server/index.js"]
