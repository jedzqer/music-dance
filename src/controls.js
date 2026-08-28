import { formatTime } from './utils.js';
import { loadCoverPalette, pictureToImageUrl, readEmbeddedPicture } from './media.js';
import { parseLyrics, readEmbeddedLyrics } from './lyrics.js';
import { resetParticles } from './particles.js';
import { resetBeatDetector } from './beatdetector.js';
import { resetRenderer } from './renderer.js';
import { Playlist } from './playlist.js';
import { VisualizerManager } from './visualizerManager.js';
import { readJsmediatags } from './binary-utils.js';
import wavePresetHtml from './presets/wave/index.html?raw';
import boilerplatePresetHtml from './presets/boilerplate/index.html?raw';
import pkg from '../package.json';

const CURRENT_VERSION = pkg.version;
const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/jedzqer/music-dance/main/update.json';
const REPO_URL = 'https://github.com/jedzqer/music-dance';

const bundledPresetList = [
    {
        id: 'wave',
        name: '波浪线条',
        author: 'MusicDance',
        description: '优雅的多层动态波浪音频可视化效果',
        icon: '〜',
        isBuiltIn: true,
        htmlContent: wavePresetHtml,
        isLocked: false
    },
    {
        id: 'boilerplate',
        name: '全功能开发示例模板',
        author: 'MusicDance',
        description: '展示 SDK 全量接口（多频段分析、节拍粒子、波形、歌词、封面色彩联动与反向控制）的全面开发示例',
        icon: '🚀',
        isBuiltIn: true,
        htmlContent: boilerplatePresetHtml,
        nativeUI: {
            controls: false,
            lyrics: false,
            progressBar: false,
            coverArt: false
        },
        isLocked: false
    }
];

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
    onHomePage: true,
    loopMode: 'none',       // 'none' | 'all' | 'one'
    shuffleOn: false,
    shuffleHistory: [],
    fftSize: 1024,
    smoothing: 0.72,
    timeDomainData: null,
    autoLoadLrc: true,
    playbackRate: 1,
    crossfadeDuration: 0,       // 0=关闭, 2/3/5 秒
    autoPauseDuration: 0,       // 0=关闭, 3/5/10 秒
    vizStyle: 'radial',         // 'radial' | 'wave' | custom id
    visualizersList: [],
    _crossfadeActive: false,
    _secondaryElement: null,
    _secondarySource: null,
    _gainPrimary: null,
    _gainSecondary: null,
    _compressor: null,
    _analyserGain: null,
    _crossfadeTimeout: null,
    _autoPauseTimeout: null,
    _nextTrackPending: false,
    monitorMode: false,
    _monitorStream: null,
    _monitorSource: null,
    _trackToken: 0
};

export let vizManager = null;

const els = {};

let lyricsLineElements = [];
let currentActiveLyricsEl = null;

const coverCache = new Map(); // path → blob URL string (null = no cover)
let homeSearchQuery = '';

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
        // Use main process to extract cover (reads only file headers, not entire file)
        if (window.electronAPI?.extractCover) {
            const dataUrl = await window.electronAPI.extractCover(item.path);
            coverCache.set(item.path, dataUrl || null);
            return dataUrl || null;
        }
        // Fallback for browser mode
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

let coverObserver = null;
const COVER_CONCURRENCY = 3;
let coverInFlight = 0;
const coverQueue = [];

function processCoverQueue() {
    while (coverInFlight < COVER_CONCURRENCY && coverQueue.length > 0) {
        const { imgEl, item } = coverQueue.shift();
        coverInFlight++;
        getItemCoverUrl(item).then(url => {
            if (url && imgEl.isConnected) {
                imgEl.src = url;
                imgEl.classList.add('loaded');
            }
        }).catch(() => {}).finally(() => {
            coverInFlight--;
            processCoverQueue();
        });
    }
}

