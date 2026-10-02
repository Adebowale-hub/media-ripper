# Base Node image with Debian
FROM node:20-bookworm-slim

# Install system dependencies: ffmpeg (for merging), curl + ca-certificates (for yt-dlp binary download)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp — always pull the latest binary from GitHub to avoid stale pip cache
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Expose server port (default 3000, Render injects PORT)
ENV PORT=3000
EXPOSE 3000

# Health check (handles custom PORT or default 3000)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sh -c "curl -f http://localhost:\${PORT:-3000}/ || exit 1"

# Start the application
CMD ["node", "server/index.js"]
