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

# Expose server port (default 3000, Render injects PORT)
ENV PORT=3000
EXPOSE 3000

# Health check (handles custom PORT or default 3000)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sh -c "curl -f http://localhost:\${PORT:-3000}/ || exit 1"

# Start the application
CMD ["node", "server/index.js"]