function loadItemCover(imgEl, item) {
    if (!coverObserver) {
        coverObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    coverObserver.unobserve(entry.target);
                    const { _coverItem } = entry.target;
                    if (_coverItem) {
                        coverQueue.push({ imgEl: entry.target, item: _coverItem });
                        processCoverQueue();
                    }
                }
            }
        }, { rootMargin: '200px' });
    }
    imgEl._coverItem = item;
    coverObserver.observe(imgEl);
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
    els.miniPlayer = document.getElementById('mini-player');
    els.miniCoverImg = document.getElementById('mini-cover-img');
    els.miniTrackName = document.getElementById('mini-track-name');
    els.miniPlaybackStatus = document.getElementById('mini-playback-status');
    els.miniPlayBtn = document.getElementById('mini-play-btn');
    els.miniPrevBtn = document.getElementById('mini-prev-btn');
    els.miniNextBtn = document.getElementById('mini-next-btn');
    els.miniProgress = document.getElementById('mini-progress');
    els.miniOpenPlayer = document.getElementById('mini-open-player');
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
    els.shuffleBtn = document.getElementById('shuffle-btn');
    els.loopBtn = document.getElementById('loop-btn');
    els.settingsBtn = document.getElementById('settings-btn');
    els.settingsPanel = document.getElementById('settings-panel');
    els.settingsClose = document.getElementById('settings-close');
    els.settingsContent = document.getElementById('settings-content');
    els.homeSearch = document.getElementById('home-search');
    els.vizSwitcherBtn = document.getElementById('viz-switcher-btn');
    els.vizSwitcherPanel = document.getElementById('viz-switcher-panel');
    els.vizSwitcherList = document.getElementById('viz-switcher-list');
    els.vizImportBtn = document.getElementById('viz-import-btn');
    els.vizOpenFolderBtn = document.getElementById('viz-open-folder-btn');
    els.vizReloadBtn = document.getElementById('viz-reload-btn');
    els.monitorBtn = document.getElementById('monitor-btn');
    els.titleBar = document.getElementById('title-bar');
    els.homeSettingsBtn = document.getElementById('home-settings-btn');
    els.settingsCurrentVersion = document.getElementById('settings-current-version');
    els.settingsCheckUpdateBtn = document.getElementById('settings-check-update-btn');
    els.settingsUpdateStatus = document.getElementById('settings-update-status');

    // Init Visualizer Manager
    vizManager = new VisualizerManager({
        container: document.body,
        onNativeUIChange: (uiState) => {
            if (els.controls) {
                els.controls.style.display = uiState.controls ? '' : 'none';
            }
            if (els.lyricsPanel) {
                els.lyricsPanel.style.display = uiState.lyrics ? '' : 'none';
            }
            if (els.progressContainer) {
                els.progressContainer.style.display = uiState.progressBar ? '' : 'none';
            }
            if (els.coverArt) {
                els.coverArt.style.display = uiState.coverArt ? '' : 'none';
            }
        },
        onControlsAction: (method, args) => {
            if (method === 'play') handlePlay();
            else if (method === 'pause') handlePause();
            else if (method === 'togglePlay') handlePlayPause();
            else if (method === 'next') handleNext();
            else if (method === 'prev') handlePrevious();
            else if (method === 'seek' && args[0] !== undefined) {
                if (state.audioElement) {
                    state.audioElement.currentTime = args[0];
                    updateProgressBar();
                }
            } else if (method === 'setVolume' && args[0] !== undefined) {
                const vol = Math.max(0, Math.min(100, args[0] * 100));
                els.volumeSlider.value = vol;
                handleVolume();
            }
        }
    });

    els.fileInput.addEventListener('change', handleFileInput);
    els.playBtn.addEventListener('click', handlePlayPause);
    els.miniPlayBtn?.addEventListener('click', handlePlayPause);
    els.miniPrevBtn?.addEventListener('click', handleMiniPrevious);
    els.miniNextBtn?.addEventListener('click', handleMiniNext);
    els.miniOpenPlayer?.addEventListener('click', showPlayerPage);
    els.miniProgress?.addEventListener('input', handleMiniProgressInput);
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
    els.shuffleBtn.addEventListener('click', handleShuffleToggle);
    els.loopBtn.addEventListener('click', handleCycleLoopMode);
    els.settingsBtn.addEventListener('click', () => toggleSettingsPanel());
    els.settingsClose.addEventListener('click', () => toggleSettingsPanel(false));
    els.settingsContent.addEventListener('click', handleSettingsClick);
    els.homeSettingsBtn?.addEventListener('click', () => toggleSettingsPanel(undefined, els.homeSettingsBtn));
    els.settingsCheckUpdateBtn?.addEventListener('click', handleCheckUpdate);
    if (els.settingsCurrentVersion) els.settingsCurrentVersion.textContent = `v${CURRENT_VERSION}`;
    els.homeSearch.addEventListener('input', handleHomeSearch);
    els.vizSwitcherBtn?.addEventListener('click', () => toggleVizSwitcherPanel());
    els.vizSwitcherPanel?.querySelector('.viz-switcher-close')?.addEventListener('click', () => toggleVizSwitcherPanel(false));
    els.vizImportBtn?.addEventListener('click', handleImportVisualizer);
    els.vizOpenFolderBtn?.addEventListener('click', handleOpenVisualizersFolder);
    els.vizReloadBtn?.addEventListener('click', loadVisualizersList);
    els.monitorBtn?.addEventListener('click', handleMonitorMode);
    document.addEventListener('click', handleOutsideClick);

    restoreVolume();
    restoreLastFolder();
    restoreSettings().finally(() => loadVisualizersList());
}

function setPlayIcon(playing) {
    const playIcon = els.playBtn.querySelector('.icon-play');
    const pauseIcon = els.playBtn.querySelector('.icon-pause');
    if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
    if (els.miniPlayer) {
        els.miniPlayer.classList.toggle('is-playing', playing);
        const miniPlayIcon = els.miniPlayBtn?.querySelector('.mini-icon-play');
        const miniPauseIcon = els.miniPlayBtn?.querySelector('.mini-icon-pause');
        if (miniPlayIcon) miniPlayIcon.style.display = playing ? 'none' : 'block';
        if (miniPauseIcon) miniPauseIcon.style.display = playing ? 'block' : 'none';
        if (els.miniPlaybackStatus) els.miniPlaybackStatus.textContent = playing ? '正在播放' : '已暂停';
    }
    updateMiniPlayer();
}

export function showError(msg) {
    els.errorToast.textContent = msg;
    els.errorToast.classList.add('show');
    clearTimeout(els.errorToast._t);
    els.errorToast._t = setTimeout(() => els.errorToast.classList.remove('show'), 3000);
}

export function updateProgressBar() {
    if (state.monitorMode) return;
    if (!state.audioElement || !state.audioElement.duration) return;
    const pct = state.audioElement.currentTime / state.audioElement.duration;
    const pos = pct * 100;
    els.progressFill.style.width = `${pos}%`;
    els.progressFill.style.height = '';
    els.progressThumb.style.left = `${pos}%`;
    els.progressThumb.style.bottom = '';
    updateLyricsHighlight(state.audioElement.currentTime);
    if (els.miniProgress) {
        els.miniProgress.value = String(Math.round(pos * 10));
    }
}

function updateMiniPlayer() {
    if (!els.miniPlayer) return;
    const hasTrack = !!state.audioElement && !state.monitorMode;
    els.miniPlayer.classList.toggle('has-track', hasTrack);
    if (!hasTrack) return;
    if (els.miniTrackName) {
        els.miniTrackName.textContent = els.trackName?.textContent && els.trackName.textContent !== '\u2014'
            ? els.trackName.textContent : '未选择音乐';
    }
    if (els.miniCoverImg) {
        if (state.coverUrl) {
            els.miniCoverImg.src = state.coverUrl;
            els.miniCoverImg.classList.add('loaded');
        } else {
            els.miniCoverImg.removeAttribute('src');
            els.miniCoverImg.classList.remove('loaded');
        }
    }
    if (state.audioElement.duration && els.miniProgress && !state.isDraggingProgress) {
        els.miniProgress.value = String(Math.round((state.audioElement.currentTime / state.audioElement.duration) * 1000));
    }
}

function handleMiniProgressInput() {
    if (!state.audioElement || !state.audioElement.duration || !els.miniProgress) return;
    state.audioElement.currentTime = (Number(els.miniProgress.value) / 1000) * state.audioElement.duration;
    updateProgressBar();
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
                updateMiniPlayer();
            }
            return null;
        }
    }

    const picture = await readEmbeddedPicture(file);
    state.coverUrl = pictureToImageUrl(picture);
    if (filePath) coverCache.set(filePath, state.coverUrl || null);
    if (!state.coverUrl) return picture;
    els.coverImg.src = state.coverUrl;
    els.coverArt.classList.add('has-cover');
    updateMiniPlayer();
    return picture;
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
        const btn = document.createElement('button');
        btn.className = 'lyrics-load-btn';
        btn.textContent = '手动加载歌词文件';
        btn.addEventListener('click', handleManualLrcLoad);
        els.lyricsContent.appendChild(btn);
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
    const lines = state.parsedLyrics.lines;
    let lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (lines[mid].time <= currentTime) { idx = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    if (idx === state.currentLyricsIndex) return;
    state.currentLyricsIndex = idx;

    if (currentActiveLyricsEl) currentActiveLyricsEl.classList.remove('active');
    currentActiveLyricsEl = null;

    if (idx >= 0 && idx < lyricsLineElements.length) {
        currentActiveLyricsEl = lyricsLineElements[idx];
        currentActiveLyricsEl.classList.add('active');
    }
    if (vizManager) {
        vizManager.notifyLyricsUpdate({
            currentLine: idx >= 0 && lines[idx] ? lines[idx].text : '',
            currentIndex: idx,
            lines
        });
    }
}

