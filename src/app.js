import { init, getState, getEls, updateProgressBar } from './controls.js';
import { draw } from './renderer.js';
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
    }
    if (!s.isDraggingProgress) updateProgressBar();

    draw(els.ctx, W, H, cx, cy, s.frequencyData, s.coverPalette, ts * 0.001);
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
