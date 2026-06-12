let prevBassAvg = 0;
let bassPulse = 0;
let beatEnergy = 0;
let rippleEnv = 0;
let lastBeatTime = -1;
let beatFlashAlpha = 0;
let bassFloor = 0;
const shockwaves = [];

export function detectBeat(bassAvg, t) {
    // 快起慢落：上升快保证灵敏度，下降平滑避免抖动闪烁
    const k = bassAvg > bassPulse ? 0.42 : 0.15;
    bassPulse += (bassAvg - bassPulse) * k;
    beatEnergy *= 0.86;

    // 自适应低音基线，跟随歌曲自身音量，避免低音弱的歌触发不了节拍
    bassFloor += (bassAvg - bassFloor) * 0.02;

    const hit = bassAvg > Math.max(0.12, bassFloor * 1.3) && bassAvg > prevBassAvg * 1.25 && t - lastBeatTime > 0.18;
    if (hit) {
        beatEnergy = 1;
        lastBeatTime = t;
        beatFlashAlpha = Math.max(beatFlashAlpha, 0.26);
    }
    rippleEnv += (beatEnergy - rippleEnv) * 0.18;
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

export function getRippleEnv() {
    return rippleEnv;
}

export function updateBeatFlash(climaxLevel) {
    // 白闪只在节拍命中瞬间触发（见 detectBeat），这里持续快速衰减回 0，
    // 故名"闪"——绝不在高潮期间常驻发白
    beatFlashAlpha += (0 - beatFlashAlpha) * 0.16;
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
    rippleEnv = 0;
    lastBeatTime = -1;
    beatFlashAlpha = 0;
    bassFloor = 0;
    shockwaves.length = 0;
}
