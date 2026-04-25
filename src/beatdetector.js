let prevBassAvg = 0;
let bassPulse = 0;
let beatEnergy = 0;
let lastBeatTime = -1;
let beatFlashAlpha = 0;
const shockwaves = [];

export function detectBeat(bassAvg, t) {
    bassPulse += (bassAvg - bassPulse) * 0.12;
    beatEnergy *= 0.86;

    const hit = bassAvg > 0.4 && bassAvg > prevBassAvg * 1.35 && t - lastBeatTime > 0.18;
    if (hit) {
        beatEnergy = 1;
        lastBeatTime = t;
        beatFlashAlpha = Math.max(beatFlashAlpha, 0.26);
    }
    prevBassAvg = prevBassAvg * 0.72 + bassAvg * 0.28;
    return hit;
}

export function addShockwave(hue) {
    shockwaves.push({ life: 1, hue });
}

export function updateShockwaves() {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        shockwaves[i].life -= 0.022;
        if (shockwaves[i].life <= 0) shockwaves.splice(i, 1);
    }
}

export function getShockwaves() {
    return shockwaves;
}

export function getBassPulse() {
    return bassPulse;
}

export function getBeatEnergy() {
    return beatEnergy;
}

export function updateBeatFlash(climaxLevel) {
    if (climaxLevel > 0.7) {
        beatFlashAlpha += ((climaxLevel - 0.6) * 0.5 - beatFlashAlpha) * 0.15;
    } else {
        beatFlashAlpha += (0 - beatFlashAlpha) * 0.08;
    }
    return beatFlashAlpha;
}

export function getLastBeatTime() {
    return lastBeatTime;
}

export function getBeatFlashAlpha() {
    return beatFlashAlpha;
}

export function resetBeatDetector() {
    prevBassAvg = 0;
    bassPulse = 0;
    beatEnergy = 0;
    lastBeatTime = -1;
    beatFlashAlpha = 0;
    shockwaves.length = 0;
}