function applyLyrics(raw) {
    if (typeof raw === 'object' && raw && raw.lyrics) raw = raw.lyrics;
    if (typeof raw !== 'string') return false;
    state.parsedLyrics = parseLyrics(raw);
    if (!state.parsedLyrics) return false;
    state.currentLyricsIndex = -1;
    renderLyrics();
    if (vizManager) {
        vizManager.notifyLyricsUpdate({
            currentLine: '',
            currentIndex: -1,
            lines: state.parsedLyrics.lines || []
        });
    }
    return true;
}

async function loadEmbeddedLyrics(file) {
    const rawLyrics = await readEmbeddedLyrics(file);
    return applyLyrics(rawLyrics);
}

export async function cleanupAudio() {
    if (state.monitorMode) {
        exitMonitorMode();
        return;
    }
    cancelCrossfade();
    state._trackToken++;
    cancelAutoPause();
    cleanupSecondaryElement();
    if (vizManager) {
        vizManager.notifyTrackChange({ title: '', artist: '', album: '', duration: 0, coverUrl: null, coverPalette: null });
        vizManager.notifyLyricsUpdate({ currentLine: '', currentIndex: -1, lines: [] });
        vizManager.notifyStateChange({ isPlaying: false, volume: els.volumeSlider ? els.volumeSlider.value / 100 : 0.8 });
    }
    if (state.audioElement) {
        state.audioElement.removeEventListener('ended', handleTrackEnded);
        state.audioElement.removeEventListener('timeupdate', handleTimeUpdate);
        state.audioElement.pause();
        state.audioElement.src = '';
        state.audioElement.load();
    }
    // 断开 gain 节点，但保留 AudioContext / analyser / compressor 复用
    if (state._gainPrimary) {
        state._gainPrimary.disconnect();
        state._gainPrimary = null;
    }
    state.audioElement = null;
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
    updateMiniPlayer();
    resetParticles();
    resetBeatDetector();
    resetRenderer();
}

function ensureAudioContext() {
    if (state.audioContext && state.audioContext.state !== 'closed') return;
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = state.fftSize;
    state.analyser.smoothingTimeConstant = state.smoothing;
    state.analyser.minDecibels = -70;
    state.analyser.maxDecibels = -10;
    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
    state.timeDomainData = new Uint8Array(state.analyser.frequencyBinCount);

    // 可视化专用增益节点（固定 1.8），让 analyser 不受音量滑块影响
    state._analyserGain = state.audioContext.createGain();
    state._analyserGain.gain.value = 1.8;
    state._analyserGain.connect(state.analyser);
    // analyser 不连 destination —— 仅作测量，音频输出由 compressor 链负责

    // 播放链：compressor → destination（不再经过 analyser）
    state._compressor = state.audioContext.createDynamicsCompressor();
    state._compressor.threshold.value = -24;
    state._compressor.knee.value = 12;
    state._compressor.ratio.value = 4;
    state._compressor.attack.value = 0.003;
    state._compressor.release.value = 0.15;
    state._compressor.connect(state.audioContext.destination);
}

