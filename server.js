const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { spawn, exec } = require('child_process');
const open = require('open');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
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

// MongoDB Atlas Configuration & Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://souravislam99099_db_user:Z8zn8imsOiq3wHCc@anydownloader.3cgpzjz.mongodb.net/?appName=anydownloader';
const DB_NAME = 'anydownloader';
const COLLECTION_NAME = 'history';

let mongoClient = null;
let db = null;
let historyCollection = null;
let isMongoConnected = false;

async function connectMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    historyCollection = db.collection(COLLECTION_NAME);
    isMongoConnected = true;
    console.log('✔ Connected to MongoDB Atlas successfully.');
  } catch (err) {
    isMongoConnected = false;
    console.warn('⚠ MongoDB Atlas connection warning:', err.message);
    // Retry connection after 30 seconds
    setTimeout(connectMongoDB, 30000);
  }
}

connectMongoDB().catch(console.error);

// MongoDB Helper Methods
async function saveHistoryItem(item) {
  if (!isMongoConnected || !historyCollection) return null;
  try {
    const historyDoc = {
      title: item.title || 'Untitled Video',
      url: item.url || item.webpage_url || '',
      quality: item.quality || '720p',
      thumbnail: item.thumbnail || '',
      duration: item.duration || '00:00',
      uploader: item.uploader || 'Unknown',
      status: item.status || 'completed',
      fileName: item.fileName || '',
      downloadedAt: item.downloadedAt ? new Date(item.downloadedAt) : new Date(),
    };
    const result = await historyCollection.insertOne(historyDoc);
    return { ...historyDoc, _id: result.insertedId.toString(), id: result.insertedId.toString() };
  } catch (err) {
    console.error('Failed to save history to MongoDB:', err.message);
    return null;
  }
}

async function getHistoryItems() {
  if (!isMongoConnected || !historyCollection) return [];
  try {
    const docs = await historyCollection.find({}).sort({ downloadedAt: -1 }).limit(100).toArray();
    return docs.map(doc => ({
      id: doc._id.toString(),
      _id: doc._id.toString(),
      title: doc.title,
      url: doc.url,
      quality: doc.quality,
      thumbnail: doc.thumbnail,
      duration: doc.duration,
      uploader: doc.uploader,
      status: doc.status,
      fileName: doc.fileName,
      timestamp: doc.downloadedAt
    }));
  } catch (err) {
    console.error('Failed to fetch history from MongoDB:', err.message);
    return [];
  }
}

async function deleteHistoryItem(id) {
  if (!isMongoConnected || !historyCollection) return false;
  try {
    let query = {};
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    } else {
      query = { id: id };
    }
    const result = await historyCollection.deleteOne(query);
    return result.deletedCount > 0;
  } catch (err) {
    console.error('Failed to delete history item from MongoDB:', err.message);
    return false;
  }
}

async function clearHistoryItems() {
  if (!isMongoConnected || !historyCollection) return false;
  try {
    await historyCollection.deleteMany({});
    return true;
  } catch (err) {
    console.error('Failed to clear history in MongoDB:', err.message);
    return false;
  }
}

