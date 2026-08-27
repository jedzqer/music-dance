import { init, getState, getEls, updateProgressBar, showHomePage, vizManager } from './controls.js';
import { draw as drawRadial } from './renderer.js';
import { initGlowLayer, resizeGlowLayer } from './glowlayer.js';
import { detectBeat, getBassPulse, getBeatEnergy, getLastBeatTime } from './beatdetector.js';

let W, H, cx, cy;
let normalizedFrequencyData = null;

function getBandAverage(data, start, end) {
    if (!data || data.length === 0) return 0;
    const from = Math.max(0, Math.min(data.length, Math.floor(start * data.length)));
    const to = Math.max(from + 1, Math.min(data.length, Math.floor(end * data.length)));
    let sum = 0;
    for (let i = from; i < to; i++) sum += data[i];
    return sum / (to - from) / 255;
}

function buildAudioMetrics(frequencyData, timeDomainData, timestamp, runBeat = true) {
    const length = frequencyData?.length || 0;
    if (!normalizedFrequencyData || normalizedFrequencyData.length !== length) {
        normalizedFrequencyData = new Float32Array(length);
    }
    for (let i = 0; i < length; i++) normalizedFrequencyData[i] = frequencyData[i] / 255;

    let rms = 0;
    let peak = 0;
    if (timeDomainData?.length) {
        let sumSquares = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
            const sample = (timeDomainData[i] - 128) / 128;
            sumSquares += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
        }
        rms = Math.sqrt(sumSquares / timeDomainData.length);
    }

    const bass = getBandAverage(frequencyData, 0, 0.08);
    const lowMid = getBandAverage(frequencyData, 0.08, 0.2);
    const mid = getBandAverage(frequencyData, 0.2, 0.5);
    const highMid = getBandAverage(frequencyData, 0.5, 0.75);
    const treble = getBandAverage(frequencyData, 0.75, 1);
    const energy = getBandAverage(frequencyData, 0, 1);
    const hit = runBeat ? detectBeat(bass, timestamp) : false;

    return {
        frequency: {
            values: frequencyData,
            normalized: normalizedFrequencyData,
            fftSize: length * 2,
            binCount: length,
            binHz: getState().audioContext?.sampleRate ? getState().audioContext.sampleRate / (length * 2) : 0,
            sampleRate: getState().audioContext?.sampleRate || 0
        },
        timeDomain: { values: timeDomainData, rms, peak },
        bands: { bass, lowMid, mid, highMid, treble, energy },
        beat: { hit, energy: getBeatEnergy(), pulse: getBassPulse(), lastBeatTime: getLastBeatTime() }
    };
}

function resize() {
    const els = getEls();
    W = els.canvas.width = window.innerWidth;
    H = els.canvas.height = window.innerHeight;
    cx = W / 2;
    cy = H / 2;
    resizeGlowLayer(W, H);
}

function loop(ts) {
    requestAnimationFrame(loop);
    const s = getState();
    const els = getEls();

    if (s.analyser && s.frequencyData) {
        s.analyser.getByteFrequencyData(s.frequencyData);
        if (s.timeDomainData) s.analyser.getByteTimeDomainData(s.timeDomainData);
    }
    if (!s.isDraggingProgress) updateProgressBar();

    const timestamp = ts * 0.001;
    let metrics = null;
    if (s.vizStyle === 'radial') {
        // Built-in Radial Mode
        drawRadial(els.ctx, W, H, cx, cy, s.frequencyData, s.coverPalette, timestamp);
        metrics = buildAudioMetrics(s.frequencyData, s.timeDomainData, timestamp, false);
        metrics.beat.hit = getLastBeatTime() === timestamp;
    } else {
        // Clear background canvas when custom/iframe visualizer is active
        els.ctx.clearRect(0, 0, W, H);
        metrics = buildAudioMetrics(s.frequencyData, s.timeDomainData, timestamp);
    }

    // Dispatch frame to active visualizer sandbox (if any)
    if (vizManager && s.vizStyle !== 'radial') {
        vizManager.notifyFrame({
            frequencyData: s.frequencyData,
            timeDomainData: s.timeDomainData,
            schemaVersion: 1,
            timestamp,
            audioTime: s.audioElement ? s.audioElement.currentTime : 0,
            frequency: metrics.frequency,
            timeDomain: metrics.timeDomain,
            bands: metrics.bands,
            beat: metrics.beat,
            playback: {
                currentTime: s.audioElement ? s.audioElement.currentTime : 0,
                duration: s.audioElement ? s.audioElement.duration : 0,
                isPlaying: s.isPlaying,
                volume: els.volumeSlider ? els.volumeSlider.value / 100 : 0.8
            },
            dimensions: {
                width: W,
                height: H,
                cx,
                cy,
                dpr: window.devicePixelRatio || 1
            }
        });
    }
}

init();
initGlowLayer();

if (window.electronAPI) {
    document.getElementById('win-minimize')?.addEventListener('click', () => window.electronAPI.windowMinimize());
    document.getElementById('win-maximize')?.addEventListener('click', () => window.electronAPI.windowMaximize());
    document.getElementById('win-close')?.addEventListener('click', () => window.electronAPI.windowClose());

    window.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            window.electronAPI.windowToggleFullscreen();
        }
    });

    if (window.electronAPI.onFullscreenChange) {
        window.electronAPI.onFullscreenChange((isFullscreen) => {
            document.body.classList.toggle('fullscreen', isFullscreen);
        });
    }
} else {
    document.getElementById('title-bar')?.remove();
}

window.addEventListener('resize', resize);
resize();

requestAnimationFrame(loop);

document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
        const s = getState();
        if (!s.onHomePage) {
            await showHomePage();
        }
    }
});