async function loadFile(file, filePath) {
    if (state.monitorMode) {
        exitMonitorMode();
        await new Promise(r => setTimeout(r, 50));
    }
    await cleanupAudio();
    await new Promise(r => setTimeout(r, 50));
    vizManager?.applyVisualizerNativeUI();

    try {
        ensureAudioContext();

        // 音频图：gainPrimary → compressor → destination（播放链）
        //         trackSource → analyserGain → analyser（可视化链，独立于音量）
        state._gainPrimary = state.audioContext.createGain();
        const vol = els.volumeSlider.value / 100;
        state._gainPrimary.gain.value = vol > 0 ? vol : 0.001;
        state._gainPrimary.connect(state._compressor);

        const url = URL.createObjectURL(file);
        state.audioBlobUrl = url;
        state.audioElement = new Audio(url);
        state.audioElement.volume = 1; // 音量由 GainNode 控制
        state.audioElement.playbackRate = state.playbackRate;

        const trackSource = state.audioContext.createMediaElementSource(state.audioElement);
        trackSource.connect(state._gainPrimary);
        trackSource.connect(state._analyserGain);

        state.audioElement.addEventListener('ended', handleTrackEnded);
        state.audioElement.addEventListener('timeupdate', handleTimeUpdate);

        els.trackName.textContent = file.name.replace(/\.[^.]+$/, '');
        updateMiniPlayer();

        const trackMeta = {
            title: file.name.replace(/\.[^.]+$/, ''),
            artist: '',
            album: '',
            duration: 0,
            coverUrl: null,
            coverPalette: null
        };
        const trackToken = state._trackToken;

        const notifyTrack = () => {
            if (trackToken === state._trackToken) vizManager?.notifyTrackChange({ ...trackMeta });
        };
        notifyTrack();

        readJsmediatags(file, tag => {
            const tags = tag?.tags || {};
            return {
                title: tags.title || trackMeta.title,
                artist: tags.artist || '',
                album: tags.album || ''
            };
        }).then(meta => {
            if (meta) {
                Object.assign(trackMeta, meta);
                notifyTrack();
            }
        });

        loadEmbeddedLyrics(file).then(embeddedLoaded => {
            if (!embeddedLoaded && state.autoLoadLrc && filePath) {
                return tryLoadExternalLrc(filePath);
            }
            return embeddedLoaded;
        }).then(anyLoaded => {
            if (!anyLoaded) renderLyrics();
        }).catch(() => renderLyrics());

        loadCoverArt(file, filePath).then((picture) => {
            trackMeta.coverUrl = state.coverUrl;
            return loadCoverPalette(file, picture);
        }).then((palette) => {
            if (palette) {
                state.coverPalette = palette;
                trackMeta.coverPalette = palette;
            }
            notifyTrack();
        }).catch(() => {
            notifyTrack();
        });

        if (state.audioContext.state === 'suspended') await state.audioContext.resume();
        await state.audioElement.play();
        if (Number.isFinite(state.audioElement.duration)) {
            trackMeta.duration = state.audioElement.duration;
            notifyTrack();
        }
        state.isPlaying = true;
        setPlayIcon(true);
        notifyPlaybackState();
        updateMiniPlayer();

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

function notifyPlaybackState() {
    if (vizManager) {
        vizManager.notifyStateChange({
            isPlaying: state.isPlaying,
            volume: els.volumeSlider ? els.volumeSlider.value / 100 : 0.8
        });
    }
}

function handlePlay() {
    if (!state.audioElement) return;
    if (state.isPlaying) return;
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    state.audioElement.play().then(() => {
        state.isPlaying = true;
        setPlayIcon(true);
        notifyPlaybackState();
    }).catch(() => {});
}

function handlePause() {
    if (!state.audioElement || !state.isPlaying) return;
    state.audioElement.pause();
    setPlayIcon(false);
    state.isPlaying = false;
    notifyPlaybackState();
}

function handlePlayPause() {
    if (state.isPlaying) handlePause();
    else handlePlay();
}

async function handleMiniPrevious() {
    const keepHome = state.onHomePage;
    await handlePrevious();
    if (keepHome && state.audioElement) showHomePage();
}

async function handleMiniNext() {
    const keepHome = state.onHomePage;
    await handleNext();
    if (keepHome && state.audioElement) showHomePage();
}

function handleVolume() {
    const vol = els.volumeSlider.value / 100;
    const now = state.audioContext ? state.audioContext.currentTime : 0;
    // 用 GainNode 控制音量，平滑过渡避免 click
    if (state._gainPrimary) {
        state._gainPrimary.gain.cancelScheduledValues(now);
        state._gainPrimary.gain.setValueAtTime(state._gainPrimary.gain.value, now);
        state._gainPrimary.gain.exponentialRampToValueAtTime(vol > 0 ? vol : 0.001, now + 0.02);
    }
    if (window.electronAPI) {
        window.electronAPI.saveVolume(parseInt(els.volumeSlider.value)).catch(() => {});
    }
    notifyPlaybackState();
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

      homeSearchQuery = '';
      if (els.homeSearch) els.homeSearch.value = '';
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
        toggleSettingsPanel(false);
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
    cancelCrossfade();
    cancelAutoPause();
    if (state.playlist.isEmpty()) return;
    const idx = getPrevTrackIndex();
    if (idx < 0) return;
    state.playlist.setCurrentIndex(idx);
    await playPlaylistItem(idx);
}

async function handleNext() {
    cancelCrossfade();
    cancelAutoPause();
    if (state.playlist.isEmpty()) return;
    const idx = getNextTrackIndex();
    if (idx < 0) return;
    state.playlist.setCurrentIndex(idx);
    await playPlaylistItem(idx);
}

function renderHomeList() {
    els.homeList.innerHTML = '';
    const allItems = state.playlist.items;
    const filtered = homeSearchQuery
        ? allItems.filter(item => item.name.replace(/\.[^.]+$/, '').toLowerCase().includes(homeSearchQuery))
        : allItems;

    let countText = `${filtered.length} 首歌曲`;
    if (homeSearchQuery && allItems.length > 0 && filtered.length !== allItems.length) {
        countText += ` (共 ${allItems.length} 首)`;
    }
    els.homeListCount.textContent = countText;

    if (allItems.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'home-list-empty';
        emptyDiv.textContent = '暂无音乐，请选择文件夹';
        els.homeList.appendChild(emptyDiv);
        return;
    }

    if (filtered.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'home-list-empty';
        emptyDiv.textContent = '没有匹配的歌曲';
        els.homeList.appendChild(emptyDiv);
        return;
    }

    filtered.forEach((item) => {
        const index = allItems.indexOf(item);
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

// ─── Loop/Shuffle/Auto-play ───

function getNextTrackIndex() {
    if (state.loopMode === 'one') return state.playlist.currentIndex;
    if (state.shuffleOn) {
        const idx = state.playlist.getRandomIndex();
        state.shuffleHistory.push(idx);
        return idx;
    }
    if (state.playlist.isAtEnd()) {
        return state.loopMode === 'all' ? 0 : -1;
    }
    return state.playlist.currentIndex + 1;
}

function getPrevTrackIndex() {
    if (state.shuffleOn && state.shuffleHistory.length > 1) {
        state.shuffleHistory.pop();
        return state.shuffleHistory[state.shuffleHistory.length - 1];
    }
    if (state.loopMode === 'one') return state.playlist.currentIndex;
    if (state.playlist.isAtBeginning()) {
        return state.loopMode === 'all' ? state.playlist.items.length - 1 : -1;
    }
    return state.playlist.currentIndex - 1;
}

function handleTrackEnded() {
    // crossfade 进行中时忽略 ended 事件（旧 primary 被提前暂停时可能意外触发）
    if (state._crossfadeActive || state._secondaryElement) return;

    const idx = getNextTrackIndex();
    if (idx < 0) {
        state.isPlaying = false;
        setPlayIcon(false);
        notifyPlaybackState();
        renderHomeList();
        return;
    }
    // 自动暂停（仅在未启用 crossfade 时生效）
    if (state.autoPauseDuration > 0 && state.crossfadeDuration <= 0) {
        state.isPlaying = false;
        setPlayIcon(false);
        notifyPlaybackState();
        state._autoPauseTimeout = setTimeout(() => {
            state._autoPauseTimeout = null;
            state.playlist.setCurrentIndex(idx);
            playPlaylistItem(idx);
        }, state.autoPauseDuration * 1000);
        return;
    }
    state.playlist.setCurrentIndex(idx);
    playPlaylistItem(idx);
}

function cancelAutoPause() {
    if (state._autoPauseTimeout) {
        clearTimeout(state._autoPauseTimeout);
        state._autoPauseTimeout = null;
    }
}

// ─── Crossfade ───

function handleTimeUpdate() {
    if (state._crossfadeActive || state.crossfadeDuration <= 0) return;
    if (state.loopMode === 'one') return;
    const el = state.audioElement;
    if (!el || !el.duration || isNaN(el.duration)) return;
    const remaining = el.duration - el.currentTime;
    if (remaining <= state.crossfadeDuration && remaining > 0) {
        startCrossfade();
    }
}

async function startCrossfade() {
    if (state._crossfadeActive) return;
    const nextIdx = getNextTrackIndex();
    if (nextIdx < 0) return;
    const nextItem = state.playlist.items[nextIdx];
    if (!nextItem) return;

    state._crossfadeActive = true;
    // 清理旧的 secondary 资源（不重置 _crossfadeActive）
    if (state._crossfadeTimeout) {
        clearTimeout(state._crossfadeTimeout);
        state._crossfadeTimeout = null;
    }
    cleanupSecondaryElement();

    // 记录意图开始时间（在异步读取文件之前），用于补偿文件读取延迟
    const intendedStartTime = state.audioContext.currentTime;

    try {
        const file = await readFileAsAudioFile(nextItem.path, nextItem.name);
        const url = URL.createObjectURL(file);

        state._secondaryElement = new Audio(url);
        state._secondaryElement.volume = 1; // 音量由 GainNode 控制
        state._secondaryElement.playbackRate = state.playbackRate;
        state._secondarySource = state.audioContext.createMediaElementSource(state._secondaryElement);
        state._gainSecondary = state.audioContext.createGain();
        state._gainSecondary.gain.value = 0;
        state._secondarySource.connect(state._gainSecondary);
        state._secondarySource.connect(state._analyserGain);
        state._gainSecondary.connect(state._compressor);

        await state._secondaryElement.play();

        const duration = state.crossfadeDuration;
        const fadeEndTime = intendedStartTime + duration;
        const now = state.audioContext.currentTime;

        // 用 Web Audio API 做采样精确的增益渐变
        if (state._gainPrimary) {
            const currentVol = state._gainPrimary.gain.value;
            state._gainPrimary.gain.cancelScheduledValues(now);
            state._gainPrimary.gain.setValueAtTime(currentVol, now);
            state._gainPrimary.gain.linearRampToValueAtTime(0, fadeEndTime);
        }
        if (state._gainSecondary) {
            const currentVol = els.volumeSlider.value / 100;
            state._gainSecondary.gain.cancelScheduledValues(now);
            state._gainSecondary.gain.setValueAtTime(0, now);
            state._gainSecondary.gain.linearRampToValueAtTime(currentVol > 0 ? currentVol : 0.001, fadeEndTime);
        }

        // 用 setTimeout 在渐变完成后触发切换
        const delayMs = Math.max(0, (fadeEndTime - now) * 1000);
        state._crossfadeTimeout = setTimeout(() => {
            state._crossfadeTimeout = null;
            completeCrossfade(nextIdx, file, nextItem);
        }, delayMs);
    } catch (err) {
        console.error('Crossfade 失败:', err);
        cancelCrossfade();
        // 文件读取失败且旧 primary 已结束时，手动推进到下一曲
        if (state.audioElement && state.audioElement.ended) {
            const idx = getNextTrackIndex();
            if (idx >= 0) {
                state.playlist.setCurrentIndex(idx);
                playPlaylistItem(idx);
            }
        }
    }
}

function completeCrossfade(nextIdx, file, item) {
    state._crossfadeActive = false;
    state._trackToken++;
    if (state._crossfadeTimeout) {
        clearTimeout(state._crossfadeTimeout);
        state._crossfadeTimeout = null;
    }

    // 清理旧 primary
    if (state.audioElement) {
        state.audioElement.removeEventListener('ended', handleTrackEnded);
        state.audioElement.removeEventListener('timeupdate', handleTimeUpdate);
        state.audioElement.pause();
        state.audioElement.src = '';
        state.audioElement.load();
    }
    if (state.audioBlobUrl) URL.revokeObjectURL(state.audioBlobUrl);

    // secondary 升级为 primary，确保增益到正确音量
    state.audioElement = state._secondaryElement;
    state.audioBlobUrl = URL.createObjectURL(file);
    state._gainPrimary = state._gainSecondary;
    state._secondaryElement = null;
    state._secondarySource = null;
    state._gainSecondary = null;

    // 确保增益精确到目标音量
    const vol = els.volumeSlider.value / 100;
    state._gainPrimary.gain.cancelScheduledValues(state.audioContext.currentTime);
    state._gainPrimary.gain.setValueAtTime(vol > 0 ? vol : 0.001, state.audioContext.currentTime);

    state.audioElement.addEventListener('ended', handleTrackEnded);
    state.audioElement.addEventListener('timeupdate', handleTimeUpdate);

    state.playlist.setCurrentIndex(nextIdx);
    els.trackName.textContent = file.name.replace(/\.[^.]+$/, '');
    updateMiniPlayer();
    state.parsedLyrics = null;
    state.currentLyricsIndex = -1;
    if (vizManager) vizManager.notifyLyricsUpdate({ currentLine: '', currentIndex: -1, lines: [] });

    const trackMeta = {
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '',
        album: '',
        duration: state.audioElement.duration || 0,
        coverUrl: null,
        coverPalette: null
    };
    const trackToken = state._trackToken;
    const notifyTrack = () => {
        if (trackToken === state._trackToken) vizManager?.notifyTrackChange({ ...trackMeta });
    };
    notifyTrack();
    readJsmediatags(file, tag => {
        const tags = tag?.tags || {};
        return { title: tags.title || trackMeta.title, artist: tags.artist || '', album: tags.album || '' };
    }).then(meta => {
        if (meta) {
            Object.assign(trackMeta, meta);
            notifyTrack();
        }
    });

    // 更新歌词和封面
    loadEmbeddedLyrics(file).then(embeddedLoaded => {
        if (!embeddedLoaded && state.autoLoadLrc && item.path) {
            return tryLoadExternalLrc(item.path);
        }
        return embeddedLoaded;
    }).then(anyLoaded => {
        if (!anyLoaded) renderLyrics();
    }).catch(() => renderLyrics());
    loadCoverArt(file, item.path).then((picture) => {
        trackMeta.coverUrl = state.coverUrl;
        return loadCoverPalette(file, picture);
    }).then((palette) => {
        if (palette) {
            state.coverPalette = palette;
            trackMeta.coverPalette = palette;
        }
        notifyTrack();
    }).catch(() => {});

    renderPlaylist();
    renderHomeList();
}

function cancelCrossfade() {
    state._crossfadeActive = false;
    if (state._crossfadeTimeout) {
        clearTimeout(state._crossfadeTimeout);
        state._crossfadeTimeout = null;
    }
    cleanupSecondaryElement();
    if (state._gainPrimary) {
        const now = state.audioContext.currentTime;
        state._gainPrimary.gain.cancelScheduledValues(now);
        state._gainPrimary.gain.setValueAtTime(els.volumeSlider.value / 100 || 0.001, now);
    }
}

function cleanupSecondaryElement() {
    if (state._secondaryElement) {
        state._secondaryElement.pause();
        state._secondaryElement.src = '';
        state._secondaryElement.load();
        state._secondaryElement = null;
    }
    if (state._secondarySource) {
        state._secondarySource.disconnect();
        state._secondarySource = null;
    }
    if (state._gainSecondary) {
        state._gainSecondary.disconnect();
        state._gainSecondary = null;
    }
}

function handleShuffleToggle() {
    state.shuffleOn = !state.shuffleOn;
    els.shuffleBtn.classList.toggle('active-mode', state.shuffleOn);
    if (state.shuffleOn) state.shuffleHistory = [state.playlist.currentIndex];
    persistSettings();
}

function handleCycleLoopMode() {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(state.loopMode);
    state.loopMode = modes[(idx + 1) % 3];
    updateLoopBtnIcon();
    persistSettings();
}

function updateLoopBtnIcon() {
    const allIcon = els.loopBtn.querySelector('.icon-loop-all');
    const oneIcon = els.loopBtn.querySelector('.icon-loop-one');
    allIcon.style.display = state.loopMode === 'one' ? 'none' : 'block';
    oneIcon.style.display = state.loopMode === 'one' ? 'block' : 'none';
    els.loopBtn.classList.toggle('active-mode', state.loopMode !== 'none');
    els.loopBtn.title = { none: '不循环', all: '列表循环', one: '单曲循环' }[state.loopMode];
}

// ─── Settings ───

function persistSettings() {
    if (!window.electronAPI?.saveSettings) return;
    window.electronAPI.saveSettings({
        loopMode: state.loopMode,
        shuffleOn: state.shuffleOn,
        fftSize: state.fftSize,
        smoothing: state.smoothing,
        autoLoadLrc: state.autoLoadLrc,
        playbackRate: state.playbackRate,
        crossfadeDuration: state.crossfadeDuration,
        autoPauseDuration: state.autoPauseDuration,
        vizStyle: state.vizStyle
    }).catch(() => {});
}

async function restoreSettings() {
    if (!window.electronAPI?.getSettings) return;
    try {
        const settings = await window.electronAPI.getSettings();
        if (settings.loopMode) state.loopMode = settings.loopMode;
        if (typeof settings.shuffleOn === 'boolean') state.shuffleOn = settings.shuffleOn;
        if (settings.fftSize) state.fftSize = settings.fftSize;
        if (settings.smoothing != null) state.smoothing = settings.smoothing;
        if (typeof settings.autoLoadLrc === 'boolean') state.autoLoadLrc = settings.autoLoadLrc;
        if (settings.playbackRate) state.playbackRate = settings.playbackRate;
        if (settings.crossfadeDuration != null) state.crossfadeDuration = settings.crossfadeDuration;
        if (settings.autoPauseDuration != null) state.autoPauseDuration = settings.autoPauseDuration;
        if (settings.vizStyle) state.vizStyle = settings.vizStyle;
        updateLoopBtnIcon();
        els.shuffleBtn.classList.toggle('active-mode', state.shuffleOn);
    } catch (_) {}
}

function toggleSettingsPanel(show, anchorBtn) {
    const shouldShow = show === undefined ? !els.settingsPanel.classList.contains('visible') : show;
    if (shouldShow) {
        togglePlaylistPanel(false);
        positionSettingsAboveButton(anchorBtn || els.settingsBtn);
        syncSettingsUI();
        els.settingsPanel.classList.add('visible');
    } else {
        els.settingsPanel.classList.remove('visible');
    }
}

function positionSettingsAboveButton(anchorBtn) {
    const btnRect = (anchorBtn || els.settingsBtn).getBoundingClientRect();
    const panelWidth = Math.min(400, window.innerWidth * 0.8);
    const gap = 12;
    let left = btnRect.left + btnRect.width / 2 - panelWidth / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - panelWidth - 16));
    let bottom = window.innerHeight - btnRect.top + gap;
    const panelMaxHeight = window.innerHeight * 0.6;
    if (window.innerHeight - bottom - panelMaxHeight < 16) {
        els.settingsPanel.style.top = (btnRect.bottom + gap) + 'px';
        els.settingsPanel.style.bottom = 'auto';
    } else {
        els.settingsPanel.style.bottom = bottom + 'px';
        els.settingsPanel.style.top = 'auto';
    }
    els.settingsPanel.style.left = left + 'px';
    els.settingsPanel.style.width = panelWidth + 'px';
}

function toggleVizSwitcherPanel(show) {
    const panel = els.vizSwitcherPanel;
    if (!panel) return;
    const shouldShow = show === undefined ? !panel.classList.contains('visible') : show;
    if (shouldShow) {
        toggleSettingsPanel(false);
        togglePlaylistPanel(false);
        positionVizSwitcherPanel();
        renderVizSwitcherList();
        panel.classList.add('visible');
    } else {
        panel.classList.remove('visible');
    }
}

function positionVizSwitcherPanel() {
    const btnRect = els.vizSwitcherBtn.getBoundingClientRect();
    const panelWidth = Math.min(380, window.innerWidth * 0.9);
    const gap = 10;
    let left = btnRect.left + btnRect.width / 2 - panelWidth / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - panelWidth - 16));
    els.vizSwitcherPanel.style.top = (btnRect.bottom + gap) + 'px';
    els.vizSwitcherPanel.style.left = left + 'px';
    els.vizSwitcherPanel.style.width = panelWidth + 'px';
}

export async function loadVisualizersList() {
    const defaultList = [
        {
            id: 'radial',
            name: '径向频谱',
            author: 'MusicDance',
            description: '经典同心圆发光粒子径向频谱（核心内置）',
            icon: '◎',
            isBuiltIn: true,
            isLocked: true
        }
    ];

    if (window.electronAPI?.listVisualizers) {
        try {
            const externalList = await window.electronAPI.listVisualizers();
            // Electron reports templates from the user data directory as file:// URLs.
            // Prefer the bundled HTML for shipped examples so the SDK can be injected
            // into the sandbox even when the host page is served by Vite over http://.
            const bundledById = new Map(bundledPresetList.map(item => [item.id, item]));
            const externalIds = new Set(externalList.map(item => item.id));
            const mergedExternal = externalList.map(item => {
                const bundled = bundledById.get(item.id);
                return bundled
                    ? { ...item, ...bundled, entryUrl: undefined, isBuiltIn: true }
                    : item;
            });
            const missingBundled = bundledPresetList.filter(item => !externalIds.has(item.id));
            state.visualizersList = [...defaultList, ...mergedExternal, ...missingBundled];
        } catch (e) {
            console.error('加载外置可视化列表失败:', e);
            state.visualizersList = [...defaultList, ...bundledPresetList];
        }
    } else {
        state.visualizersList = [...defaultList, ...bundledPresetList];
    }

    renderVizSwitcherList();
    const selected = state.visualizersList.find(v => v.id === state.vizStyle);
    if (!selected) {
        state.vizStyle = 'radial';
        persistSettings();
    }
    if (vizManager) {
        await vizManager.loadVisualizer(selected || defaultList[0]);
    }
}

function renderVizSwitcherList() {
    if (!els.vizSwitcherList) return;
    els.vizSwitcherList.innerHTML = '';

    state.visualizersList.forEach(item => {
        const option = document.createElement('div');
        option.className = 'viz-switcher-option';
        if (state.vizStyle === item.id) {
            option.classList.add('active');
        }

        const leftDiv = document.createElement('div');
        leftDiv.className = 'viz-option-left';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'viz-option-icon';
        iconSpan.textContent = item.icon || '✨';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'viz-option-info';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'viz-option-label';
        labelSpan.textContent = item.name || item.id;

        const descSpan = document.createElement('span');
        descSpan.className = 'viz-option-desc';
        descSpan.textContent = item.description || (item.author ? `作者: ${item.author}` : '');

        infoDiv.appendChild(labelSpan);
        if (descSpan.textContent) infoDiv.appendChild(descSpan);

        leftDiv.appendChild(iconSpan);
        leftDiv.appendChild(infoDiv);
        option.appendChild(leftDiv);

        if (item.isLocked) {
            const lockedTag = document.createElement('span');
            lockedTag.className = 'viz-option-tag locked';
            lockedTag.textContent = '锁定';
            option.appendChild(lockedTag);
        } else if (window.electronAPI?.deleteVisualizer && !item.isBuiltIn) {
            const delBtn = document.createElement('button');
            delBtn.className = 'viz-option-delete';
            delBtn.title = '删除此可视化效果';
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`确定要删除可视化模版 “${item.name}” 吗？`)) {
                    await window.electronAPI.deleteVisualizer(item.id);
                    if (state.vizStyle === item.id) {
                        selectVisualizer('radial');
                    }
                    await loadVisualizersList();
                }
            });
            option.appendChild(delBtn);
        }

        option.addEventListener('click', () => {
            selectVisualizer(item.id);
        });

        els.vizSwitcherList.appendChild(option);
    });
}