// OS specific binary
const isWindows = process.platform === 'win32';
const ytdlpFilename = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytdlpPath = path.join(binDir, ytdlpFilename);
const ytdlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlpFilename}`;


let hasFfmpeg = false;
let isYtdlpReady = fs.existsSync(ytdlpPath);
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
    mongoConnected: isMongoConnected,
    platform: process.platform,
    downloadsFolder: downloadsDir
  });
});

// Route: Get History from MongoDB
app.get('/api/history', async (req, res) => {
  const items = await getHistoryItems();
  res.json({
    success: true,
    mongoConnected: isMongoConnected,
    history: items
  });
});

// Route: Save/Sync History Item to MongoDB
app.post('/api/history', async (req, res) => {
  const item = req.body;
  if (!item || (!item.title && !item.url)) {
    return res.status(400).json({ error: 'History item metadata is required' });
  }
  const saved = await saveHistoryItem(item);
  res.json({ success: Boolean(saved), item: saved });
});

// Route: Delete History Item from MongoDB
app.delete('/api/history/:id', async (req, res) => {
  const { id } = req.params;
  const deleted = await deleteHistoryItem(id);
  res.json({ success: deleted });
});

// Route: Clear All History in MongoDB
app.post('/api/history/clear', async (req, res) => {
  const cleared = await clearHistoryItems();
  res.json({ success: cleared });
});

// In-memory cache for video info metadata to ensure instant response times
const videoInfoCache = new Map();

// Route: Get Video Info
app.get('/api/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  // Check in-memory cache for instant response (< 5ms)
  if (videoInfoCache.has(videoUrl)) {
    const cached = videoInfoCache.get(videoUrl);
    if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
      console.log(`⚡ Returning cached metadata for: ${videoUrl}`);
      return res.json(cached.data);
    } else {
      videoInfoCache.delete(videoUrl);
    }
  }

  try {
    await ensureYtdlp();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to initialize yt-dlp engine. Check internet connection.' });
  }

  console.log(`Fetching metadata for: ${videoUrl}`);

  // Run yt-dlp with speed optimization flags (--no-playlist, --skip-download, --no-call-home, --socket-timeout)
  const child = spawn(ytdlpPath, [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--no-call-home',
    '--skip-download',
    '--socket-timeout', '10',
    videoUrl
  ]);

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
        '1080p': heights.has(1080) || formats.some(f => (f.height >= 1000 && f.height <= 1400) || (f.width >= 1000 && f.width <= 1400)),
        '720p': heights.has(720) || formats.some(f => (f.height >= 600 && f.height <= 999) || (f.width >= 600 && f.width <= 999)),
        '480p': heights.has(480) || formats.some(f => (f.height >= 400 && f.height <= 599) || (f.width >= 400 && f.width <= 599)),
        '360p': heights.has(360) || formats.some(f => (f.height >= 200 && f.height <= 399) || (f.width >= 200 && f.width <= 399)),
        'audio': true
      };

      // Fallback: If there is video content but no standard category was matched,
      // map the best available format as "720p" or "1080p" so users can download
      const matchedAnyVideo = ['8k', '4k', '2k', '1080p', '720p', '480p', '360p'].some(q => availableQualities[q]);
      if (hasVideo && !matchedAnyVideo) {
        const maxHeight = Math.max(...formats.map(f => f.height).filter(h => h), 0);
        if (maxHeight >= 1000) {
          availableQualities['1080p'] = true;
        } else {
          availableQualities['720p'] = true;
        }
      }

      const directUrls = {};
      formats.forEach(f => {
        if (f.url && f.ext === 'mp4' && (f.protocol === 'https' || f.protocol === 'http') && !f.url.includes('.m3u8')) {
          const h = f.height || 0;
          const w = f.width || 0;
          if ((h >= 1000 || w >= 1000) && !directUrls['1080p']) directUrls['1080p'] = f.url;
          else if ((h >= 600 || w >= 600) && !directUrls['720p']) directUrls['720p'] = f.url;
          else if ((h >= 400 || w >= 400) && !directUrls['480p']) directUrls['480p'] = f.url;
          else if ((h >= 200 || w >= 200) && !directUrls['360p']) directUrls['360p'] = f.url;
        }
      });
      if (info.url && !info.url.includes('.m3u8') && !directUrls['720p']) {
        directUrls['720p'] = info.url;
      }

      const responseData = {
        title: info.title,
        thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : ''),
        duration: formatDuration(info.duration),
        duration_raw: info.duration,
        uploader: info.uploader || info.channel || 'Unknown',
        views: info.view_count ? info.view_count.toLocaleString() : 'Unknown',
        webpage_url: info.webpage_url,
        qualities: availableQualities,
        direct_urls: directUrls
      };

      videoInfoCache.set(videoUrl, { timestamp: Date.now(), data: responseData });
      res.json(responseData);
    } catch (err) {
      console.error('Failed to parse yt-dlp output:', err);
      res.status(500).json({ error: 'Failed to process video metadata.' });
    }
  });
});

// Route: Direct Stream Download (Pipes stdout straight to browser attachment)
app.get('/api/stream', async (req, res) => {
  const videoUrl = req.query.url;
  const quality = req.query.quality || '720p';

  if (!videoUrl) {
    return res.status(400).send('Video URL is required');
  }

  try {
    await ensureYtdlp();
  } catch (e) {
    return res.status(500).send('yt-dlp engine is not ready.');
  }

  let maxHeight = 1080;
  if (quality === '8k') maxHeight = 4320;
  else if (quality === '4k') maxHeight = 2160;
  else if (quality === '2k') maxHeight = 1440;
  else if (quality === '1080p') maxHeight = 1080;
  else if (quality === '720p') maxHeight = 720;
  else if (quality === '480p') maxHeight = 480;
  else if (quality === '360p') maxHeight = 360;

  const heightLimit = maxHeight > 360 ? maxHeight + 100 : maxHeight;

  let formatArg = quality === 'audio' 
    ? 'bestaudio/best' 
    : (hasFfmpeg 
        ? `bestvideo[height<=${heightLimit}]+bestaudio/best[height<=${heightLimit}]/bestvideo+bestaudio/best` 
        : `best[protocol^=http][height<=${heightLimit}]/best[ext=mp4][height<=${heightLimit}]/b[height<=${heightLimit}]/best[height<=${heightLimit}]/best[protocol^=http]/best`);

  const ext = quality === 'audio' ? 'mp3' : 'mp4';
  const fileName = `media_${Date.now()}.${ext}`;

  res.setHeader('Content-Type', quality === 'audio' ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  const args = [
    '--no-playlist',
    '--no-check-certificates',
    '-f', formatArg,
    '-o', '-',
    videoUrl
  ];

  const child = spawn(ytdlpPath, args);
  child.stdout.pipe(res);

  child.stderr.on('data', (data) => {
    console.error(`[stream-err]: ${data.toString()}`);
  });

  req.on('close', () => {
    try { child.kill(); } catch (e) {}
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
  res.json({ status: 'started' });

  // Build formatting rules
  let formatArg = 'best';
  let postProcessArgs = [];

  if (quality === 'audio') {
    formatArg = 'bestaudio/best';
    if (hasFfmpeg) {
      postProcessArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
    }
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

    const heightLimit = maxHeight > 360 ? maxHeight + 100 : maxHeight;

    if (hasFfmpeg) {
      formatArg = `bestvideo[height<=${heightLimit}]+bestaudio/best[height<=${heightLimit}]/bestvideo+bestaudio/best`;
    } else {
      // Without FFmpeg: Must prefer direct HTTP progressive mp4 streams (non-m3u8) so it downloads without FFmpeg muxing
      formatArg = `best[protocol^=http][height<=${heightLimit}]/best[ext=mp4][height<=${heightLimit}]/b[height<=${heightLimit}]/best[height<=${heightLimit}]/best[protocol^=http]/best`;
    }
  }

  const outputTemplate = path.join(downloadsDir, '%(title)s.%(ext)s');

  const args = [
    '--no-playlist',
    '--no-check-certificates',
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
                sendProgress(id, { 
                  status: 'completed', 
                  fileName: path.basename(downloadedFilePath),
                  fileUrl: `/api/get-file?name=${encodeURIComponent(path.basename(downloadedFilePath))}`
                });
              } catch (err) {
                console.error('Error replacing rotated file (likely locked):', err);
                console.log(`✔ Keeping rotated file due to lock: ${tempPath}`);
                sendProgress(id, { 
                  status: 'completed', 
                  fileName: path.basename(tempPath),
                  fileUrl: `/api/get-file?name=${encodeURIComponent(path.basename(tempPath))}`
                });
              }
            } else {
              console.error(`✘ Direct FFmpeg rotation failed with code: ${ffmpegCode}`);
              sendProgress(id, { status: 'error', message: 'Direct rotation process failed.' });
            }
          });
        } else {
          const fn = downloadedFilePath ? path.basename(downloadedFilePath) : '';
          sendProgress(id, { 
            status: 'completed', 
            fileName: fn,
            fileUrl: fn ? `/api/get-file?name=${encodeURIComponent(fn)}` : '/api/get-file'
          });
        }
      } else {
        const fn = downloadedFilePath ? path.basename(downloadedFilePath) : '';
        sendProgress(id, { 
          status: 'completed', 
          fileName: fn,
          fileUrl: fn ? `/api/get-file?name=${encodeURIComponent(fn)}` : '/api/get-file'
        });
      }
    } else {
      console.error(`✘ Download [${id}] failed with code ${code}`);
      sendProgress(id, { status: 'error', message: `Download failed with exit code ${code}.` });
    }
  });
});

// Route: Upload Media for Watermark removal
app.post('/api/upload-media', (req, res) => {
  const { fileData, fileName, mimeType } = req.body;
  if (!fileData) {
    return res.status(400).json({ error: 'No file data provided.' });
  }

  try {
    const matches = fileData.match(/^data:(.+);base64,(.+)$/);
    const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(fileData, 'base64');
    
    const ext = mimeType ? mimeType.split('/')[1] : 'bin';
    const safeName = `uploaded_${Date.now()}.${ext.replace('jpeg', 'jpg')}`;
    const targetPath = path.join(downloadsDir, safeName);
    
    fs.writeFileSync(targetPath, buffer);
    res.json({ success: true, fileName: safeName, filePath: targetPath });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save uploaded file.' });
  }
});

// Route: Remove Watermark from Video using FFmpeg delogo filter
app.post('/api/remove-watermark-video', async (req, res) => {
  const { videoData, fileName, x, y, w, h } = req.body;

  if (!hasFfmpeg) {
    return res.status(400).json({ 
      error: 'FFmpeg is required for video watermark removal. Please ensure FFmpeg is installed on your system.' 
    });
  }

  if (x === undefined || y === undefined || !w || !h) {
    return res.status(400).json({ error: 'Missing watermark coordinates (x, y, w, h).' });
  }

  let inputPath = '';
  let tempInputCreated = false;

  try {
    if (fileName) {
      inputPath = path.join(downloadsDir, path.basename(fileName));
      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: 'Specified video file not found on server.' });
      }
    } else if (videoData) {
      const matches = videoData.match(/^data:(.+);base64,(.+)$/);
      const buffer = matches ? Buffer.from(matches[2], 'base64') : Buffer.from(videoData, 'base64');
      inputPath = path.join(downloadsDir, `upload_input_${Date.now()}.mp4`);
      fs.writeFileSync(inputPath, buffer);
      tempInputCreated = true;
    } else {
      return res.status(400).json({ error: 'No video file or video data provided.' });
    }

    const outputFileName = `clean_video_${Date.now()}.mp4`;
    const outputPath = path.join(downloadsDir, outputFileName);

    // Sanitize integer coordinates for FFmpeg delogo filter
    const delogoX = Math.max(0, Math.round(Number(x)));
    const delogoY = Math.max(0, Math.round(Number(y)));
    const delogoW = Math.max(2, Math.round(Number(w)));
    const delogoH = Math.max(2, Math.round(Number(h)));

    const ffmpegArgs = [
      '-i', inputPath,
      '-vf', `delogo=x=${delogoX}:y=${delogoY}:w=${delogoW}:h=${delogoH}:show=0`,
      '-c:a', 'copy',
      '-y',
      outputPath
    ];

    console.log(`Executing FFmpeg delogo filter: delogo=x=${delogoX}:y=${delogoY}:w=${delogoW}:h=${delogoH}`);

    const child = spawn('ffmpeg', ffmpegArgs);
    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (tempInputCreated && fs.existsSync(inputPath)) {
        try { fs.unlinkSync(inputPath); } catch (e) {}
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        res.json({
          success: true,
          fileName: outputFileName,
          downloadUrl: `/api/get-file?name=${outputFileName}`
        });
      } else {
        console.error('FFmpeg delogo error:', stderr);
        res.status(500).json({ error: 'FFmpeg watermark removal failed: ' + (stderr.slice(-200) || 'Unknown error') });
      }
    });

  } catch (err) {
    console.error('Video watermark removal error:', err);
    res.status(500).json({ error: 'Failed to process video watermark removal.' });
  }
});

// Route: Get / Instant Save file to browser
app.get('/api/get-file', (req, res) => {
  const fileName = req.query.name;
  if (fileName) {
    const safePath = path.join(downloadsDir, path.basename(fileName));
    if (fs.existsSync(safePath)) {
      return res.download(safePath);
    }
  }

  // Fallback: download most recent file in downloads directory
  if (fs.existsSync(downloadsDir)) {
    const files = fs.readdirSync(downloadsDir).filter(f => !f.startsWith('.'));
    if (files.length > 0) {
      files.sort((a, b) => {
        return fs.statSync(path.join(downloadsDir, b)).mtimeMs - fs.statSync(path.join(downloadsDir, a)).mtimeMs;
      });
      return res.download(path.join(downloadsDir, files[0]));
    }
  }

  res.status(404).send('No file available for download.');
});

// Route: Open Downloads folder in Windows Explorer
app.post('/api/open-downloads', (req, res) => {
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }

  const commands = process.platform === 'win32'
    ? [`powershell -Command "Start-Process '${downloadsDir}'"`, `explorer "${downloadsDir}"`]
    : process.platform === 'darwin'
      ? [`open "${downloadsDir}"`]
      : [`xdg-open "${downloadsDir}"`];

  let idx = 0;
  function tryExec() {
    if (idx >= commands.length) {
      return res.json({ success: true, path: downloadsDir });
    }
    exec(commands[idx], (err) => {
      // PowerShell Start-Process or open returns 0 exit code
      res.json({ success: true, path: downloadsDir });
    });
  }

  tryExec();
});




// Catch-all route to serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

