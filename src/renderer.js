import { hslToRgb, colorWithLightness } from './utils.js';
import { spawnParticles, updateParticles } from './particles.js';
import {
    detectBeat, addShockwave, updateShockwaves, getShockwaves,
    getBassPulse, getBeatEnergy, getLastBeatTime, updateBeatFlash, getBeatFlashAlpha
} from './beatdetector.js';
import { renderGlowLayer } from './glowlayer.js';

const FFT_SIZE = 1024;
export const NUM_LINES = 160;

let avgVolume = 0;
let climaxLevel = 0;

export function resetRenderer() {
    avgVolume = 0;
    climaxLevel = 0;
}

export function getClimaxLevel() {
    return climaxLevel;
}

export function getFFTSize() {
    return FFT_SIZE;
}

export function addGaussianGlowStops(gradient, r, g, b, alpha) {
    for (let i = 0; i <= 12; i++) {
        const p = i / 12;
        const a = alpha * Math.exp(-p * p * 4.2);
        gradient.addColorStop(p, `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`);
    }
}

export function draw(ctx, W, H, cx, cy, frequencyData, coverPalette, t) {
    const maxRadius = Math.min(W, H) * 0.44;
    const innerRadius = Math.min(W, H) * 0.05;
    const visualLimitRadius = maxRadius * 0.94;

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

    const baseTrail = 0.1 - climaxLevel * 0.03;
    const bgHue = 218 - climaxLevel * 120 + Math.sin(t * 0.08) * 18;
    const bgPulse = 0.5 + Math.sin(t * 0.32) * 0.5;
    const [bgR, bgG, bgB] = hslToRgb(Math.max(0, bgHue), 76, 7 + bgPulse * 3 + globalIntensity * 5);
    ctx.fillStyle = `rgba(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)},${Math.max(0.045, baseTrail)})`;
    ctx.fillRect(0, 0, W, H);

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

    const coreR = innerRadius + bassPulse * maxRadius * 0.35 + climaxLevel * 25 + beatEnergy * 34 + Math.sin(t * 3) * 3 * bassPulse;
    const coreHue = 210 - bassPulse * 210 - climaxLevel * 30;
    const [cr, cg, cb] = hslToRgb(Math.max(0, coreHue), 95, 62);

    ctx.save();
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.5);
    coreGrad.addColorStop(0, `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${0.75 + climaxLevel * 0.25})`);
    coreGrad.addColorStop(0.35, `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${0.35 + climaxLevel * 0.2})`);
    coreGrad.addColorStop(0.7, `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},0.04)`);
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = `rgba(255,255,255,${0.45 + bassPulse * 0.55 + climaxLevel * 0.3})`;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 0.18 + 2, 0, Math.PI * 2);
    ctx.fill();

    const membranePoints = 132;
    const membraneBase = coreR * (1.45 + beatEnergy * 0.2) + maxRadius * (0.08 + bassPulse * 0.18);
    const freqBins = frequencyData ? frequencyData.length : 0;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= membranePoints; i++) {
        const p = i % membranePoints;
        const angle = (p / membranePoints) * Math.PI * 2;
        let midShape = 0;
        let highDetail = 0;

        if (freqBins > 0) {
            const midStart = Math.floor(freqBins * 0.14);
            const midEnd = Math.floor(freqBins * 0.58);
            const highStart = Math.floor(freqBins * 0.58);
            const midSpan = Math.max(1, midEnd - midStart);
            const highSpan = Math.max(1, freqBins - highStart);
            const midBin = midStart + Math.floor((p / membranePoints) * midSpan);
            const highBin = highStart + Math.floor(((p * 2.7) % membranePoints) / membranePoints * highSpan);
            const midPrev = frequencyData[Math.max(midStart, midBin - 2)] / 255;
            const midCur = frequencyData[Math.min(midEnd - 1, midBin)] / 255;
            const midNext = frequencyData[Math.min(midEnd - 1, midBin + 2)] / 255;
            const highCur = frequencyData[Math.min(freqBins - 1, highBin)] / 255;

            midShape = (midPrev * 0.25 + midCur * 0.5 + midNext * 0.25) * maxRadius * (0.11 + climaxLevel * 0.09);
            highDetail = highCur * maxRadius * (0.018 + climaxLevel * 0.028);
        }

        const slowFlow = Math.sin(angle * 4 + t * 0.55) * (3 + bassPulse * 8);
        const contour = Math.sin(angle * 2 - t * 0.32) * midShape * 0.35;
        const sparkle = Math.sin(angle * 23 + t * 0.9) * highDetail;
        const beatRipple = Math.sin(angle * 11 + lastBeatTime * 5) * beatEnergy * 14;
        const r = Math.min(visualLimitRadius, membraneBase + midShape + contour + sparkle + slowFlow + beatRipple);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const membraneGrad = ctx.createRadialGradient(cx, cy, coreR * 0.7, cx, cy, membraneBase * 1.35);
    membraneGrad.addColorStop(0, `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},0.02)`);
    membraneGrad.addColorStop(0.68, `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${0.08 + bassPulse * 0.16 + beatEnergy * 0.12})`);
    membraneGrad.addColorStop(1, 'rgba(250,112,154,0)');
    ctx.fillStyle = membraneGrad;
    ctx.fill();
    ctx.strokeStyle = `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},${0.2 + bassPulse * 0.45 + beatEnergy * 0.35})`;
    ctx.lineWidth = 1.2 + bassPulse * 3 + beatEnergy * 2.2;
    ctx.shadowBlur = 18 + bassPulse * 40 + beatEnergy * 28;
    ctx.shadowColor = `rgba(${Math.round(cr)},${Math.round(cg)},${Math.round(cb)},0.55)`;
    ctx.stroke();
    ctx.restore();

    for (let i = shockwaves.length - 1; i >= 0; i--) {
        const wave = shockwaves[i];
        const age = 1 - wave.life;
        const radius = coreR + age * maxRadius * 0.92;
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

    for (let ring = 1; ring <= 3; ring++) {
        const ringR = maxRadius * (0.3 + ring * 0.22);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.015 + climaxLevel * 0.04})`;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([4 + ring * 3, 12 + ring * 6]);
        ctx.lineDashOffset = t * 20 * (ring % 2 === 0 ? 1 : -1);
        ctx.stroke();
        ctx.restore();
    }

    if (frequencyData && frequencyData.length > 0) {
        const bins = frequencyData.length;
        const binStep = bins / NUM_LINES;

        for (let i = 0; i < NUM_LINES; i++) {
            const bi = Math.floor(i * binStep);
            const rawVal = frequencyData[Math.min(bi, bins - 1)] / 255;

            let smoothVal = rawVal;
            if (i > 0 && i < NUM_LINES - 1) {
                const p = frequencyData[Math.floor((i - 1) * binStep)] / 255;
                const n = frequencyData[Math.floor((i + 1) * binStep)] / 255;
                smoothVal = p * 0.15 + rawVal * 0.7 + n * 0.15;
            }

            const amplitude = Math.max(0.01, smoothVal);
            const angle = (i / NUM_LINES) * Math.PI * 2 - Math.PI / 2;

            const baseLen = maxRadius * 0.06;
            const extraLen = amplitude * maxRadius * (0.55 + climaxLevel * 0.5 + globalIntensity * 0.4);
            const lineLen = baseLen + extraLen;
            const startR = innerRadius + climaxLevel * 18 + bassPulse * 12;
            const endR = startR + lineLen;

            const hue = 215 - (amplitude + climaxLevel * 0.55) * 215;
            const sat = 82 + climaxLevel * 18;
            const light = 42 + amplitude * 35 + climaxLevel * 28;
            const [r, g, b] = hslToRgb(Math.max(0, hue), Math.min(100, sat), Math.min(95, light));

            const sx = cx + Math.cos(angle) * startR;
            const sy = cy + Math.sin(angle) * startR;
            const ex = cx + Math.cos(angle) * endR;
            const ey = cy + Math.sin(angle) * endR;

            const isTop = sy < cy;

            ctx.save();
            ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.72)`;
            ctx.lineWidth = 0.8 + amplitude * 2.2 + climaxLevel * 2.5;
            ctx.shadowBlur = 6 + climaxLevel * 18 + amplitude * 8;
            ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${0.35 + climaxLevel * 0.45})`;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.restore();

            if (isTop && endR > startR + 3 && amplitude > 0.04) {
                const reflStartR = startR * 0.5;
                const reflEndR = reflStartR + (endR - startR) * 0.4 * (1 + climaxLevel * 0.6);
                if (reflEndR > reflStartR) {
                    const rsx = cx + Math.cos(angle) * reflStartR;
                    const rsy = cy + Math.sin(angle) * reflStartR;
                    const rex = cx + Math.cos(angle) * reflEndR;
                    const rey = cy + Math.sin(angle) * reflEndR;
                    const mirrorSx = rsx;
                    const mirrorSy = cy + (cy - rsy);
                    const mirrorEx = rex;
                    const mirrorEy = cy + (cy - rey);

                    ctx.save();
                    ctx.globalAlpha = 0.16 + climaxLevel * 0.15;
                    ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.6)`;
                    ctx.lineWidth = 0.5 + amplitude * 1.2;
                    ctx.shadowBlur = 3 + climaxLevel * 8;
                    ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.2)`;
                    ctx.beginPath();
                    ctx.moveTo(mirrorSx, mirrorSy);
                    ctx.lineTo(mirrorEx, mirrorEy);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        for (let i = 0; i < NUM_LINES; i += 8) {
            const bi = Math.floor(i * binStep);
            const rawVal = frequencyData[Math.min(bi, bins - 1)] / 255;
            if (rawVal < 0.25) continue;
            const angle = (i / NUM_LINES) * Math.PI * 2 - Math.PI / 2;
            const startR2 = innerRadius + climaxLevel * 18 + bassPulse * 12;
            const endR2 = startR2 + rawVal * maxRadius * (0.3 + climaxLevel * 0.4);
            const sx2 = cx + Math.cos(angle) * startR2;
            const sy2 = cy + Math.sin(angle) * startR2;
            const ex2 = cx + Math.cos(angle) * endR2;
            const ey2 = cy + Math.sin(angle) * endR2;
            const hue2 = 215 - (rawVal + climaxLevel * 0.6) * 215;
            const [hr, hg, hb] = hslToRgb(Math.max(0, hue2), 95, 58 + climaxLevel * 20);

            ctx.save();
            ctx.strokeStyle = `rgba(${Math.round(hr)},${Math.round(hg)},${Math.round(hb)},${0.55 + climaxLevel * 0.35})`;
            ctx.lineWidth = 1.2 + rawVal * 2.5;
            ctx.shadowBlur = 14 + climaxLevel * 28;
            ctx.shadowColor = `rgba(${Math.round(hr)},${Math.round(hg)},${Math.round(hb)},${0.55 + climaxLevel * 0.35})`;
            ctx.beginPath();
            ctx.moveTo(sx2, sy2);
            ctx.lineTo(ex2, ey2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${0.04 + climaxLevel * 0.12 + globalIntensity * 0.08})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 12 + climaxLevel * 25;
        ctx.shadowColor = `rgba(140,210,255,${0.2 + climaxLevel * 0.45})`;
        ctx.beginPath();
        for (let i = 0; i <= NUM_LINES; i++) {
            const ii = i % NUM_LINES;
            const bi = Math.floor(ii * binStep);
            const val = frequencyData[Math.min(bi, bins - 1)] / 255;
            const angle = (ii / NUM_LINES) * Math.PI * 2 - Math.PI / 2;
            const rDist = maxRadius + val * maxRadius * 0.12 + climaxLevel * 8;
            const px = cx + Math.cos(angle) * rDist;
            const py = cy + Math.sin(angle) * rDist;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    const particleHue = 215 - climaxLevel * 220;
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

    if (beatFlashAlpha > 0.005) {
        ctx.fillStyle = `rgba(255,255,255,${beatFlashAlpha * 0.25})`;
        ctx.fillRect(0, 0, W, H);
    }

    const vignetteGrad = ctx.createRadialGradient(cx, cy, maxRadius * 0.7, cx, cy, Math.max(W, H) * 0.9);
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(5,5,16,0.7)');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, W, H);
}