export async function selectVisualizer(vizId) {
    state.vizStyle = vizId;
    renderVizSwitcherList();
    persistSettings();

    const selected = state.visualizersList.find(v => v.id === vizId) || { id: 'radial' };
    if (vizManager) {
        await vizManager.loadVisualizer(selected);
    }
}

async function handleImportVisualizer() {
    if (!window.electronAPI?.importVisualizerDialog) {
        // Fallback for Web browser upload
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.html,.htm';
        input.addEventListener('change', async () => {
            const file = input.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const customId = `custom-${Date.now()}`;
                const customItem = {
                    id: customId,
                    name: file.name.replace(/\.[^.]+$/, ''),
                    description: '用户上传的单文件模板',
                    icon: '📄',
                    htmlContent: text
                };
                state.visualizersList.push(customItem);
                renderVizSwitcherList();
                selectVisualizer(customId);
                showError('可视化效果已导入');
            } catch (err) {
                showError('读取可视化文件失败');
            }
        });
        input.click();
        return;
    }

    try {
        const res = await window.electronAPI.importVisualizerDialog();
        if (res && res.success) {
            await loadVisualizersList();
            selectVisualizer(res.id);
            showError('可视化效果导入成功！');
        }
    } catch (e) {
        console.error('导入可视化失败:', e);
        showError('导入失败，请检查文件格式');
    }
}

