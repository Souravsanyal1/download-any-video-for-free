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
});
