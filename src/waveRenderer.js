import { hslToRgb, colorWithLightness, clamp } from './utils.js';
import { spawnParticles, updateParticles } from './particles.js';
import {
    detectBeat, addShockwave, updateShockwaves, getShockwaves,
    getBassPulse, getBeatEnergy, getLastBeatTime, updateBeatFlash, getBeatFlashAlpha
} from './beatdetector.js';
import { renderGlowLayer } from './glowlayer.js';

const FFT_SIZE = 1024;
const NUM_LINES = 7;
const LINE_SEGMENTS = 128;

let avgVolume = 0;
let climaxLevel = 0;
let lineDisplacements = new Float32Array(NUM_LINES * LINE_SEGMENTS);

export function resetRenderer() {
    avgVolume = 0;
    climaxLevel = 0;
    lineDisplacements.fill(0);
}

export function getFFTSize() {
    return FFT_SIZE;
}

export function draw(ctx, W, H, cx, cy, frequencyData, coverPalette, t) {
    // ─── Audio analysis ───
    let intensity = 0;
    let bassAvg = 0;
    let climaxTarget = 0;

    if (frequencyData && frequencyData.length > 0) {
        let sum = 0;
        for (let i = 0; i < frequencyData.length; i++) sum += frequencyData[i];
        const curVol = sum / frequencyData.length / 255;
        avgVolume += (curVol - avgVolume) * 0.06;

        const bassBins = Math.min(16, frequencyData.length);
        for (let i = 0; i < bassBins; i++) bassAvg += frequencyData[i];
        bassAvg /= bassBins * 255;

        climaxTarget = Math.max(0, Math.min(1, (curVol - 0.22) * 2.8));
        climaxLevel += (climaxTarget - climaxLevel) * 0.07;
        intensity = avgVolume * 0.7 + climaxLevel * 0.3;
    } else {
        climaxLevel += (0 - climaxLevel) * 0.03;
        avgVolume += (0 - avgVolume) * 0.03;
        intensity = Math.max(0, avgVolume);
    }

    const beatHit = detectBeat(bassAvg, t);
    if (beatHit) {
        const hue = 205 - climaxLevel * 205;
        addShockwave(hue);
        spawnParticles(cx, cy, 24 + Math.floor(climaxLevel * 34), hue, 4 + climaxLevel * 7);
    }

    updateBeatFlash(climaxLevel);
    updateShockwaves();

    const bassPulse = getBassPulse();
    const beatEnergy = getBeatEnergy();
    const lastBeatTime = getLastBeatTime();
    const beatFlashAlpha = getBeatFlashAlpha();
    const shockwaves = getShockwaves();
    const globalIntensity = Math.min(1, intensity * 2.2 + 0.08);

    // ─── Background trail ───
    const baseTrail = 0.1 - climaxLevel * 0.03;
    const bgHue = 218 - climaxLevel * 120 + Math.sin(t * 0.08) * 18;
    const bgPulse = 0.5 + Math.sin(t * 0.32) * 0.5;
    const [bgR, bgG, bgB] = hslToRgb(Math.max(0, bgHue), 76, 7 + bgPulse * 3 + globalIntensity * 5);
    ctx.fillStyle = `rgba(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)},${Math.max(0.045, baseTrail)})`;
    ctx.fillRect(0, 0, W, H);

    // ─── Glow layer ───
    const ambientAlpha = 0.11 + globalIntensity * 0.16 + climaxLevel * 0.08;
    const driftX = cx + Math.sin(t * 0.13) * W * 0.2;
    const driftY = cy + Math.cos(t * 0.11) * H * 0.18;
    const accentColor = coverPalette?.colors[1] || coverPalette?.colors[0];
    const [haloR, haloG, haloB] = coverPalette
        ? colorWithLightness(coverPalette.colors[0], 46 + globalIntensity * 18, 1.25)
        : hslToRgb(Math.max(0, bgHue - 18), 88, 48 + globalIntensity * 16);
    const accentX = cx + Math.cos(t * 0.17 + 1.6) * W * 0.34;
    const accentY = cy + Math.sin(t * 0.15 + 0.7) * H * 0.26;
    const [ar, ag, ab] = coverPalette
        ? colorWithLightness(accentColor, 50 + bassPulse * 20, 1.28)
        : hslToRgb(330 - climaxLevel * 120 + Math.sin(t * 0.1) * 28, 88, 54 + bassPulse * 18);
    const accentAlpha = 0.055 + bassPulse * 0.12 + climaxLevel * 0.07;

    renderGlowLayer(
        W, H,
        driftX, driftY, haloR / 255, haloG / 255, haloB / 255, ambientAlpha, 0.24,
        accentX, accentY, ar / 255, ag / 255, ab / 255, accentAlpha, 0.17
    );

    // ─── Wave lines displacement ───
    const minDim = Math.min(W, H);
    const lineSpacing = minDim * 0.05;
    const lineHalfWidth = W * 0.4;
    const bins = frequencyData ? frequencyData.length : 0;

    for (let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++) {
        const distFromCenter = Math.abs(lineIdx - 3);
        const sign = lineIdx < 3 ? -1 : (lineIdx === 3 ? 0 : 1);
        const outerScale = 0.5 + distFromCenter * 0.45;

        // Symmetric frequency mapping: center = bass, edges = treble
        const freqStart = Math.floor(bins * 0.02);
        const centerEnd = Math.floor(bins * 0.12);
        const edgeEnd = Math.floor(bins * 0.72);
        const freqEnd = centerEnd + Math.floor((edgeEnd - centerEnd) * (distFromCenter / 3));
        const freqSpan = Math.max(1, freqEnd - freqStart);

        for (let seg = 0; seg < LINE_SEGMENTS; seg++) {
            const normalizedX = seg / (LINE_SEGMENTS - 1);
            const smoothIdx = lineIdx * LINE_SEGMENTS + seg;

            lineDisplacements[smoothIdx] *= 0.55;

            // Left-right symmetry: center of line = bass, edges = treble
            const mirrorX = Math.abs(normalizedX - 0.5) * 2;

            let freqVal = 0;
            if (bins > 0) {
                const freqBinIndex = freqStart + Math.floor(mirrorX * freqSpan);
                freqVal = frequencyData[Math.min(freqBinIndex, bins - 1)] / 255;
            }

            const displace = freqVal * sign * minDim * 0.16 * outerScale;
            lineDisplacements[smoothIdx] += displace * 0.7;
        }
    }

    // ─── Background bubble (follows line contours) ───
    {
        const bubbleHue = 210 - climaxLevel * 160;
        const [bubR, bubG, bubB] = coverPalette
            ? colorWithLightness(coverPalette.colors[0], 40 + climaxLevel * 20, 1.1)
            : hslToRgb(Math.max(0, bubbleHue), 80, 45 + climaxLevel * 15);
        const bubAlpha = 0.06 + bassPulse * 0.06 + climaxLevel * 0.03;
        const pad = lineSpacing * (0.6 + bassPulse * 0.4);

        ctx.save();
        ctx.beginPath();
        // Top boundary: line 0 (topmost), left to right
        const topBase = cy + (0 - 3) * lineSpacing;
        const botBase = cy + (6 - 3) * lineSpacing;
        for (let seg = 0; seg < LINE_SEGMENTS; seg++) {
            const x = (cx - lineHalfWidth) + (seg / (LINE_SEGMENTS - 1)) * lineHalfWidth * 2;
            const yTop = topBase + lineDisplacements[seg] - pad;
            if (seg === 0) ctx.moveTo(x, yTop);
            else ctx.lineTo(x, yTop);
        }
        // Right cap: smooth curve from top-right to bottom-right
        const lastX = cx + lineHalfWidth;
        const topRightY = topBase + lineDisplacements[LINE_SEGMENTS - 1] - pad;
        const botRightY = botBase + lineDisplacements[6 * LINE_SEGMENTS + LINE_SEGMENTS - 1] + pad;
        ctx.quadraticCurveTo(lastX + pad, (topRightY + botRightY) / 2, lastX, botRightY);
        // Bottom boundary: line 6 (bottommost), right to left
        for (let seg = LINE_SEGMENTS - 1; seg >= 0; seg--) {
            const x = (cx - lineHalfWidth) + (seg / (LINE_SEGMENTS - 1)) * lineHalfWidth * 2;
            const yBot = botBase + lineDisplacements[6 * LINE_SEGMENTS + seg] + pad;
            ctx.lineTo(x, yBot);
        }
        // Left cap: smooth curve from bottom-left to top-left
        const firstX = cx - lineHalfWidth;
        const topLeftY = topBase + lineDisplacements[0] - pad;
        const botLeftY = botBase + lineDisplacements[6 * LINE_SEGMENTS] + pad;
        ctx.quadraticCurveTo(firstX - pad, (topLeftY + botLeftY) / 2, firstX, topLeftY);
        ctx.closePath();

        const bubGrad = ctx.createLinearGradient(cx, topBase - pad, cx, botBase + pad);
        bubGrad.addColorStop(0, `rgba(${Math.round(bubR)},${Math.round(bubG)},${Math.round(bubB)},${bubAlpha})`);
        bubGrad.addColorStop(0.5, `rgba(${Math.round(bubR)},${Math.round(bubG)},${Math.round(bubB)},${bubAlpha * 1.6})`);
        bubGrad.addColorStop(1, `rgba(${Math.round(bubR)},${Math.round(bubG)},${Math.round(bubB)},${bubAlpha})`);
        ctx.fillStyle = bubGrad;
        ctx.fill();
        ctx.restore();
    }

    // ─── Draw wave lines ───
    for (let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++) {
        const distFromCenter = Math.abs(lineIdx - 3);
        const baseY = cy + (lineIdx - 3) * lineSpacing;

        // Compute average amplitude for color
        let ampSum = 0;
        const smoothBase = lineIdx * LINE_SEGMENTS;
        for (let seg = 0; seg < LINE_SEGMENTS; seg++) {
            ampSum += Math.abs(lineDisplacements[smoothBase + seg]);
        }
        const avgAmp = ampSum / LINE_SEGMENTS;

        // Color
        const hue = 210 - climaxLevel * 160 - distFromCenter * 15;
        const [r, g, b] = coverPalette
            ? colorWithLightness(coverPalette.colors[Math.min(distFromCenter, coverPalette.colors.length - 1)], 50 + clamp(avgAmp * 0.8, 0, 25), 1.2)
            : hslToRgb(Math.max(0, hue), 85, 55 + climaxLevel * 20);

        const alpha = clamp(0.45 + bassPulse * 0.35 + climaxLevel * 0.2 - distFromCenter * 0.06, 0.1, 1);
        const lineWidth = (4.5 - distFromCenter * 1.0) + bassPulse * 2;
        const shadowBlur = 14 + bassPulse * 30 + climaxLevel * 20;

        ctx.save();
        ctx.beginPath();

        for (let seg = 0; seg < LINE_SEGMENTS; seg++) {
            const x = (cx - lineHalfWidth) + (seg / (LINE_SEGMENTS - 1)) * lineHalfWidth * 2;
            const smoothIdx = lineIdx * LINE_SEGMENTS + seg;
            const y = baseY + lineDisplacements[smoothIdx];
            if (seg === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.shadowBlur = shadowBlur;
        ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.5)`;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.stroke();
        ctx.restore();
    }

    // ─── Shockwaves ───
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const wave = shockwaves[i];
        const age = 1 - wave.life;
        const radius = minDim * 0.05 + age * minDim * 0.44 * 0.92;
        const [wr, wg, wb] = hslToRgb(Math.max(0, wave.hue), 95, 62);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${Math.round(wr)},${Math.round(wg)},${Math.round(wb)},${wave.life * 0.42})`;
        ctx.lineWidth = 2 + wave.life * 5;
        ctx.shadowBlur = 28 * wave.life;
        ctx.shadowColor = `rgba(${Math.round(wr)},${Math.round(wg)},${Math.round(wb)},${wave.life * 0.55})`;
        ctx.stroke();
        ctx.restore();
    }

    // ─── Particles ───
    const particleHue = 215 - climaxLevel * 220;
    const innerRadius = minDim * 0.05;
    const maxRadius = minDim * 0.44;
    if (climaxLevel > 0.4 && Math.random() < climaxLevel * 0.6) {
        const a = Math.random() * Math.PI * 2;
        const d = innerRadius + Math.random() * maxRadius * 0.6;
        spawnParticles(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.ceil(climaxLevel * 6), particleHue, 2 + climaxLevel * 6);
    }
    if (Math.random() < 0.35 && globalIntensity > 0.08) {
        const a = Math.random() * Math.PI * 2;
        const d = innerRadius + Math.random() * maxRadius * 0.35;
        spawnParticles(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1, particleHue, 1 + globalIntensity * 3);
    }
    updateParticles(globalIntensity, ctx);

    // ─── Beat flash ───
    if (beatFlashAlpha > 0.005) {
        ctx.fillStyle = `rgba(255,255,255,${beatFlashAlpha * 0.25})`;
        ctx.fillRect(0, 0, W, H);
    }

    // ─── Vignette ───
    const vignetteGrad = ctx.createRadialGradient(cx, cy, minDim * 0.3, cx, cy, Math.max(W, H) * 0.9);
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(5,5,16,0.7)');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, W, H);
}