async function handleOpenVisualizersFolder() {
    if (!window.electronAPI?.openVisualizersFolder) {
        showError('仅在桌面客户端中支持打开文件夹');
        return;
    }
    await window.electronAPI.openVisualizersFolder();
}

function compareVersions(a, b) {
    const pa = a.replace(/^v/i, '').split('.').map(Number);
    const pb = b.replace(/^v/i, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return na > nb ? 1 : -1;
    }
    return 0;
}

async function handleCheckUpdate() {
    if (!els.settingsUpdateStatus) return;
    els.settingsUpdateStatus.classList.remove('has-update');
    els.settingsUpdateStatus.textContent = '正在检查更新…';
    els.settingsCheckUpdateBtn.disabled = true;
    try {
        const res = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const manifest = await res.json();
        const latestVersion = manifest.version;
        if (latestVersion && compareVersions(latestVersion, CURRENT_VERSION) > 0) {
            els.settingsUpdateStatus.classList.add('has-update');
            els.settingsUpdateStatus.innerHTML =
                `发现新版本 v${latestVersion}，<a href="${manifest.url || REPO_URL}" target="_blank" rel="noopener noreferrer">点击前往下载</a>`;
        } else {
            els.settingsUpdateStatus.textContent = '当前已是最新版本';
        }
    } catch (err) {
        console.error('检查更新失败:', err);
        els.settingsUpdateStatus.textContent = '检查更新失败，请检查网络连接';
    } finally {
        els.settingsCheckUpdateBtn.disabled = false;
    }
}

