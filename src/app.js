import { init, getState, getEls, updateProgressBar, showHomePage, vizManager } from './controls.js';
import { draw as drawRadial } from './renderer.js';
import { initGlowLayer, resizeGlowLayer } from './glowlayer.js';

let W, H, cx, cy;

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

    if (s.vizStyle === 'radial') {
        // Built-in Radial Mode
        drawRadial(els.ctx, W, H, cx, cy, s.frequencyData, s.coverPalette, ts * 0.001);
    } else {
        // Clear background canvas when custom/iframe visualizer is active
        els.ctx.clearRect(0, 0, W, H);
    }

    // Dispatch frame to active visualizer sandbox (if any)
    if (vizManager && s.vizStyle !== 'radial') {
        vizManager.notifyFrame({
            frequencyData: s.frequencyData,
            timeDomainData: s.timeDomainData,
            timestamp: ts * 0.001,
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
