import { formatTime } from './utils.js';
import { loadCoverPalette, pictureToImageUrl, readEmbeddedPicture } from './media.js';
import { parseLyrics, readEmbeddedLyrics } from './lyrics.js';
import { resetParticles } from './particles.js';
import { resetBeatDetector } from './beatdetector.js';
import { getFFTSize, resetRenderer } from './renderer.js';
import { Playlist } from './playlist.js';

const state = {
    audioContext: null,
    analyser: null,
    audioElement: null,
    frequencyData: null,
    isPlaying: false,
    isDraggingProgress: false,
    parsedLyrics: null,
    currentLyricsIndex: -1,
    coverPalette: null,
    coverUrl: null,
    audioBlobUrl: null,
    playlist: new Playlist(),
    onHomePage: true
};

const els = {};

let lyricsLineElements = [];
let currentActiveLyricsEl = null;

const coverCache = new Map(); // path → blob URL string (null = no cover)

const MIME_TYPES = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
    wma: 'audio/x-ms-wma', webm: 'audio/webm', opus: 'audio/opus'
};

async function readFileAsAudioFile(path, name) {
    const buffer = await window.electronAPI.readFile(path);
    const ext = name.split('.').pop().toLowerCase();
    const blob = new Blob([buffer], { type: MIME_TYPES[ext] || 'audio/mpeg' });
    return new File([blob], name, { type: blob.type });
}

async function getItemCoverUrl(item) {
    if (!item.path) return null;
    const cached = coverCache.get(item.path);
    if (cached !== undefined) return cached;
    try {
        const file = await readFileAsAudioFile(item.path, item.name);
        const picture = await readEmbeddedPicture(file);
        const url = pictureToImageUrl(picture);
        coverCache.set(item.path, url || null);
        return url || null;
    } catch (_) {
        coverCache.set(item.path, null);
        return null;
    }
}

function loadItemCover(imgEl, item) {
    getItemCoverUrl(item).then(url => {
        if (url && imgEl.isConnected) {
            imgEl.src = url;
            imgEl.classList.add('loaded');
        }
    }).catch(() => {});
}

export function getState() {
    return state;
}

export function getEls() {
    return els;
}

export function init() {
    els.canvas = document.getElementById('canvas');
    els.ctx = els.canvas.getContext('2d');
    els.homePage = document.getElementById('home-page');
    els.homeList = document.getElementById('home-list');
    els.homeListCount = document.getElementById('home-list-count');
    els.fileInput = document.getElementById('file-input');
    els.playBtn = document.getElementById('play-btn');
    els.trackName = document.getElementById('track-name');
    els.volumeSlider = document.getElementById('volume-slider');
    els.controls = document.getElementById('controls');
    els.errorToast = document.getElementById('error-toast');
    els.progressContainer = document.getElementById('progress-container');
    els.progressFill = document.getElementById('progress-fill');
    els.progressThumb = document.getElementById('progress-thumb');
    els.progressTimeTip = document.getElementById('progress-time-tip');
    els.lyricsPanel = document.getElementById('lyrics-panel');
    els.lyricsContent = document.getElementById('lyrics-content');
    els.coverArt = document.getElementById('cover-art');
    els.coverImg = document.getElementById('cover-img');
    els.folderBtn = document.getElementById('folder-btn');
    els.playlistPanel = document.getElementById('playlist-panel');
    els.playlistContent = document.getElementById('playlist-content');
    els.playlistCount = document.getElementById('playlist-count');
    els.playlistClose = document.getElementById('playlist-close');
    els.prevBtn = document.getElementById('prev-btn');
    els.nextBtn = document.getElementById('next-btn');
    els.playlistBtn = document.getElementById('playlist-btn');

    els.fileInput.addEventListener('change', handleFileInput);
    els.playBtn.addEventListener('click', handlePlayPause);
    els.volumeSlider.addEventListener('input', handleVolume);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    els.progressContainer.addEventListener('mousedown', handleProgressMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    els.progressContainer.addEventListener('mousemove', handleProgressHover);
    els.progressContainer.addEventListener('mouseleave', handleProgressMouseLeave);
    
    els.folderBtn.addEventListener('click', handleFolderSelect);
    els.playlistClose.addEventListener('click', () => togglePlaylistPanel(false));
    els.prevBtn.addEventListener('click', handlePrevious);
    els.nextBtn.addEventListener('click', handleNext);
    els.playlistBtn.addEventListener('click', () => togglePlaylistPanel());

    restoreVolume();
    restoreLastFolder();
}

function setPlayIcon(playing) {
    const playIcon = els.playBtn.querySelector('.icon-play');
    const pauseIcon = els.playBtn.querySelector('.icon-pause');
    if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
}

export function showError(msg) {
    els.errorToast.textContent = msg;
    els.errorToast.classList.add('show');
    clearTimeout(els.errorToast._t);
    els.errorToast._t = setTimeout(() => els.errorToast.classList.remove('show'), 3000);
}

export function updateProgressBar() {
    if (!state.audioElement || !state.audioElement.duration) return;
    const pct = state.audioElement.currentTime / state.audioElement.duration;
    const pos = pct * 100;
    els.progressFill.style.width = `${pos}%`;
    els.progressFill.style.height = '';
    els.progressThumb.style.left = `${pos}%`;
    els.progressThumb.style.bottom = '';
}

function getProgressFromEvent(e) {
    const rect = els.progressContainer.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(rect.width, x));
    return x / rect.width;
}