function syncSettingsUI() {
    document.querySelectorAll('[data-loop]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.loop === state.loopMode);
    });
    const shuffleToggle = document.getElementById('settings-shuffle-toggle');
    if (shuffleToggle) shuffleToggle.textContent = state.shuffleOn ? '开启' : '关闭';
    document.querySelectorAll('[data-fft]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.fft) === state.fftSize);
    });
    document.querySelectorAll('[data-smoothing]').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.smoothing) === state.smoothing);
    });
    const lrcToggle = document.getElementById('settings-lrc-toggle');
    if (lrcToggle) lrcToggle.textContent = state.autoLoadLrc ? '开启' : '关闭';
    document.querySelectorAll('[data-rate]').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.rate) === state.playbackRate);
    });
    document.querySelectorAll('[data-crossfade]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.crossfade) === state.crossfadeDuration);
    });
    document.querySelectorAll('[data-pause]').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.pause) === state.autoPauseDuration);
    });
}

function handleSettingsClick(e) {
    const option = e.target.closest('.settings-option');
    if (!option) return;
    if (option.dataset.loop) {
        state.loopMode = option.dataset.loop;
        updateLoopBtnIcon();
    } else if (option.id === 'settings-shuffle-toggle') {
        state.shuffleOn = !state.shuffleOn;
        els.shuffleBtn.classList.toggle('active-mode', state.shuffleOn);
        if (state.shuffleOn) state.shuffleHistory = [state.playlist.currentIndex];
    } else if (option.dataset.fft) {
        state.fftSize = parseInt(option.dataset.fft);
        // 实时生效：更新 analyser 和 frequencyData 缓冲区
        if (state.analyser) {
            state.analyser.fftSize = state.fftSize;
            state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
            state.timeDomainData = new Uint8Array(state.analyser.frequencyBinCount);
        }
    } else if (option.dataset.smoothing) {
        state.smoothing = parseFloat(option.dataset.smoothing);
        if (state.analyser) state.analyser.smoothingTimeConstant = state.smoothing;
    } else if (option.id === 'settings-lrc-toggle') {
        state.autoLoadLrc = !state.autoLoadLrc;
    } else if (option.dataset.rate) {
        state.playbackRate = parseFloat(option.dataset.rate);
        if (state.audioElement) state.audioElement.playbackRate = state.playbackRate;
    } else if (option.dataset.crossfade) {
        state.crossfadeDuration = parseInt(option.dataset.crossfade);
        if (state.crossfadeDuration > 0) state.autoPauseDuration = 0; // 互斥
    } else if (option.dataset.pause) {
        state.autoPauseDuration = parseInt(option.dataset.pause);
        if (state.autoPauseDuration > 0) state.crossfadeDuration = 0; // 互斥
    }
    syncSettingsUI();
    persistSettings();
}

