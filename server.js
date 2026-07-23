const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { spawn, exec } = require('child_process');
const open = require('open');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
}));

// Determine writable directory based on environment (Vercel uses /tmp)
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const baseDir = isVercel ? os.tmpdir() : __dirname;

const binDir = path.join(baseDir, 'bin');
const downloadsDir = path.join(baseDir, 'downloads');

try {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
} catch (e) {
  console.error('Directory creation warning:', e.message);
}

// OS specific binary
const isWindows = process.platform === 'win32';
const ytdlpFilename = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytdlpPath = path.join(binDir, ytdlpFilename);
const ytdlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpFilename}`;


let hasFfmpeg = false;
let isYtdlpReady = false;
let downloadProgressStreams = {}; // Store SSE responses to stream progress

// Check if FFmpeg is installed
exec('ffmpeg -version', (error) => {
  if (!error) {
    hasFfmpeg = true;
    console.log('✔ FFmpeg detected successfully.');
  } else {
    hasFfmpeg = false;
    console.log('⚠ FFmpeg not found on the system path. Audio/Video merging for 4K/8K requires FFmpeg.');
  }
});

// Redirect-handling file downloader
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    function get(requestUrl) {
      https.get(requestUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          get(response.headers.location);
          return;
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: Status ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }
    
    get(url);
  });
}

// Auto-download yt-dlp
async function ensureYtdlp() {
  if (fs.existsSync(ytdlpPath)) {
    isYtdlpReady = true;
    return;
  }
  
  console.log(`Downloading ${ytdlpFilename} from GitHub releases...`);
  try {
    await downloadFile(ytdlpUrl, ytdlpPath);
    if (!isWindows) {
      fs.chmodSync(ytdlpPath, 0o755); // make executable on Linux/macOS
    }
    isYtdlpReady = true;
    console.log('✔ yt-dlp binary downloaded successfully.');
  } catch (error) {
    console.error('✘ Failed to download yt-dlp binary:', error.message);
    throw error;
  }
}

// Format seconds into HH:MM:SS
function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (hrs > 0) parts.push(hrs.toString().padStart(2, '0'));
  parts.push(mins.toString().padStart(2, '0'));
  parts.push(secs.toString().padStart(2, '0'));
  return parts.join(':');
}

// Check on boot
ensureYtdlp().catch(() => {});

// Route: Get Status
app.get('/api/status', (req, res) => {
  res.json({
    ytdlpReady: isYtdlpReady,
    hasFfmpeg,
    platform: process.platform,
    downloadsFolder: downloadsDir
  });
});

// Route: Get Video Info
app.get('/api/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  try {
    await ensureYtdlp();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to initialize yt-dlp engine. Check internet connection.' });
  }

  console.log(`Fetching metadata for: ${videoUrl}`);

  // Run: yt-dlp --dump-json URL
  const child = spawn(ytdlpPath, ['--dump-json', videoUrl]);
  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`yt-dlp info failed: ${stderrData}`);
      return res.status(400).json({ error: 'Could not fetch video info. Make sure the URL is valid.' });
    }

    try {
      const info = JSON.parse(stdoutData);
      
      // Determine what high resolutions are available
      const formats = info.formats || [];
      const heights = new Set(formats.map(f => f.height).filter(h => h));
      const hasVideo = formats.some(f => f.vcodec !== 'none' && (f.height || f.width || f.resolution));
      
      const availableQualities = {
        '8k': heights.has(4320) || heights.has(2880) || formats.some(f => f.format_note && f.format_note.includes('4320p')),
        '4k': heights.has(2160) || formats.some(f => f.format_note && f.format_note.includes('2160p')),
        '2k': heights.has(1440) || formats.some(f => f.format_note && f.format_note.includes('1440p')),
        '1080p': heights.has(1080) || formats.some(f => f.format_note && f.format_note.includes('1080p')) || formats.some(f => f.vcodec !== 'none' && f.height >= 1000 && f.height < 1400),
        '720p': heights.has(720) || formats.some(f => f.format_note && f.format_note.includes('720p')) || formats.some(f => f.vcodec !== 'none' && f.height >= 600 && f.height < 1000),
        '480p': heights.has(480) || formats.some(f => f.format_note && f.format_note.includes('480p')) || formats.some(f => f.vcodec !== 'none' && f.height >= 400 && f.height < 600),
        '360p': heights.has(360) || formats.some(f => f.format_note && f.format_note.includes('360p')) || formats.some(f => f.vcodec !== 'none' && f.height >= 240 && f.height < 400),
        'audio': true
      };

      // Fallback: If there is video content but no standard category was matched,
      // map the best available format as "720p" or "1080p" so they can click and download!
      const matchedAnyVideo = ['8k', '4k', '2k', '1080p', '720p', '480p', '360p'].some(q => availableQualities[q]);
      if (hasVideo && !matchedAnyVideo) {
        const maxHeight = Math.max(...formats.map(f => f.height).filter(h => h), 0);
        if (maxHeight >= 1080) {
          availableQualities['1080p'] = true;
        } else {
          availableQualities['720p'] = true;
        }
      }

      res.json({
        title: info.title,
        thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : ''),
        duration: formatDuration(info.duration),
        duration_raw: info.duration,
        uploader: info.uploader || info.channel || 'Unknown',
        views: info.view_count ? info.view_count.toLocaleString() : 'Unknown',
        webpage_url: info.webpage_url,
        qualities: availableQualities
      });
    } catch (err) {
      console.error('Failed to parse yt-dlp output:', err);
      res.status(500).json({ error: 'Failed to process video metadata.' });
    }
  });
});

// SSE Route: Real-time progress channel
app.get('/api/progress', (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).send('Download ID is required');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  downloadProgressStreams[id] = res;

  req.on('close', () => {
    delete downloadProgressStreams[id];
  });
});

// Send progress update to frontend SSE stream
function sendProgress(id, data) {
  const stream = downloadProgressStreams[id];
  if (stream) {
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// Route: Download Video
app.post('/api/download', async (req, res) => {
  const { url, quality, id, rotate } = req.body;

  if (!url || !quality || !id) {
    return res.status(400).json({ error: 'Missing required parameters (url, quality, id)' });
  }

  try {
    await ensureYtdlp();
  } catch (e) {
    return res.status(500).json({ error: 'yt-dlp is not ready yet.' });
  }

  console.log(`Starting download [${id}] - Quality: ${quality}, Rotation: ${rotate || 'none'} for URL: ${url}`);
  res.json({ status: 'started' }); // Acknowledge request, progress streamed via SSE

  // Build formatting rules
  let formatArg = 'best';
  let postProcessArgs = [];

  if (quality === 'audio') {
    formatArg = 'bestaudio/best';
    postProcessArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  } else {
    // Map quality tag to max height
    let maxHeight = 1080;
    if (quality === '8k') maxHeight = 4320;
    else if (quality === '4k') maxHeight = 2160;
    else if (quality === '2k') maxHeight = 1440;
    else if (quality === '1080p') maxHeight = 1080;
    else if (quality === '720p') maxHeight = 720;
    else if (quality === '480p') maxHeight = 480;
    else if (quality === '360p') maxHeight = 360;

    if (hasFfmpeg) {
      // Merge best video up to height with best audio, falling back to any quality or pre-merged best format
      formatArg = `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/bestvideo+bestaudio/best`;
    } else {
      // No FFmpeg: must fetch pre-merged format, fallback to best available
      formatArg = `best[height<=${maxHeight}]/best`;
    }

    // Rotation is handled manually post-download inside the 'close' event handler to work perfectly on all platforms.
  }

  // File naming: Output directory / Title.Extension
  const outputTemplate = path.join(downloadsDir, '%(title)s.%(ext)s');

  const args = [
    '-f', formatArg,
    '-o', outputTemplate,
    '--force-overwrites',
    '--newline',
    ...postProcessArgs,
    url
  ];

  const child = spawn(ytdlpPath, args);
  let downloadedFilePath = '';

  child.stdout.on('data', (data) => {
    const rawText = data.toString();
    const lines = rawText.split('\n');

    lines.forEach((rawLine) => {
      const line = rawLine.trim();

      // Parse downloaded file target path
      const destMatch = line.match(/Destination:\s*(.+)/i) || 
                        line.match(/Merging formats into\s*(.+)/i) ||
                        line.match(/\[download\]\s*(.+?\.(?:mp4|mkv|webm|3gp|flv|avi|mp3))\s+has/i);
      if (destMatch) {
        let matchedPath = destMatch[1].replace(/"/g, '').trim();
        if (matchedPath && !path.isAbsolute(matchedPath)) {
          downloadedFilePath = path.resolve(process.cwd(), matchedPath);
        } else {
          downloadedFilePath = matchedPath;
        }
      }

      // Parse progress. Typical line:
      // [download]   5.2% of  120.40MiB at   10.22MiB/s ETA 00:11
      if (line.includes('[download]') && line.includes('%')) {
        const percentMatch = line.match(/([\d.]+)%/);
        const sizeMatch = line.match(/of\s+(?:~)?([\d.]+\w+)/);
        const speedMatch = line.match(/at\s+([\d.]+\w+\/s|Unknown\s+speed)/);
        const etaMatch = line.match(/ETA\s+([\d:]+)/);

        if (percentMatch) {
          sendProgress(id, {
            status: 'downloading',
            percent: parseFloat(percentMatch[1]),
            size: sizeMatch ? sizeMatch[1] : 'Unknown',
            speed: speedMatch ? speedMatch[1] : 'Calculating...',
            eta: etaMatch ? etaMatch[1] : 'Unknown'
          });
        }
      } else if (line.includes('[ffmpeg]') || line.includes('[ExtractAudio]')) {
        sendProgress(id, {
          status: 'merging',
          percent: 99,
          size: 'Merging streams...',
          speed: 'Processing with FFmpeg...',
          eta: 'Almost done'
        });
      }
    });
  });

  child.stderr.on('data', (data) => {
    const errLine = data.toString().trim();
    console.error(`[yt-dlp-err ${id}]: ${errLine}`);
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log(`✔ Download [${id}] completed successfully.`);
      
      // Perform manual FFmpeg rotation if requested and file path was captured
      if (rotate && rotate !== 'none' && hasFfmpeg && downloadedFilePath) {
        console.log(`[Rotation Needed]: Applying direct FFmpeg rotation [${rotate}] to file: ${downloadedFilePath}`);
        sendProgress(id, {
          status: 'merging',
          percent: 99,
          size: 'Rotating video...',
          speed: 'Applying transpose...',
          eta: 'Please wait...'
        });

        const ext = path.extname(downloadedFilePath);
        const base = path.basename(downloadedFilePath, ext);
        const dir = path.dirname(downloadedFilePath);
        const tempPath = path.join(dir, `${base}_rotated${ext}`);

        let vfFilter = '';
        if (rotate === '90_cw') {
          vfFilter = 'transpose=1';
        } else if (rotate === '90_ccw') {
          vfFilter = 'transpose=2';
        }

        if (vfFilter) {
          const ffmpegArgs = [
            '-y',
            '-i', downloadedFilePath,
            '-vf', vfFilter,
            tempPath
          ];

          console.log(`Running FFmpeg: ffmpeg ${ffmpegArgs.join(' ')}`);
          const ffmpegProc = spawn('ffmpeg', ffmpegArgs);

          ffmpegProc.stderr.on('data', (ffmpegData) => {
            const text = ffmpegData.toString();
            const timeMatch = text.match(/time=([\d:.]+)/);
            const fpsMatch = text.match(/fps=\s*([\d.]+)/);
            const speedMatch = text.match(/speed=\s*([\d.x]+)/);
            
            if (timeMatch) {
              sendProgress(id, {
                status: 'merging',
                percent: 99,
                size: 'Rotating video...',
                speed: `Rotating: ${fpsMatch ? fpsMatch[1] : '30'} FPS (${speedMatch ? speedMatch[1] : '1x'})`,
                eta: `Processed: ${timeMatch[1]}`
              });
            }
          });

          ffmpegProc.on('close', (ffmpegCode) => {
            if (ffmpegCode === 0) {
              try {
                if (fs.existsSync(downloadedFilePath)) {
                  fs.unlinkSync(downloadedFilePath);
                }
                fs.renameSync(tempPath, downloadedFilePath);
                console.log(`✔ Direct FFmpeg rotation completed successfully. Saved to: ${downloadedFilePath}`);
                sendProgress(id, { status: 'completed' });
              } catch (err) {
                console.error('Error replacing rotated file (likely locked):', err);
                // Keep the rotated version as _rotated.ext so they still get it!
                console.log(`✔ Keeping rotated file due to lock: ${tempPath}`);
                sendProgress(id, { status: 'completed' });
              }
            } else {
              console.error(`✘ Direct FFmpeg rotation failed with code: ${ffmpegCode}`);
              sendProgress(id, { status: 'error', message: 'Direct rotation process failed.' });
            }
          });
        } else {
          sendProgress(id, { status: 'completed' });
        }
      } else {
        sendProgress(id, { status: 'completed' });
      }
    } else {
      console.error(`✘ Download [${id}] failed with code ${code}`);
      sendProgress(id, { status: 'error', message: `Download failed with exit code ${code}.` });
    }
  });
});

// Route: Open Downloads folder
app.post('/api/open-downloads', (req, res) => {
  open(downloadsDir)
    .then(() => res.json({ success: true }))
    .catch((err) => {
      console.error('Failed to open downloads folder:', err);
      res.status(500).json({ error: 'Failed to open directory' });
    });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`  Premium Video Downloader running locally!  `);
    console.log(`  URL: http://localhost:${PORT}             `);
    console.log(`  Downloading files to: ${downloadsDir}      `);
    console.log(`===============================================`);
    
    open(`http://localhost:${PORT}`).catch((err) => {
      console.log('Failed to automatically open browser:', err.message);
    });
  });
}

module.exports = app;