function seekFromEvent(e) {
    if (!state.audioElement || !state.audioElement.duration) return;
    const pct = getProgressFromEvent(e);
    state.audioElement.currentTime = pct * state.audioElement.duration;
    updateProgressBar();
}

function handleProgressMouseDown(e) {
    state.isDraggingProgress = true;
    seekFromEvent(e);
}

function handleMouseMove(e) {
    if (!state.isDraggingProgress) return;
    seekFromEvent(e);
    const pct = getProgressFromEvent(e);
    const t = pct * (state.audioElement ? state.audioElement.duration : 0);
    els.progressTimeTip.textContent = formatTime(t);
}

function handleMouseUp() {
    state.isDraggingProgress = false;
}

function handleProgressHover(e) {
    if (!state.audioElement || !state.audioElement.duration) return;
    const pct = getProgressFromEvent(e);
    const t = pct * state.audioElement.duration;
    els.progressTimeTip.textContent = formatTime(t);
    els.progressTimeTip.style.left = `${pct * 100}%`;
    els.progressTimeTip.style.top = '';
}

function handleProgressMouseLeave() {
    els.progressTimeTip.textContent = '';
}

async function loadCoverArt(file, filePath) {
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = null;
    els.coverImg.removeAttribute('src');
    els.coverArt.classList.remove('has-cover');

    if (filePath) {
        const cached = coverCache.get(filePath);
        if (cached !== undefined) {
            if (cached) {
                state.coverUrl = cached;
                els.coverImg.src = state.coverUrl;
                els.coverArt.classList.add('has-cover');
            }
            return;
        }
    }

    const picture = await readEmbeddedPicture(file);
    state.coverUrl = pictureToImageUrl(picture);
    if (filePath) coverCache.set(filePath, state.coverUrl || null);
    if (!state.coverUrl) return;
    els.coverImg.src = state.coverUrl;
    els.coverArt.classList.add('has-cover');
}

function renderLyrics() {
    els.lyricsContent.innerHTML = '';
    lyricsLineElements = [];
    currentActiveLyricsEl = null;
    if (!state.parsedLyrics) {
        const div = document.createElement('div');
        div.className = 'lyrics-empty';
        div.textContent = '当前音乐无内嵌歌词';
        els.lyricsContent.appendChild(div);
        els.lyricsPanel.classList.add('visible');
        return;
    }
    els.lyricsPanel.classList.add('visible');
    for (let i = 0; i < state.parsedLyrics.lines.length; i++) {
        const div = document.createElement('div');
        div.className = 'lyrics-line';
        if (!state.parsedLyrics.isLRC && i === 0) {
            div.classList.add('active');
            currentActiveLyricsEl = div;
        }
        div.textContent = state.parsedLyrics.lines[i].text;
        div.dataset.index = i;
        els.lyricsContent.appendChild(div);
        lyricsLineElements.push(div);
    }
}