// ─── External LRC ───

async function tryLoadExternalLrc(filePath) {
    if (!filePath || !window.electronAPI?.readLrcFile) return false;
    const lrcPath = filePath.replace(/\.[^.]+$/, '.lrc');
    try {
        const raw = await window.electronAPI.readLrcFile(lrcPath);
        if (raw) return applyLyrics(raw);
    } catch (_) {}
    return false;
}

function handleManualLrcLoad() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lrc';
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            if (!applyLyrics(text)) {
                showError('无法解析歌词文件');
            }
        } catch (_) {
            showError('读取歌词文件失败');
        }
    });
    input.click();
}

// ─── Search ───

function handleHomeSearch() {
    homeSearchQuery = els.homeSearch.value.trim().toLowerCase();
    renderHomeList();
}

function handleOutsideClick(e) {
    if (els.settingsPanel.classList.contains('visible') &&
        !els.settingsPanel.contains(e.target) && !els.settingsBtn.contains(e.target) &&
        !els.homeSettingsBtn?.contains(e.target)) {
        toggleSettingsPanel(false);
    }
    if (els.playlistPanel.classList.contains('visible') &&
        !els.playlistPanel.contains(e.target) && !els.playlistBtn.contains(e.target)) {
        togglePlaylistPanel(false);
    }
    if (els.vizSwitcherPanel?.classList.contains('visible') &&
        !els.vizSwitcherPanel.contains(e.target) && !els.vizSwitcherBtn.contains(e.target)) {
        toggleVizSwitcherPanel(false);
    }
}

export async function showHomePage() {
    if (state.monitorMode) {
        exitMonitorMode();
        return;
    }
    state.onHomePage = true;
    vizManager?.resetNativeUI();
    els.homePage.classList.remove('hidden');
    els.controls.classList.remove('visible');
    els.playlistPanel?.classList.remove('visible');
    els.settingsPanel?.classList.remove('visible');
    homeSearchQuery = '';
    if (els.homeSearch) els.homeSearch.value = '';
    renderHomeList();
    updateMiniPlayer();
}

export function showPlayerPage() {
    if (state.monitorMode) return;
    state.onHomePage = false;
    els.homePage.classList.add('hidden');
    vizManager?.applyVisualizerNativeUI();
    if (state.audioElement) els.controls.classList.add('visible');
    updateMiniPlayer();
}

async function handleMonitorMode() {
    if (state.monitorMode) return;

    let stream;
    try {
        if (window.electronAPI?.getDesktopSources) {
            // Electron: use desktopCapturer to get system audio
            const sources = await window.electronAPI.getDesktopSources();
            const screen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
            if (!screen) {
                showError('未找到可捕获的音频源');
                return;
            }
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screen.id
                    }
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: screen.id,
                        minWidth: 1,
                        maxWidth: 1,
                        minHeight: 1,
                        maxHeight: 1
                    }
                }
            });
        } else {
            // Browser: use getDisplayMedia
            stream = await navigator.mediaDevices.getDisplayMedia({
                audio: true,
                video: { width: 1, height: 1, frameRate: 1 }
            });
        }
    } catch {
        return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        showError('未检测到音频，请选择包含音频的窗口或标签页');
        return;
    }

    stream.getVideoTracks().forEach(t => t.stop());

    if (state.audioElement) {
        await cleanupAudio();
    }

    ensureAudioContext();

    // 监听模式：断开 analyserGain，直接连 source→analyser
    if (state._analyserGain) state._analyserGain.disconnect();
    state.analyser.disconnect();

    const source = state.audioContext.createMediaStreamSource(stream);
    source.connect(state.analyser);
    // 不连接 destination —— 系统已在播放音频，只需 FFT 数据做可视化

    state._monitorStream = stream;
    state._monitorSource = source;
    state.monitorMode = true;

    els.homePage.classList.add('hidden');
    els.controls.classList.remove('visible');
    els.lyricsPanel.classList.remove('visible');
    els.coverArt.style.display = 'none';
    els.progressContainer.style.display = 'none';
    state.onHomePage = false;

    audioTracks[0].addEventListener('ended', exitMonitorMode);
}

function exitMonitorMode() {
    if (!state.monitorMode) return;
    state.monitorMode = false;

    if (state._monitorStream) {
        state._monitorStream.getTracks().forEach(t => t.stop());
        state._monitorStream = null;
    }

    if (state._monitorSource) {
        state._monitorSource.disconnect();
        state._monitorSource = null;
    }

    // 恢复正常播放的信号链：analyserGain → analyser（仅测量，不连 destination）
    if (state._analyserGain) {
        state._analyserGain.disconnect();
        state._analyserGain.connect(state.analyser);
    }
    if (state.analyser) {
        state.analyser.disconnect();
    }

    resetParticles();
    resetBeatDetector();
    resetRenderer();

    els.coverArt.style.display = '';
    els.progressContainer.style.display = '';
    state.onHomePage = true;

    els.homePage.classList.remove('hidden');
    els.controls.classList.remove('visible');
    els.lyricsPanel.classList.remove('visible');
    homeSearchQuery = '';
    if (els.homeSearch) els.homeSearch.value = '';
    renderHomeList();
}
