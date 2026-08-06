FROM node:20-slim

# Install system dependencies required by yt-dlp and audio/video processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definition
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy application source code
COPY . .

# Ensure working directories exist
RUN mkdir -p bin downloads

EXPOSE 3000

ENV PORT=3000
ENV MONGODB_URI="mongodb+srv://souravislam99099_db_user:Z8zn8imsOiq3wHCc@anydownloader.3cgpzjz.mongodb.net/?appName=anydownloader"

CMD ["npm", "start"]