function updateLyricsHighlight(currentTime) {
    if (!state.parsedLyrics || !state.parsedLyrics.isLRC) return;
    let idx = -1;
    for (let i = state.parsedLyrics.lines.length - 1; i >= 0; i--) {
        if (state.parsedLyrics.lines[i].time <= currentTime) { idx = i; break; }
    }
    if (idx === state.currentLyricsIndex) return;
    state.currentLyricsIndex = idx;

    if (currentActiveLyricsEl) currentActiveLyricsEl.classList.remove('active');
    currentActiveLyricsEl = null;

    if (idx >= 0 && idx < lyricsLineElements.length) {
        currentActiveLyricsEl = lyricsLineElements[idx];
        currentActiveLyricsEl.classList.add('active');
    }
}

function applyLyrics(raw) {
    if (typeof raw === 'object' && raw && raw.lyrics) raw = raw.lyrics;
    if (typeof raw !== 'string') return false;
    state.parsedLyrics = parseLyrics(raw);
    if (!state.parsedLyrics) return false;
    renderLyrics();
    state.audioElement.addEventListener('timeupdate', () => {
        updateLyricsHighlight(state.audioElement.currentTime);
    });
    return true;
}

async function loadEmbeddedLyrics(file) {
    const rawLyrics = await readEmbeddedLyrics(file);
    if (applyLyrics(rawLyrics)) return;
    renderLyrics();
}

export async function cleanupAudio() {
    if (state.audioElement) {
        state.audioElement.pause();
        state.audioElement.src = '';
        state.audioElement.load();
    }
    if (state.audioContext && state.audioContext.state !== 'closed') {
        state.audioContext.close().catch(() => {});
    }
    state.audioContext = null;
    state.analyser = null;
    state.audioElement = null;
    state.frequencyData = null;
    state.isPlaying = false;
    state.parsedLyrics = null;
    state.currentLyricsIndex = -1;
    state.coverPalette = null;
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = null;
    if (state.audioBlobUrl) URL.revokeObjectURL(state.audioBlobUrl);
    state.audioBlobUrl = null;
    els.coverImg.removeAttribute('src');
    els.coverArt.classList.remove('has-cover');
    els.lyricsContent.innerHTML = '';
    els.lyricsPanel.classList.remove('visible');
    lyricsLineElements = [];
    currentActiveLyricsEl = null;
    els.progressFill.style.height = '0%';
    els.progressFill.style.width = '0%';
    els.progressThumb.style.bottom = '0%';
    els.progressThumb.style.left = '0%';
    setPlayIcon(false);
    els.trackName.textContent = '\u2014';
    resetParticles();
    resetBeatDetector();
    resetRenderer();
}

async function loadFile(file, filePath) {
    await cleanupAudio();
    await new Promise(r => setTimeout(r, 50));

    try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = getFFTSize();
        state.analyser.smoothingTimeConstant = 0.72;
        state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);

        const url = URL.createObjectURL(file);
        state.audioBlobUrl = url;
        state.audioElement = new Audio(url);
        state.audioElement.volume = els.volumeSlider.value / 100;

        const trackSource = state.audioContext.createMediaElementSource(state.audioElement);
        trackSource.connect(state.analyser);
        state.analyser.connect(state.audioContext.destination);

        state.audioElement.addEventListener('ended', () => {
            state.isPlaying = false;
            setPlayIcon(false);
            renderHomeList();
        });

        els.trackName.textContent = file.name.replace(/\.[^.]+$/, '');

        loadEmbeddedLyrics(file).catch(() => renderLyrics());
        loadCoverArt(file, filePath).catch(() => {});
        loadCoverPalette(file).then((palette) => {
            if (palette) state.coverPalette = palette;
        });

        await state.audioElement.play();
        state.isPlaying = true;
        setPlayIcon(true);

        els.homePage.classList.add('hidden');
        els.controls.classList.add('visible');
        state.onHomePage = false;
    } catch (err) {
        console.error(err);
        showError('无法播放该文件，请检查文件格式');
        cleanupAudio();
    }
}

