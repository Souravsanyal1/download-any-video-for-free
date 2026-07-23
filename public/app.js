document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const downloadForm = document.getElementById('download-form');
  const videoUrlInput = document.getElementById('video-url');
  const pasteBtn = document.getElementById('paste-btn');
  const searchBtn = document.getElementById('search-btn');
  
  // Status Indicators
  const statusYtdlp = document.getElementById('status-ytdlp');
  const statusFfmpeg = document.getElementById('status-ffmpeg');
  const ffmpegWarning = document.getElementById('ffmpeg-warning');
  
  // Loading & Error States
  const loadingSpinner = document.getElementById('loading-spinner');
  const errorBox = document.getElementById('error-box');
  const errorMsg = document.getElementById('error-msg');
  
  // Panel containers
  const resultsPanel = document.getElementById('results-panel');
  const progressPanel = document.getElementById('progress-panel');
  const completionPanel = document.getElementById('completion-panel');
  
  // Video Details elements
  const videoThumbnail = document.getElementById('video-thumbnail');
  const videoDuration = document.getElementById('video-duration');
  const videoTitle = document.getElementById('video-title');
  const videoUploader = document.getElementById('video-uploader');
  const videoViews = document.getElementById('video-views');
  const qualityGrid = document.getElementById('quality-grid');
  
  // Progress metrics
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercentTop = document.getElementById('progress-percent-top');
  const metricSpeed = document.getElementById('metric-speed');
  const metricSize = document.getElementById('metric-size');
  const metricEta = document.getElementById('metric-eta');
  const progressStatusTitle = document.getElementById('progress-status-title');
  
  // Folder Actions
  const openFolderBtn = document.getElementById('open-folder-btn');
  const completeOpenFolderBtn = document.getElementById('complete-open-folder-btn');
  const footerFolderTrigger = document.getElementById('footer-folder-trigger');
  
  // History elements
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const downloadAnotherBtn = document.getElementById('download-another-btn');
  const saveFileBrowserBtn = document.getElementById('save-file-browser-btn');

  // Application State
  let currentVideoData = null;
  let activeEventSource = null;
  let lastCompletedFileUrl = '';
  let downloadHistory = JSON.parse(localStorage.getItem('downloader_history') || '[]');


  // Safe fetch wrapper with precision error catching
  async function fetchJSON(url, options = {}) {
    try {
      const response = await fetch(url, options);
      const contentType = response.headers.get('content-type');
      
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        if (response.status >= 500 || text.includes('Error')) {
          throw new Error(`Internal Server Error (${response.status}). Please check the Node.js backend console for the error stack.`);
        }
        throw new Error(`Invalid response type (Status ${response.status}). Make sure you are using http://localhost:3000.`);
      }
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Server returned error status ${response.status}`);
      }
      return data;
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
        throw new Error('Could not connect to the backend server. Make sure start.bat is running and listening on port 3000.');
      }
      throw err;
    }
  }

  // Active Context Warning: Alert user if accessing via wrong protocol/port
  if (window.location.protocol === 'file:' || (window.location.port !== '3000' && window.location.port !== '')) {
    const banner = document.createElement('div');
    banner.className = 'alert-box warning-alert';
    banner.style.marginBottom = '1.5rem';
    banner.style.borderRadius = '14px';
    banner.innerHTML = `
      <div class="alert-icon"><i data-lucide="alert-triangle"></i></div>
      <div class="alert-content">
        <h4>Connection Warning</h4>
        <p>You have opened the page via <strong>${window.location.protocol === 'file:' ? 'local files' : 'port ' + window.location.port}</strong>. The downloader engine runs exclusively on <a href="http://localhost:3000" style="color: var(--color-primary); font-weight: 700; text-decoration: underline;">http://localhost:3000</a>. Please double-click <strong>start.bat</strong> and use the window that opens.</p>
      </div>
    `;
    document.querySelector('.main-content').prepend(banner);
    lucide.createIcons();
  }

  // Fetch System Status
  async function checkSystemStatus() {
    try {
      const data = await fetchJSON('/api/status');
      
      // Update yt-dlp indicator
      if (data.ytdlpReady) {
        statusYtdlp.className = 'status-indicator ready';
        statusYtdlp.querySelector('.text').textContent = 'Engine: Ready';
      } else {
        statusYtdlp.className = 'status-indicator loading';
        statusYtdlp.querySelector('.text').textContent = 'Engine: Deploying...';
        setTimeout(checkSystemStatus, 3000); // Retry checking until ready
      }
      
      // Update FFmpeg indicator
      if (data.hasFfmpeg) {
        statusFfmpeg.className = 'status-indicator ready';
        statusFfmpeg.querySelector('.text').textContent = 'FFmpeg: Connected';
        ffmpegWarning.classList.add('hidden');
      } else {
        statusFfmpeg.className = 'status-indicator warning';
        statusFfmpeg.querySelector('.text').textContent = 'FFmpeg: Missing';
      }
    } catch (error) {
      console.error('Failed to get status:', error);
      statusYtdlp.className = 'status-indicator warning';
      statusYtdlp.querySelector('.text').textContent = 'Engine: Offline';
    }
  }

  // Initial Status Check
  checkSystemStatus();
  renderHistory();

  // Paste URL action
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        videoUrlInput.value = text;
        videoUrlInput.focus();
      }
    } catch (err) {
      console.warn('Could not read clipboard. Double check permissions.', err);
    }
  });

  // Link Analyzer form submission
  downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = videoUrlInput.value.trim();
    if (!url) return;

    // Reset layout states
    hideAllPanels();
    errorBox.classList.add('hidden');
    loadingSpinner.classList.remove('hidden');
    searchBtn.disabled = true;

    try {
      const data = await fetchJSON(`/api/info?url=${encodeURIComponent(url)}`);
      currentVideoData = data;
      renderVideoDetails(data);
    } catch (err) {
      console.error('Info extraction failed:', err);
      errorMsg.textContent = err.message || 'The server could not extract details. Make sure the URL is correct.';
      errorBox.classList.remove('hidden');
    } finally {
      loadingSpinner.classList.add('hidden');
      searchBtn.disabled = false;
    }
  });

  // Render Video Metadata and Formats
  function renderVideoDetails(data) {
    videoThumbnail.src = data.thumbnail;
    videoDuration.textContent = data.duration;
    videoTitle.textContent = data.title;
    videoUploader.textContent = data.uploader;
    videoViews.textContent = data.views;

    // Show system FFmpeg warnings if higher quality is available but FFmpeg is missing
    const statusClass = statusFfmpeg.className;
    if (statusClass.includes('warning') && (data.qualities['8k'] || data.qualities['4k'] || data.qualities['2k'])) {
      ffmpegWarning.classList.remove('hidden');
    } else {
      ffmpegWarning.classList.add('hidden');
    }

    // Dynamic resolution grid setup
    qualityGrid.innerHTML = '';
    
    // Add resolutions in order
    const resolutions = [
      { key: '8k', label: '8K Ultra HD', class: 'q-8k', sub: '4320p' },
      { key: '4k', label: '4K Ultra HD', class: 'q-4k', sub: '2160p' },
      { key: '2k', label: '2K Quad HD', class: 'q-2k', sub: '1440p' },
      { key: '1080p', label: 'Full HD', class: 'q-1080p', sub: '1080p' },
      { key: '720p', label: 'HD Quality', class: 'q-720p', sub: '720p' },
      { key: '480p', label: 'Standard', class: 'q-480p', sub: '480p' },
      { key: '360p', label: 'Low Quality', class: 'q-360p', sub: '360p' },
      { key: 'audio', label: 'Audio Only', class: 'q-audio', sub: 'MP3 320kbps' }
    ];

    resolutions.forEach(res => {
      if (data.qualities[res.key]) {
        const btn = document.createElement('button');
        btn.className = `q-btn ${res.class}`;
        btn.innerHTML = `
          <span class="label">${res.label}</span>
          <span class="sub">${res.sub}</span>
        `;
        btn.addEventListener('click', () => startDownload(data.webpage_url, res.key));
        qualityGrid.appendChild(btn);
      }
    });

    resultsPanel.classList.remove('hidden');
    resultsPanel.scrollIntoView({ behavior: 'smooth' });
  }

  // Trigger Download Processing
  async function startDownload(url, quality) {
    const isVercelHost = window.location.hostname.includes('vercel');
    const directUrl = (currentVideoData && currentVideoData.direct_urls) ? currentVideoData.direct_urls[quality] : null;

    // Direct Browser Download (Works seamlessly on Vercel, phones, and PCs)
    if (directUrl || isVercelHost) {
      const streamTarget = directUrl || `/api/stream?url=${encodeURIComponent(url)}&quality=${quality}`;
      const link = document.createElement('a');
      link.href = streamTarget;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (currentVideoData) {
        saveToHistory({
          title: currentVideoData.title,
          thumbnail: currentVideoData.thumbnail,
          quality: quality,
          uploader: currentVideoData.uploader,
          duration: currentVideoData.duration,
          timestamp: Date.now()
        });
      }

      hideAllPanels();
      completionPanel.classList.remove('hidden');
      completionPanel.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const rotationActive = document.querySelector('input[name="video-rotation"]:checked');
    const rotate = rotationActive ? rotationActive.value : 'none';

    hideAllPanels();
    progressPanel.classList.remove('hidden');
    progressPanel.scrollIntoView({ behavior: 'smooth' });

    // Generate unique ID for tracing download stream
    const downloadId = 'dl_' + Date.now() + Math.random().toString(36).substr(2, 5);

    // Reset Progress indicators
    progressBarFill.style.width = '0%';
    progressPercentTop.textContent = '0%';
    metricSpeed.textContent = 'Connecting...';
    metricSize.textContent = 'Calculating...';
    metricEta.textContent = 'Estimating...';
    if (progressStatusTitle) {
      progressStatusTitle.textContent = 'Downloading Stream...';
    }


    // Start listening to the progress channel (SSE)
    if (activeEventSource) {
      activeEventSource.close();
    }
    
    activeEventSource = new EventSource(`/api/progress?id=${downloadId}`);
    
    activeEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.status === 'downloading') {
        if (progressStatusTitle) {
          progressStatusTitle.textContent = 'Downloading Stream...';
        }
        const pct = Math.floor(data.percent);
        progressBarFill.style.width = `${pct}%`;
        progressPercentTop.textContent = `${pct}%`;
        metricSpeed.textContent = data.speed;
        metricSize.textContent = data.size;
        metricEta.textContent = data.eta;
      } else if (data.status === 'merging') {
        progressBarFill.style.width = `99%`;
        progressPercentTop.textContent = `99%`;
        metricSpeed.textContent = data.speed || 'Processing...';
        metricSize.textContent = data.size || 'Merging media streams';
        metricEta.textContent = data.eta || 'Please wait...';
        
        if (progressStatusTitle) {
          if (data.size && (data.size.includes('Rotat') || data.size.includes('rotat') || data.size.includes('transpos'))) {
            progressStatusTitle.textContent = 'Rotating Video (PC Mode)...';
          } else {
            progressStatusTitle.textContent = 'Merging & Finalizing...';
          }
        }
      } else if (data.status === 'completed') {
        activeEventSource.close();
        activeEventSource = null;
        
        if (data.fileUrl) {
          lastCompletedFileUrl = data.fileUrl;
        }

        // Log to Session History
        saveToHistory({
          title: currentVideoData.title,
          thumbnail: currentVideoData.thumbnail,
          quality: quality,
          uploader: currentVideoData.uploader,
          duration: currentVideoData.duration,
          timestamp: Date.now()
        });

        hideAllPanels();
        completionPanel.classList.remove('hidden');
        completionPanel.scrollIntoView({ behavior: 'smooth' });
      } else if (data.status === 'error') {
        activeEventSource.close();
        activeEventSource = null;
        
        hideAllPanels();
        errorMsg.textContent = data.message || 'Failed to download stream.';
        errorBox.classList.remove('hidden');
      }
    };

    activeEventSource.onerror = (err) => {
      console.error('SSE connection lost:', err);
      activeEventSource.close();
    };

    // Post start command to Express
    try {
      await fetchJSON('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url, quality, id: downloadId, rotate })
      });
    } catch (err) {
      console.error('Failed to trigger post command:', err);
      if (activeEventSource) {
        activeEventSource.close();
      }
      hideAllPanels();
      errorMsg.textContent = err.message || 'Server communications interrupted.';
      errorBox.classList.remove('hidden');
    }
  }

  // Open Downloads Folder via OS Command API
  async function openDownloadsDirectory() {
    try {
      await fetchJSON('/api/open-downloads', { method: 'POST' });
    } catch (e) {
      console.error('Open folder error:', e);
      // Fallback: trigger instant browser download
      window.location.href = lastCompletedFileUrl || '/api/get-file';
    }
  }

  // Folder & File Download Triggers
  openFolderBtn.addEventListener('click', openDownloadsDirectory);
  completeOpenFolderBtn.addEventListener('click', openDownloadsDirectory);
  footerFolderTrigger.addEventListener('click', openDownloadsDirectory);

  if (saveFileBrowserBtn) {
    saveFileBrowserBtn.addEventListener('click', () => {
      window.location.href = lastCompletedFileUrl || '/api/get-file';
    });
  }


  // History cache logging
  function saveToHistory(item) {
    // Keep max 20 session logs
    downloadHistory.unshift(item);
    if (downloadHistory.length > 20) {
      downloadHistory.pop();
    }
    localStorage.setItem('downloader_history', JSON.stringify(downloadHistory));
    renderHistory();
  }

  // Render History lists
  function renderHistory() {
    if (downloadHistory.length === 0) {
      historyList.innerHTML = `
        <div class="empty-history">
          <i data-lucide="cloud-download" class="empty-history-icon"></i>
          <p>No downloads in this session yet. Paste a link to get started!</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    historyList.innerHTML = '';
    downloadHistory.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-item';
      
      const badgeClass = item.quality === 'audio' ? 'badge-mp3' : 'badge-completed';
      const badgeText = item.quality === 'audio' ? 'MP3' : item.quality.toUpperCase();

      card.innerHTML = `
        <div class="hist-left">
          <img src="${item.thumbnail}" alt="Thumbnail" class="hist-thumb">
          <div class="hist-details">
            <h4 class="hist-title" title="${item.title}">${item.title}</h4>
            <div class="hist-meta">
              <span>${item.uploader}</span> &bull; <span>${item.duration}</span>
              <span class="hist-badge ${badgeClass}">${badgeText}</span>
            </div>
          </div>
        </div>
        <div class="hist-right">
          <button class="icon-action-btn open-file-trigger" title="Access file directory">
            <i data-lucide="external-link"></i>
          </button>
        </div>
      `;
      
      card.querySelector('.open-file-trigger').addEventListener('click', openDownloadsDirectory);
      historyList.appendChild(card);
    });

    lucide.createIcons();
  }

  // Clear Session Logs
  clearHistoryBtn.addEventListener('click', () => {
    downloadHistory = [];
    localStorage.removeItem('downloader_history');
    renderHistory();
  });

  // Download Another Trigger
  downloadAnotherBtn.addEventListener('click', () => {
    videoUrlInput.value = '';
    hideAllPanels();
    videoUrlInput.focus();
  });

  // Helpers
  function hideAllPanels() {
    resultsPanel.classList.add('hidden');
    progressPanel.classList.add('hidden');
    completionPanel.classList.add('hidden');
  }

  /* ======================================================
     TAB NAVIGATION SYSTEM
     ====================================================== */
  const navTabBtns = document.querySelectorAll('.nav-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  navTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      navTabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
      });

      btn.classList.add('active');
      const activePane = document.getElementById(targetTab);
      if (activePane) {
        activePane.classList.remove('hidden');
        activePane.classList.add('active');
      }
    });
  });


  /* ======================================================
     1. IMAGE WATERMARK REMOVER (Canvas Inpainting Engine)
     ====================================================== */
  const imgDropzone = document.getElementById('img-dropzone');
  const imgFileInput = document.getElementById('img-file-input');
  const imgWorkspace = document.getElementById('img-workspace');
  const imgCanvas = document.getElementById('img-canvas');
  const toolBoxMode = document.getElementById('tool-box-mode');
  const toolBrushMode = document.getElementById('tool-brush-mode');
  const brushSizeContainer = document.getElementById('brush-size-container');
  const brushSizeInput = document.getElementById('brush-size');
  const brushSizeVal = document.getElementById('brush-size-val');
  const btnClearImgMask = document.getElementById('btn-clear-img-mask');
  const btnResetImg = document.getElementById('btn-reset-img');
  const btnEraseImgWm = document.getElementById('btn-erase-img-wm');
  const imgResultSection = document.getElementById('img-result-section');
  const imgResultPreview = document.getElementById('img-result-preview');
  const btnDownloadCleanImg = document.getElementById('btn-download-clean-img');
  const btnEditAgainImg = document.getElementById('btn-edit-again-img');

  let currentImage = null;
  let imgCtx = null;
  let maskCanvas = document.createElement('canvas');
  let maskCtx = null;
  let activeTool = 'box'; // 'box' or 'brush'
  let isDrawingMask = false;
  let startX = 0, startY = 0;
  let currentBox = null;

  // Dropzone events
  imgDropzone.addEventListener('click', () => imgFileInput.click());
  imgDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    imgDropzone.classList.add('dragover');
  });
  imgDropzone.addEventListener('dragleave', () => imgDropzone.classList.remove('dragover'));
  imgDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    imgDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadImageFile(e.dataTransfer.files[0]);
    }
  });
  imgFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadImageFile(e.target.files[0]);
    }
  });

  function loadImageFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file (PNG, JPG, WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        initImageCanvas();
        imgDropzone.classList.add('hidden');
        imgWorkspace.classList.remove('hidden');
        imgResultSection.classList.add('hidden');
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  function initImageCanvas() {
    if (!currentImage) return;
    imgCanvas.width = currentImage.naturalWidth;
    imgCanvas.height = currentImage.naturalHeight;
    imgCtx = imgCanvas.getContext('2d');

    maskCanvas.width = currentImage.naturalWidth;
    maskCanvas.height = currentImage.naturalHeight;
    maskCtx = maskCanvas.getContext('2d');
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

    currentBox = null;
    redrawImageStage();
  }

  function redrawImageStage() {
    if (!imgCtx || !currentImage) return;
    imgCtx.drawImage(currentImage, 0, 0);

    // Draw mask overlay
    imgCtx.save();
    imgCtx.globalAlpha = 0.45;
    imgCtx.drawImage(maskCanvas, 0, 0);
    imgCtx.restore();

    // Draw current selection box if active
    if (currentBox) {
      imgCtx.strokeStyle = '#00f2fe';
      imgCtx.lineWidth = Math.max(2, Math.round(imgCanvas.width / 400));
      imgCtx.fillStyle = 'rgba(0, 242, 254, 0.25)';
      imgCtx.fillRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
      imgCtx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
    }
  }

  // Tool Modes
  toolBoxMode.addEventListener('click', () => {
    activeTool = 'box';
    toolBoxMode.classList.add('active');
    toolBrushMode.classList.remove('active');
    brushSizeContainer.classList.add('hidden');
  });

  toolBrushMode.addEventListener('click', () => {
    activeTool = 'brush';
    toolBrushMode.classList.add('active');
    toolBoxMode.classList.remove('active');
    brushSizeContainer.classList.remove('hidden');
  });

  brushSizeInput.addEventListener('input', (e) => {
    brushSizeVal.textContent = e.target.value + 'px';
  });

  btnClearImgMask.addEventListener('click', () => {
    if (maskCtx) {
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      currentBox = null;
      redrawImageStage();
    }
  });

  btnResetImg.addEventListener('click', () => {
    imgFileInput.value = '';
    currentImage = null;
    imgWorkspace.classList.add('hidden');
    imgResultSection.classList.add('hidden');
    imgDropzone.classList.remove('hidden');
  });

  // Canvas Mouse Interactions
  function getCanvasCoords(e) {
    const rect = imgCanvas.getBoundingClientRect();
    const scaleX = imgCanvas.width / rect.width;
    const scaleY = imgCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  imgCanvas.addEventListener('mousedown', (e) => {
    isDrawingMask = true;
    const coords = getCanvasCoords(e);
    startX = coords.x;
    startY = coords.y;

    if (activeTool === 'brush') {
      maskCtx.fillStyle = '#ff0055';
      maskCtx.beginPath();
      maskCtx.arc(startX, startY, parseInt(brushSizeInput.value) / 2, 0, Math.PI * 2);
      maskCtx.fill();
      redrawImageStage();
    }
  });

  imgCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawingMask) return;
    const coords = getCanvasCoords(e);

    if (activeTool === 'box') {
      const w = coords.x - startX;
      const h = coords.y - startY;
      currentBox = {
        x: w < 0 ? coords.x : startX,
        y: h < 0 ? coords.y : startY,
        w: Math.abs(w),
        h: Math.abs(h)
      };
      redrawImageStage();
    } else if (activeTool === 'brush') {
      maskCtx.fillStyle = '#ff0055';
      maskCtx.beginPath();
      maskCtx.arc(coords.x, coords.y, parseInt(brushSizeInput.value) / 2, 0, Math.PI * 2);
      maskCtx.fill();
      redrawImageStage();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDrawingMask) {
      isDrawingMask = false;
      if (activeTool === 'box' && currentBox) {
        maskCtx.fillStyle = '#ff0055';
        maskCtx.fillRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
        currentBox = null;
        redrawImageStage();
      }
    }
  });

  // Presets & Algorithm Controls
  const presetGeminiBr = document.getElementById('preset-gemini-br');
  const presetBottomLeft = document.getElementById('preset-bottom-left');
  const batchQueueContainer = document.getElementById('batch-queue-container');
  const batchQueueList = document.getElementById('batch-queue-list');
  const batchCount = document.getElementById('batch-count');
  const btnProcessBatchAll = document.getElementById('btn-process-batch-all');

  let batchImages = [];

  // Preset Handlers
  if (presetGeminiBr) {
    presetGeminiBr.addEventListener('click', () => {
      if (!maskCtx || !imgCanvas) return;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      const size = Math.max(64, Math.round(imgCanvas.width * 0.12));
      const x = Math.max(0, imgCanvas.width - size - 10);
      const y = Math.max(0, imgCanvas.height - size - 10);
      maskCtx.fillStyle = '#ff0055';
      maskCtx.fillRect(x, y, size, size);
      redrawImageStage();
    });
  }

  if (presetBottomLeft) {
    presetBottomLeft.addEventListener('click', () => {
      if (!maskCtx || !imgCanvas) return;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      const size = Math.max(64, Math.round(imgCanvas.width * 0.12));
      const x = 10;
      const y = Math.max(0, imgCanvas.height - size - 10);
      maskCtx.fillStyle = '#ff0055';
      maskCtx.fillRect(x, y, size, size);
      redrawImageStage();
    });
  }

  // Multi-File Upload & Batch Queue
  imgFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 1) {
      handleBatchUpload(Array.from(e.target.files));
    }
  });

  function handleBatchUpload(files) {
    batchImages = files.filter(f => f.type.startsWith('image/'));
    if (batchImages.length === 0) return;

    batchCount.textContent = batchImages.length;
    batchQueueList.innerHTML = '';

    batchImages.forEach((file, index) => {
      const card = document.createElement('div');
      card.className = 'batch-item-card';
      const url = URL.createObjectURL(file);
      card.innerHTML = `
        <img src="${url}" class="batch-thumb" alt="Thumbnail">
        <span class="batch-item-name">${file.name}</span>
        <span id="batch-status-${index}" class="batch-status-badge pending">Pending</span>
        <a id="batch-dl-${index}" class="primary-btn sm hidden" download="clean_${file.name}"><i data-lucide="download"></i> Download</a>
      `;
      batchQueueList.appendChild(card);
    });

    batchQueueContainer.classList.remove('hidden');
    lucide.createIcons();
  }

  // Reverse Alpha Blending & Inpainting Processing
  function processWatermarkRemoval(sourceCanvas, sourceMaskCanvas, mode = 'alpha') {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;

    const sCtx = sourceCanvas.getContext('2d');
    const mCtx = sourceMaskCanvas.getContext('2d');

    const imgData = sCtx.getImageData(0, 0, w, h);
    const maskData = mCtx.getImageData(0, 0, w, h);

    const pixels = imgData.data;
    const mask = maskData.data;

    // Multi-pass boundary-propagating inpainting algorithm
    const passes = mode === 'alpha' ? 10 : 15;
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;

          if (mask[idx + 3] > 0) {
            let rAcc = 0, gAcc = 0, bAcc = 0, weightAcc = 0;

            const radius = 3;
            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  const nIdx = (ny * w + nx) * 4;
                  if (mask[nIdx + 3] === 0 || pass > 0) {
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const weight = 1 / (dist * dist);
                    rAcc += pixels[nIdx] * weight;
                    gAcc += pixels[nIdx + 1] * weight;
                    bAcc += pixels[nIdx + 2] * weight;
                    weightAcc += weight;
                  }
                }
              }
            }

            if (weightAcc > 0) {
              pixels[idx] = Math.round(rAcc / weightAcc);
              pixels[idx + 1] = Math.round(gAcc / weightAcc);
              pixels[idx + 2] = Math.round(bAcc / weightAcc);
            }
          }
        }
      }
    }

    const resCanvas = document.createElement('canvas');
    resCanvas.width = w;
    resCanvas.height = h;
    const rCtx = resCanvas.getContext('2d');
    rCtx.putImageData(imgData, 0, 0);
    return resCanvas;
  }

  // Trigger Single Image Processing
  btnEraseImgWm.addEventListener('click', () => {
    if (!currentImage || !imgCtx) return;

    // Check if mask has any non-zero pixels
    const mData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    let hasMask = false;
    for (let i = 3; i < mData.length; i += 4) {
      if (mData[i] > 0) {
        hasMask = true;
        break;
      }
    }

    // Auto-apply Gemini Bottom-Right preset if no mask drawn yet
    if (!hasMask && presetGeminiBr) {
      presetGeminiBr.click();
    }

    const selectedAlgo = document.querySelector('input[name="wm-algo"]:checked') ? document.querySelector('input[name="wm-algo"]:checked').value : 'alpha';
    const cleanCanvas = processWatermarkRemoval(imgCanvas, maskCanvas, selectedAlgo);

    const resultUrl = cleanCanvas.toDataURL('image/png');
    imgResultPreview.src = resultUrl;
    btnDownloadCleanImg.href = resultUrl;
    btnDownloadCleanImg.download = `clean_image_${Date.now()}.png`;

    imgResultSection.classList.remove('hidden');
    imgResultSection.scrollIntoView({ behavior: 'smooth' });
  });

  // Batch All Process Trigger
  if (btnProcessBatchAll) {
    btnProcessBatchAll.addEventListener('click', async () => {
      if (batchImages.length === 0) return;

      const selectedAlgo = document.querySelector('input[name="wm-algo"]:checked') ? document.querySelector('input[name="wm-algo"]:checked').value : 'alpha';

      for (let i = 0; i < batchImages.length; i++) {
        const file = batchImages[i];
        const badge = document.getElementById(`batch-status-${i}`);
        const dlBtn = document.getElementById(`batch-dl-${i}`);

        if (badge) badge.textContent = 'Processing...';

        await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = img.naturalWidth;
              c.height = img.naturalHeight;
              const ctx = c.getContext('2d');
              ctx.drawImage(img, 0, 0);

              const mc = document.createElement('canvas');
              mc.width = img.naturalWidth;
              mc.height = img.naturalHeight;
              const mCtx = mc.getContext('2d');

              // Apply bottom-right preset mask
              const size = Math.max(64, Math.round(img.naturalWidth * 0.12));
              const x = Math.max(0, img.naturalWidth - size - 10);
              const y = Math.max(0, img.naturalHeight - size - 10);
              mCtx.fillStyle = '#ff0055';
              mCtx.fillRect(x, y, size, size);

              const cleanC = processWatermarkRemoval(c, mc, selectedAlgo);
              const cleanUrl = cleanC.toDataURL('image/png');

              if (badge) {
                badge.textContent = 'Completed';
                badge.className = 'batch-status-badge done';
              }
              if (dlBtn) {
                dlBtn.href = cleanUrl;
                dlBtn.classList.remove('hidden');
              }
              resolve();
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        });
      }
    });
  }
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imgData, 0, 0);

    const resultUrl = tempCanvas.toDataURL('image/png');
    imgResultPreview.src = resultUrl;
    btnDownloadCleanImg.href = resultUrl;
    btnDownloadCleanImg.download = `clean_image_${Date.now()}.png`;

    imgResultSection.classList.remove('hidden');
    imgResultSection.scrollIntoView({ behavior: 'smooth' });
  });

  btnEditAgainImg.addEventListener('click', () => {
    imgResultSection.classList.add('hidden');
    redrawImageStage();
  });


  /* ======================================================
     2. VIDEO WATERMARK REMOVER (FFmpeg Engine)
     ====================================================== */
  const vidDropzone = document.getElementById('vid-dropzone');
  const vidFileInput = document.getElementById('vid-file-input');
  const vidWorkspace = document.getElementById('vid-workspace');
  const wmVideoElement = document.getElementById('wm-video-element');
  const wmVideoBox = document.getElementById('wm-video-box');
  const btnResetVid = document.getElementById('btn-reset-vid');
  const btnEraseVidWm = document.getElementById('btn-erase-vid-wm');
  const vidProcessingLoader = document.getElementById('vid-processing-loader');
  const vidResultSection = document.getElementById('vid-result-section');
  const vidResultPreview = document.getElementById('vid-result-preview');
  const btnDownloadCleanVid = document.getElementById('btn-download-clean-vid');
  const btnEditAgainVid = document.getElementById('btn-edit-again-vid');

  const roiXEl = document.getElementById('roi-x');
  const roiYEl = document.getElementById('roi-y');
  const roiWEl = document.getElementById('roi-w');
  const roiHEl = document.getElementById('roi-h');

  let currentVideoFile = null;
  let currentVideoBase64 = '';

  vidDropzone.addEventListener('click', () => vidFileInput.click());
  vidDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    vidDropzone.classList.add('dragover');
  });
  vidDropzone.addEventListener('dragleave', () => vidDropzone.classList.remove('dragover'));
  vidDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    vidDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadVideoFile(e.dataTransfer.files[0]);
    }
  });

  vidFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadVideoFile(e.target.files[0]);
    }
  });

  function loadVideoFile(file) {
    if (!file.type.startsWith('video/')) {
      alert('Please select a valid video file.');
      return;
    }
    currentVideoFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      currentVideoBase64 = e.target.result;
      wmVideoElement.src = e.target.result;
      vidDropzone.classList.add('hidden');
      vidWorkspace.classList.remove('hidden');
      vidResultSection.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  btnResetVid.addEventListener('click', () => {
    vidFileInput.value = '';
    currentVideoFile = null;
    currentVideoBase64 = '';
    wmVideoElement.src = '';
    vidWorkspace.classList.add('hidden');
    vidResultSection.classList.add('hidden');
    vidDropzone.classList.remove('hidden');
  });

  // Draggable & Resizable Bounding Box for Video ROI
  let isDraggingBox = false;
  let isResizingBox = false;
  let activeHandle = null;
  let boxStartX = 0, boxStartY = 0;
  let initialLeft = 20, initialTop = 20, initialW = 120, initialH = 60;

  wmVideoBox.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('handle')) {
      isResizingBox = true;
      activeHandle = e.target;
    } else {
      isDraggingBox = true;
    }
    boxStartX = e.clientX;
    boxStartY = e.clientY;

    const style = window.getComputedStyle(wmVideoBox);
    initialLeft = parseInt(style.left, 10) || 20;
    initialTop = parseInt(style.top, 10) || 20;
    initialW = parseInt(style.width, 10) || 120;
    initialH = parseInt(style.height, 10) || 60;

    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingBox && !isResizingBox) return;

    const dx = e.clientX - boxStartX;
    const dy = e.clientY - boxStartY;
    const container = document.querySelector('.video-stage-wrapper');
    const cRect = container.getBoundingClientRect();

    if (isDraggingBox) {
      let newLeft = Math.max(0, Math.min(cRect.width - initialW, initialLeft + dx));
      let newTop = Math.max(0, Math.min(cRect.height - initialH, initialTop + dy));
      wmVideoBox.style.left = newLeft + 'px';
      wmVideoBox.style.top = newTop + 'px';
    } else if (isResizingBox && activeHandle) {
      if (activeHandle.classList.contains('handle-se')) {
        let newW = Math.max(30, Math.min(cRect.width - initialLeft, initialW + dx));
        let newH = Math.max(20, Math.min(cRect.height - initialTop, initialH + dy));
        wmVideoBox.style.width = newW + 'px';
        wmVideoBox.style.height = newH + 'px';
      } else if (activeHandle.classList.contains('handle-sw')) {
        let newW = Math.max(30, initialW - dx);
        let newLeft = Math.max(0, initialLeft + (initialW - newW));
        let newH = Math.max(20, Math.min(cRect.height - initialTop, initialH + dy));
        wmVideoBox.style.left = newLeft + 'px';
        wmVideoBox.style.width = newW + 'px';
        wmVideoBox.style.height = newH + 'px';
      } else if (activeHandle.classList.contains('handle-ne')) {
        let newW = Math.max(30, Math.min(cRect.width - initialLeft, initialW + dx));
        let newH = Math.max(20, initialH - dy);
        let newTop = Math.max(0, initialTop + (initialH - newH));
        wmVideoBox.style.top = newTop + 'px';
        wmVideoBox.style.width = newW + 'px';
        wmVideoBox.style.height = newH + 'px';
      } else if (activeHandle.classList.contains('handle-nw')) {
        let newW = Math.max(30, initialW - dx);
        let newLeft = Math.max(0, initialLeft + (initialW - newW));
        let newH = Math.max(20, initialH - dy);
        let newTop = Math.max(0, initialTop + (initialH - newH));
        wmVideoBox.style.left = newLeft + 'px';
        wmVideoBox.style.top = newTop + 'px';
        wmVideoBox.style.width = newW + 'px';
        wmVideoBox.style.height = newH + 'px';
      }
    }
    updateRoiCoordinates();
  });

  window.addEventListener('mouseup', () => {
    isDraggingBox = false;
    isResizingBox = false;
    activeHandle = null;
  });

  function updateRoiCoordinates() {
    if (!wmVideoElement.videoWidth || !wmVideoElement.videoHeight) return { x: 0, y: 0, w: 100, h: 100 };

    const vRect = wmVideoElement.getBoundingClientRect();
    const style = window.getComputedStyle(wmVideoBox);

    const boxL = parseInt(style.left, 10) || 0;
    const boxT = parseInt(style.top, 10) || 0;
    const boxW = parseInt(style.width, 10) || 100;
    const boxH = parseInt(style.height, 10) || 100;

    const scaleX = wmVideoElement.videoWidth / vRect.width;
    const scaleY = wmVideoElement.videoHeight / vRect.height;

    const realX = Math.max(0, Math.round(boxL * scaleX));
    const realY = Math.max(0, Math.round(boxT * scaleY));
    const realW = Math.max(1, Math.round(boxW * scaleX));
    const realH = Math.max(1, Math.round(boxH * scaleY));

    roiXEl.textContent = realX;
    roiYEl.textContent = realY;
    roiWEl.textContent = realW;
    roiHEl.textContent = realH;

    return { x: realX, y: realY, w: realW, h: realH };
  }

  wmVideoElement.addEventListener('loadedmetadata', updateRoiCoordinates);

  // Trigger Video Watermark Removal via Backend FFmpeg
  btnEraseVidWm.addEventListener('click', async () => {
    if (!currentVideoBase64) {
      alert('Please upload a video file first.');
      return;
    }

    const roi = updateRoiCoordinates();

    vidWorkspace.classList.add('hidden');
    vidProcessingLoader.classList.remove('hidden');

    try {
      const response = await fetch('/api/remove-watermark-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoData: currentVideoBase64,
          x: roi.x,
          y: roi.y,
          w: roi.w,
          h: roi.h
        })
      });

      const data = await response.json();
      vidProcessingLoader.classList.add('hidden');

      if (!response.ok || !data.success) {
        alert('Error: ' + (data.error || 'Video watermark removal failed.'));
        vidWorkspace.classList.remove('hidden');
        return;
      }

      vidResultPreview.src = data.downloadUrl;
      btnDownloadCleanVid.href = data.downloadUrl;
      btnDownloadCleanVid.download = data.fileName;

      vidResultSection.classList.remove('hidden');
      vidResultSection.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      vidProcessingLoader.classList.add('hidden');
      vidWorkspace.classList.remove('hidden');
      alert('Request error: ' + err.message);
    }
  });

  btnEditAgainVid.addEventListener('click', () => {
    vidResultSection.classList.add('hidden');
    vidWorkspace.classList.remove('hidden');
  });
});

