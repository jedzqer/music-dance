import { formatTime } from './utils.js';
import { loadCoverPalette, pictureToImageUrl, readEmbeddedPicture } from './media.js';
import { parseLyrics, readEmbeddedLyrics } from './lyrics.js';
import { resetParticles } from './particles.js';
import { resetBeatDetector } from './beatdetector.js';
import { getFFTSize, resetRenderer } from './renderer.js';

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
    coverUrl: null
};

const els = {};

export function getState() {
    return state;
}

export function getEls() {
    return els;
}

export function init() {
    els.canvas = document.getElementById('canvas');
    els.ctx = els.canvas.getContext('2d');
    els.overlay = document.getElementById('overlay');
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

    els.fileInput.addEventListener('change', handleFileInput);
    els.playBtn.addEventListener('click', handlePlayPause);
    els.volumeSlider.addEventListener('input', handleVolume);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    els.progressContainer.addEventListener('mousedown', handleProgressMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    els.progressContainer.addEventListener('mousemove', handleProgressHover);
    els.progressContainer.addEventListener('mouseleave', handleProgressMouseLeave);
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

async function loadCoverArt(file) {
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    state.coverUrl = null;
    els.coverImg.removeAttribute('src');
    els.coverArt.classList.remove('has-cover');

    const picture = await readEmbeddedPicture(file);
    state.coverUrl = pictureToImageUrl(picture);
    if (!state.coverUrl) return;
    els.coverImg.src = state.coverUrl;
    els.coverArt.classList.add('has-cover');
}

function renderLyrics() {
    els.lyricsContent.innerHTML = '';
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
        if (!state.parsedLyrics.isLRC && i === 0) div.classList.add('active');
        div.textContent = state.parsedLyrics.lines[i].text;
        div.dataset.index = i;
        els.lyricsContent.appendChild(div);
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

    const prev = els.lyricsContent.querySelector('.lyrics-line.active');
    if (prev) prev.classList.remove('active');

    if (idx >= 0) {
        const el = els.lyricsContent.querySelector(`.lyrics-line[data-index="${idx}"]`);
        if (el) el.classList.add('active');
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
    els.coverImg.removeAttribute('src');
    els.coverArt.classList.remove('has-cover');
    els.lyricsContent.innerHTML = '';
    els.lyricsPanel.classList.remove('visible');
    els.progressFill.style.height = '0%';
    els.progressFill.style.width = '0%';
    els.progressThumb.style.bottom = '0%';
    els.progressThumb.style.left = '0%';
    els.playBtn.textContent = '\u25b6';
    els.trackName.textContent = '\u2014';
    resetParticles();
    resetBeatDetector();
    resetRenderer();
}

async function loadFile(file) {
    await cleanupAudio();
    await new Promise(r => setTimeout(r, 50));

    try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = getFFTSize();
        state.analyser.smoothingTimeConstant = 0.72;
        state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);

        const url = URL.createObjectURL(file);
        state.audioElement = new Audio(url);
        state.audioElement.volume = els.volumeSlider.value / 100;

        const trackSource = state.audioContext.createMediaElementSource(state.audioElement);
        trackSource.connect(state.analyser);
        state.analyser.connect(state.audioContext.destination);

        state.audioElement.addEventListener('ended', () => {
            state.isPlaying = false;
            els.playBtn.textContent = '\u25b6';
        });

        els.trackName.textContent = file.name.replace(/\.[^.]+$/, '');

        loadEmbeddedLyrics(file).catch(() => renderLyrics());
        loadCoverArt(file).catch(() => {});
        loadCoverPalette(file).then((palette) => {
            if (palette) state.coverPalette = palette;
        });

        await state.audioElement.play();
        state.isPlaying = true;
        els.playBtn.textContent = '\u23f8';

        els.overlay.classList.add('hidden');
        els.controls.classList.add('visible');
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
        els.playBtn.textContent = '\u25b6';
        state.isPlaying = false;
    } else {
        if (state.audioContext.state === 'suspended') state.audioContext.resume();
        state.audioElement.play().catch(() => {});
        els.playBtn.textContent = '\u23f8';
        state.isPlaying = true;
    }
}

function handleVolume() {
    if (state.audioElement) state.audioElement.volume = els.volumeSlider.value / 100;
}

function handleKeyDown(e) {
    if (e.code === 'Space' && state.audioElement) {
        e.preventDefault();
        els.playBtn.click();
    }
}

function handleDragOver(e) {
    e.preventDefault();
    els.overlay.style.background = 'rgba(5, 5, 16, 0.45)';
}

function handleDragLeave(e) {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        els.overlay.style.background = 'rgba(5, 5, 16, 0.75)';
    }
}

function handleDrop(e) {
    e.preventDefault();
    els.overlay.style.background = 'rgba(5, 5, 16, 0.75)';
    const file = e.dataTransfer.files[0];
    if (!file) return;
    els.fileInput.files = e.dataTransfer.files;
    els.fileInput.dispatchEvent(new Event('change'));
}