function handleFileInput() {
    const file = els.fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|wma|webm|opus)$/i)) {
        showError('请选择音频文件');
        els.fileInput.value = '';
        return;
    }
    loadFile(file);
}

function handlePlayPause() {
    if (!state.audioElement) return;
    if (state.isPlaying) {
        state.audioElement.pause();
        setPlayIcon(false);
        state.isPlaying = false;
    } else {
        if (state.audioContext.state === 'suspended') state.audioContext.resume();
        state.audioElement.play().catch(() => {});
        setPlayIcon(true);
        state.isPlaying = true;
    }
}

function handleVolume() {
    if (state.audioElement) state.audioElement.volume = els.volumeSlider.value / 100;
    if (window.electronAPI) {
        window.electronAPI.saveVolume(parseInt(els.volumeSlider.value)).catch(() => {});
    }
}

function handleKeyDown(e) {
    if (e.code === 'Space' && state.audioElement) {
        e.preventDefault();
        els.playBtn.click();
    }
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    els.fileInput.files = e.dataTransfer.files;
    els.fileInput.dispatchEvent(new Event('change'));
}

async function handleFolderSelect() {
    if (!window.electronAPI) {
      showError('请在Electron应用中使用此功能');
      return;
    }

    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (!folderPath) return;

      await loadFolder(folderPath);
    } catch (error) {
      console.error('选择文件夹失败:', error);
      showError('无法加载文件夹，请检查权限');
    }
  }

  async function loadFolder(folderPath) {
    try {
      const files = await state.playlist.loadFromFolder(folderPath);
      if (files.length === 0) {
        showError('所选文件夹中没有找到音频文件');
        return;
      }

      renderPlaylist();
      renderHomeList();
      showError(`已加载 ${files.length} 首歌曲`);

      if (window.electronAPI) {
        window.electronAPI.saveLastFolder(folderPath).catch(() => {});
      }
    } catch (error) {
      console.error('加载文件夹失败:', error);
      showError('无法加载文件夹，请检查权限');
    }
  }

  async function restoreVolume() {
    if (!window.electronAPI) return;
    try {
      const volume = await window.electronAPI.getVolume();
      if (typeof volume === 'number') {
        els.volumeSlider.value = volume;
      }
    } catch (error) {
      console.error('恢复音量失败:', error);
    }
  }

  async function restoreLastFolder() {
    if (!window.electronAPI) return;
    try {
      const folderPath = await window.electronAPI.getLastFolder();
      if (!folderPath) return;

      const files = await state.playlist.loadFromFolder(folderPath);
      if (files.length > 0) {
        renderPlaylist();
        renderHomeList();
      }
    } catch (error) {
      console.error('恢复上次文件夹失败:', error);
    }
  }

function renderPlaylist() {
    els.playlistContent.innerHTML = '';
    els.playlistCount.textContent = `${state.playlist.getSize()} 首歌曲`;

    if (state.playlist.isEmpty()) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'playlist-empty';
        emptyDiv.textContent = '播放列表为空';
        els.playlistContent.appendChild(emptyDiv);
        return;
    }

    state.playlist.items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'playlist-item';
        if (index === state.playlist.currentIndex) {
            itemDiv.classList.add('active');
        }
        itemDiv.dataset.index = index;

        const indexSpan = document.createElement('span');
        indexSpan.className = 'playlist-item-index';
        indexSpan.textContent = index + 1;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'playlist-item-info';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'playlist-item-name';
        nameDiv.textContent = item.name.replace(/\.[^.]+$/, '');

        const metaDiv = document.createElement('div');
        metaDiv.className = 'playlist-item-meta';
        metaDiv.textContent = formatFileSize(item.size);

        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);

        const coverDiv = document.createElement('div');
        coverDiv.className = 'playlist-item-cover';
        const coverImg = document.createElement('img');
        coverImg.className = 'playlist-item-cover-img';
        coverDiv.appendChild(coverImg);

        itemDiv.appendChild(coverDiv);
        itemDiv.appendChild(indexSpan);
        itemDiv.appendChild(infoDiv);

        itemDiv.addEventListener('click', () => {
            playPlaylistItem(index);
        });

        loadItemCover(coverImg, item);
        els.playlistContent.appendChild(itemDiv);
    });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function togglePlaylistPanel(show) {
    const shouldShow = show === undefined ? !els.playlistPanel.classList.contains('visible') : show;
    
    if (shouldShow) {
        positionPlaylistAboveButton();
        els.playlistPanel.classList.add('visible');
    } else {
        els.playlistPanel.classList.remove('visible');
    }
}

