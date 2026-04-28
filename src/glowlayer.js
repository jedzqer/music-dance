let canvas, gl;
let program;
let aPosition = -1;
let uResolution = null;
let uPosA = null;
let uColorA = null;
let uIntensityA = null;
let uSigmaA = null;
let uPosB = null;
let uColorB = null;
let uIntensityB = null;
let uSigmaB = null;

const VERT = `#version 100
attribute vec2 aPosition;
void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG = `#version 100
precision highp float;
uniform vec2 uResolution;
uniform vec2 uPosA;
uniform vec3 uColorA;
uniform float uIntensityA;
uniform float uSigmaA;
uniform vec2 uPosB;
uniform vec3 uColorB;
uniform float uIntensityB;
uniform float uSigmaB;

void main() {
    float maxDim = max(uResolution.x, uResolution.y);
    float dA = distance(gl_FragCoord.xy, uPosA) / maxDim;
    float aA = uIntensityA * exp(-dA * dA / (2.0 * uSigmaA * uSigmaA));
    float dB = distance(gl_FragCoord.xy, uPosB) / maxDim;
    float aB = uIntensityB * exp(-dB * dB / (2.0 * uSigmaB * uSigmaB));
    float alpha = aA + aB - aA * aB;
    vec3 color = vec3(0.0);
    if (alpha > 0.0001) {
        color = (uColorB * aB + uColorA * aA * (1.0 - aB)) / alpha;
    }
    gl_FragColor = vec4(color, alpha);
}`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

export function initGlowLayer() {
    canvas = document.createElement('canvas');
    canvas.id = 'glow-layer';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;';
    document.body.appendChild(canvas);

    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
        || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false });

    if (!gl) {
        canvas.remove();
        canvas = null;
        console.warn('WebGL not available, glow layer disabled');
        return false;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
        canvas.remove();
        canvas = null;
        gl = null;
        return false;
    }

    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Link error:', gl.getProgramInfoLog(program));
        canvas.remove();
        canvas = null;
        gl = null;
        return false;
    }

    gl.useProgram(program);

    uResolution = gl.getUniformLocation(program, 'uResolution');
    uPosA = gl.getUniformLocation(program, 'uPosA');
    uColorA = gl.getUniformLocation(program, 'uColorA');
    uIntensityA = gl.getUniformLocation(program, 'uIntensityA');
    uSigmaA = gl.getUniformLocation(program, 'uSigmaA');
    uPosB = gl.getUniformLocation(program, 'uPosB');
    uColorB = gl.getUniformLocation(program, 'uColorB');
    uIntensityB = gl.getUniformLocation(program, 'uIntensityB');
    uSigmaB = gl.getUniformLocation(program, 'uSigmaB');

    aPosition = gl.getAttribLocation(program, 'aPosition');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    return true;
}

export function resizeGlowLayer(W, H) {
    if (!gl) return;
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
}

export function renderGlowLayer(W, H, xA, yA, rA, gA, bA, intA, sigA, xB, yB, rB, gB, bB, intB, sigB) {
    if (!gl) return;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(uResolution, W, H);
    gl.uniform2f(uPosA, xA, H - yA);
    gl.uniform3f(uColorA, rA, gA, bA);
    gl.uniform1f(uIntensityA, intA);
    gl.uniform1f(uSigmaA, sigA);
    gl.uniform2f(uPosB, xB, H - yB);
    gl.uniform3f(uColorB, rB, gB, bB);
    gl.uniform1f(uIntensityB, intB);
    gl.uniform1f(uSigmaB, sigB);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
