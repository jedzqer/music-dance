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

window.addEventListener('resize', resize);
resize();

requestAnimationFrame(loop);