function positionPlaylistAboveButton() {
    const btnRect = els.playlistBtn.getBoundingClientRect();
    const panelWidth = Math.min(500, window.innerWidth * 0.8);
    const panelMaxHeight = window.innerHeight * 0.7;
    const gap = 12;
    
    let left = btnRect.left + btnRect.width / 2 - panelWidth / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - panelWidth - 16));
    
    let bottom = window.innerHeight - btnRect.top + gap;

    if (window.innerHeight - bottom - panelMaxHeight < 16) {
        // Not enough room above the button, position below instead
        els.playlistPanel.style.top = (btnRect.bottom + gap) + 'px';
        els.playlistPanel.style.bottom = 'auto';
    } else {
        els.playlistPanel.style.bottom = bottom + 'px';
        els.playlistPanel.style.top = 'auto';
    }

    els.playlistPanel.style.left = left + 'px';
    els.playlistPanel.style.width = panelWidth + 'px';
}

async function playPlaylistItem(index) {
    const item = state.playlist.setCurrentIndex(index);
    if (!item) return;

    try {
        const file = await readFileAsAudioFile(item.path, item.name);
        await loadFile(file, item.path);
        renderPlaylist();
        renderHomeList();
    } catch (error) {
        console.error('播放失败:', error);
        showError('无法播放该文件');
    }
}

async function handlePrevious() {
    if (state.playlist.isEmpty()) return;

    const item = state.playlist.getPrevious();
    if (item) {
        await playPlaylistItem(state.playlist.currentIndex);
    }
}

async function handleNext() {
    if (state.playlist.isEmpty()) return;

    const item = state.playlist.getNext();
    if (item) {
        await playPlaylistItem(state.playlist.currentIndex);
    }
}

function renderHomeList() {
    els.homeList.innerHTML = '';
    els.homeListCount.textContent = `${state.playlist.getSize()} 首歌曲`;

    if (state.playlist.isEmpty()) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'home-list-empty';
        emptyDiv.textContent = '暂无音乐，请选择文件夹';
        els.homeList.appendChild(emptyDiv);
        return;
    }

    state.playlist.items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'home-item';
        if (index === state.playlist.currentIndex) {
            itemDiv.classList.add('active');
            if (state.isPlaying) {
                itemDiv.classList.add('playing');
            }
        }
        itemDiv.dataset.index = index;

        const indexSpan = document.createElement('span');
        indexSpan.className = 'home-item-index';
        indexSpan.textContent = index + 1;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'home-item-info';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'home-item-name';
        nameDiv.textContent = item.name.replace(/\.[^.]+$/, '');

        const metaDiv = document.createElement('div');
        metaDiv.className = 'home-item-meta';
        metaDiv.textContent = formatFileSize(item.size);

        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);

        const coverDiv = document.createElement('div');
        coverDiv.className = 'home-item-cover';
        const coverImg = document.createElement('img');
        coverImg.className = 'home-item-cover-img';
        coverDiv.appendChild(coverImg);

        itemDiv.appendChild(coverDiv);
        itemDiv.appendChild(indexSpan);
        itemDiv.appendChild(infoDiv);

        itemDiv.addEventListener('click', () => {
            playPlaylistItem(index);
        });

        loadItemCover(coverImg, item);
        els.homeList.appendChild(itemDiv);
    });
}

export async function showHomePage() {
    state.onHomePage = true;
    await cleanupAudio();
    els.homePage.classList.remove('hidden');
    els.controls.classList.remove('visible');
    renderHomeList();
}
