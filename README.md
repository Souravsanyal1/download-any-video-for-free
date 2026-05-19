# 🎬 Universal Premium Video Downloader

A sleek, premium, high-performance web-based video downloader that supports downloading videos up to **8K resolution** and extracting audio to high-quality **MP3** from thousands of platforms (YouTube, Facebook, Twitter, Instagram, TikTok, etc.). Powered by **Node.js**, **Express**, and **yt-dlp**.

🌐 **[বাংলা সংস্করণ এখানে (Bangla Version is available here)](README.bn.md)**

---

## ✨ Features

- **🚀 Dual Engine Bootstrapping**: Automatically downloads the latest version of `yt-dlp` binary on startup. No manual setup needed!
- **🎞️ Ultra HD Resolution Support**: Downloader supports formats up to **8K, 4K, 2K, 1080p, 720p, 480p, 360p** depending on the source video.
- **⚡ Real-time SSE Stream Progress**: Employs Server-Sent Events (SSE) to stream download percentage, active download speed, total file size, and accurate ETA directly to the dashboard.
- **🎵 High-Fidelity Audio Extraction**: Extract audio from any video and convert it directly into a high-quality **MP3** format.
- **🔄 Post-Download Video Rotation**: Directly rotate downloaded videos by 90 degrees Clockwise or Counter-clockwise (uses FFmpeg integration).
- **📂 Quick Folder Access**: Easily open the downloads folder directly from the web browser UI with one click.
- **🎨 Gorgeous Glassmorphism UI**: Beautifully designed dark-themed dashboard featuring responsive cards, glowing accents, and elegant micro-animations.

---

## 🛠️ Tech Stack & Requirements

- **Frontend**: HTML5, Vanilla CSS3 (Custom Glassmorphism), Modern JavaScript
- **Backend**: Node.js, Express.js
- **Downloader Engine**: `yt-dlp` (Auto-managed)
- **Media Processing**: `FFmpeg` (Highly recommended for merging high-res video/audio streams and video rotation)

---

## 🚀 Getting Started

Follow these simple steps to set up and run the downloader locally on your computer:

### 1. Prerequisites

- **Node.js**: Make sure Node.js (version 16 or higher) is installed on your computer. [Download Node.js](https://nodejs.org/)
- **FFmpeg** (Recommended): To merge ultra-high-definition video with high-quality audio streams (like 1080p+ from YouTube) and rotate videos, install FFmpeg and add it to your system path environment variables.
  - *Windows*: Can be installed via `winget install Gyan.FFmpeg` or downloaded from the official site.
  - *macOS*: `brew install ffmpeg`
  - *Linux*: `sudo apt install ffmpeg`

### 2. Installation

Clone this repository to your local system:
```bash
git clone https://github.com/Souravsanyal1/download-any-video-for-free.git
cd download-any-video-for-free
```

Install the required npm dependencies:
```bash
npm install
```

### 3. Run the Application

Start the development and production server:
```bash
npm start
```
Once the server boots, it will:
1. Verify if `yt-dlp` exists in the local `./bin` directory. If not, it will **automatically download the latest release** from GitHub.
2. Check if `FFmpeg` is installed and ready.
3. Automatically launch your default web browser to: **`http://localhost:3000`**.

---

## 📁 File Structure

```text
├── bin/                 # Auto-downloaded yt-dlp binaries (Git ignored)
├── downloads/           # Saved media files (Git ignored)
├── public/              # Frontend client assets
│   ├── app.js           # Client-side logic, SSE listener & progress tracking
│   ├── index.html       # Glassmorphism Dashboard UI
│   └── style.css        # Premium custom CSS styling & animations
├── server.js            # Express server, spawn pipelines, FFmpeg router & SSE publisher
├── package.json         # Project metadata and dependencies
└── README.md            # English documentation
```

---

## ⚙️ How it Works

1. **Metadata Fetching**: When you paste a URL and click "Fetch Details", the backend runs `yt-dlp --dump-json` to fetch title, duration, uploader name, thumbnail, views, and available resolutions.
2. **Quality & Formatting Options**: The server checks if `FFmpeg` is installed. If installed, it fetches separate high-quality video and audio tracks and merges them. If `FFmpeg` is missing, it falls back to pre-merged video formats.
3. **Real-time SSE Stream**: During downloading, the server parses the raw command stdout stream of `yt-dlp` using regex and broadcasts percentage, download speed, and ETA back to the browser using Server-Sent Events (`/api/progress`).
4. **Post-Download Processing**: If rotation is chosen, the backend initiates a secondary `FFmpeg` process to rotate the video before flagging completion.

---

## 🤝 Contributing

Contributions are always welcome! If you have any suggestions, improvements, or bug fixes, feel free to open an issue or submit a pull request.

---

## 📝 License

Distributed under the ISC License. See `package.json` for details.

