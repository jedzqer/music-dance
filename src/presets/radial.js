// Radial visualizer logic adapted for standalone execution
export function createRadialVisualizer() {
    let avgVolume = 0;
    let climaxLevel = 0;
    let glowEnv = 0;
    let shockwaves = [];
    let particles = [];
    let lastBeatTime = 0;
    let beatHistory = [];
    let bassPulse = 0;
    let beatEnergy = 0;
    let rippleEnv = 0;
    let beatFlashAlpha = 0;

    const NUM_LINES = 75;

    function hslToRgb(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s /= 100;
        l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
    }

    function colorWithLightness(rgbStr, targetL, boostSat = 1.0) {
        const match = (rgbStr || '').match(/\d+/g);
        if (!match || match.length < 3) return [200, 200, 255];
        let [r, g, b] = match.slice(0, 3).map(Number);
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        s = Math.min(1, s * boostSat);
        l = targetL / 100;
        return hslToRgb(h * 360, s * 100, l * 100);
    }

    function detectBeat(bassAvg, t) {
        const now = t;
        beatHistory.push({ time: now, val: bassAvg });
        while (beatHistory.length > 0 && now - beatHistory[0].time > 1.2) {
            beatHistory.shift();
        }
        let histAvg = 0;
        for (let i = 0; i < beatHistory.length; i++) histAvg += beatHistory[i].val;
        histAvg /= Math.max(1, beatHistory.length);

        const threshold = Math.max(0.12, histAvg * 1.35);
        const cooldown = 0.22;
        const isBeat = bassAvg > threshold && (now - lastBeatTime) > cooldown && bassAvg > 0.18;

        if (isBeat) {
            lastBeatTime = now;
            bassPulse = 1.0;
            beatEnergy = Math.min(1.0, beatEnergy + (bassAvg - threshold) * 3.0);
            rippleEnv = Math.min(1.0, rippleEnv + 0.6);
        } else {
            bassPulse *= 0.88;
            beatEnergy *= 0.94;
            rippleEnv *= 0.96;
        }
        return isBeat;
    }

    function addShockwave(hue) {
        shockwaves.push({
            progress: 0,
            maxRadius: 300,
            hue: hue,
            alpha: 0.8
        });
    }

    function spawnParticles(cx, cy, count, hue, speed) {
        for (let i = 0; i < count; i++) {
            if (particles.length >= 250) break;
            const angle = Math.random() * Math.PI * 2;
            const spd = (0.5 + Math.random() * 0.8) * speed;
            particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                life: 1.0,
                decay: 0.01 + Math.random() * 0.02,
                size: 2 + Math.random() * 3,
                hue: hue + (Math.random() - 0.5) * 30
            });
        }
    }

    function updateParticles(ctx) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            const [r, g, b] = hslToRgb(p.hue, 80, 60);
            ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${p.life * 0.8})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function updateShockwaves(ctx, cx, cy) {
        for (let i = shockwaves.length - 1; i >= 0; i--) {
            const sw = shockwaves[i];
            sw.progress += 0.025;
            if (sw.progress >= 1) {
                shockwaves.splice(i, 1);
                continue;
            }
            const radius = sw.progress * sw.maxRadius;
            const alpha = (1 - sw.progress) * sw.alpha;
            const [r, g, b] = hslToRgb(sw.hue, 80, 60);
            ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
            ctx.lineWidth = 3 * (1 - sw.progress);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    return {
        draw(ctx, W, H, cx, cy, frequencyData, coverPalette, t) {
            const maxRadius = Math.min(W, H) * 0.44;
            const innerRadius = Math.min(W, H) * 0.05;

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

                climaxTarget = Math.max(0, Math.min(1, (curVol - 0.30) * 2.5));
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

            const energyTarget = avgVolume * 0.7 + climaxLevel * 0.3;
            const glowK = energyTarget > glowEnv ? 0.035 : 0.018;
            glowEnv += (energyTarget - glowEnv) * glowK;

            const globalIntensity = Math.min(1, intensity * 2.2 + 0.08);
            const baseTrail = 0.12 - climaxLevel * 0.03;
            const bgHue = 218 - climaxLevel * 120 + Math.sin(t * 0.08) * 18;
            const bgPulse = 0.5 + Math.sin(t * 0.32) * 0.5;
            const [bgR, bgG, bgB] = hslToRgb(Math.max(0, bgHue), 76, 7 + bgPulse * 3 + globalIntensity * 5);

            ctx.fillStyle = `rgba(${Math.round(bgR)},${Math.round(bgG)},${Math.round(bgB)},${Math.max(0.045, baseTrail)})`;
            ctx.fillRect(0, 0, W, H);

            // Ambient background glow circle
            const glowRadius = maxRadius * (0.8 + glowEnv * 0.5);
            const glowGrad = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, glowRadius);
            const [haloR, haloG, haloB] = coverPalette
                ? colorWithLightness(coverPalette.colors[0], 46, 1.45)
                : hslToRgb(Math.max(0, bgHue - 18), 95, 50);
            glowGrad.addColorStop(0, `rgba(${Math.round(haloR)},${Math.round(haloG)},${Math.round(haloB)},${0.18 + glowEnv * 0.2})`);
            glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Radial bars
            const step = (Math.PI * 2) / NUM_LINES;
            for (let i = 0; i < NUM_LINES; i++) {
                const angle = i * step - Math.PI / 2;
                const freqIdx = Math.floor((i / NUM_LINES) * ((frequencyData ? frequencyData.length : 128) * 0.65));
                const val = frequencyData ? (frequencyData[freqIdx] || 0) / 255 : 0;
                const barLen = val * (maxRadius - innerRadius);

                const x1 = cx + Math.cos(angle) * innerRadius;
                const y1 = cy + Math.sin(angle) * innerRadius;
                const x2 = cx + Math.cos(angle) * (innerRadius + barLen);
                const y2 = cy + Math.sin(angle) * (innerRadius + barLen);

                const barHue = (bgHue + i * 2 + val * 60) % 360;
                const [r, g, b] = hslToRgb(barHue, 85, 55 + val * 25);
                ctx.strokeStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${0.4 + val * 0.6})`;
                ctx.lineWidth = Math.max(2, (W / 1200) * 3.5);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            // Inner membrane
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 + bassPulse * 0.5})`;
            ctx.lineWidth = 2 + bassPulse * 3;
            ctx.beginPath();
            ctx.arc(cx, cy, innerRadius + bassPulse * 8, 0, Math.PI * 2);
            ctx.stroke();

            updateShockwaves(ctx, cx, cy);
            updateParticles(ctx);
        },
        reset() {
            avgVolume = 0;
            climaxLevel = 0;
            glowEnv = 0;
            shockwaves = [];
            particles = [];
            beatHistory = [];
        }
    };
}
