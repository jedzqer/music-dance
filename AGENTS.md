# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

MusicDance is a desktop music player with real-time audio visualization. It runs as an Electron app or in a browser. The UI is entirely in Simplified Chinese.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server on port 5173 (browser-only mode) |
| `npm run build` | Vite production build to `dist/` |
| `npm run electron:dev` | Vite + Electron concurrently (desktop dev) |
| `npm run electron:build` | Build Electron installers to `release/` |

There are no tests, linting, or type-checking configured.

## Architecture

**Module system**: ES modules for renderer code (`src/`), CommonJS (`.cjs`) for Electron main/preload.

**Entry flow**: `index.html` → `src/app.js` (animation loop, resize, window controls) → imports `controls.js`, `renderer.js`, `glowlayer.js`.

**Key modules**:
- `src/controls.js` — All UI logic, audio loading, playlist rendering, lyrics, cover art. Contains the global `state` object and `els` DOM cache. Largest and most complex file.
- `src/renderer.js` — Canvas 2D visualization: background, radial frequency bars, membrane, shockwaves, particles, vignette.
- `src/glowlayer.js` — WebGL glow/bloom overlay with custom GLSL shader.
- `src/beatdetector.js` — Algorithmic beat detection from FFT data, drives shockwaves and particles.
- `src/lyrics.js` — Embedded lyrics extraction (ID3, FLAC, WAV) and LRC parsing.
- `src/media.js` — Album art extraction and dominant color palette computation.
- `src/playlist.js` — Playlist class (next/prev/shuffle, folder loading via IPC).
- `src/particles.js` — Particle system (max 250), spawned on beats.

**Electron layer**:
- `main.cjs` — Frameless BrowserWindow, IPC handlers for folder dialog, file scanning, settings persistence (`userData/settings.json`), window controls.
- `preload.cjs` — Exposes `electronAPI` via `contextBridge`. The renderer checks `window.electronAPI` to conditionally enable desktop features.

**Visualization pipeline** (per animation frame):
1. Read FFT frequency data from Web Audio `AnalyserNode`
2. `beatdetector.js` computes pulse/beats from bass frequencies
3. `renderer.js` draws Canvas 2D scene (bars, membrane, shockwaves, particles)
4. `glowlayer.js` composites WebGL glow overlay

## Conventions

- No framework — vanilla JS with direct DOM manipulation.
- Single mutable `state` object in `controls.js` holds all app state.
- CSS in `styles/main.css` (plain CSS, custom properties, no preprocessor).
- Audio format support: mp3, wav, ogg, flac, aac, mfa, wma, webm, opus.
- `src/shims/empty.js` stubs Node.js modules (`fs`, `path`, `stream`) so `jsmediatags` bundles for browser builds.
- User-facing strings are in Simplified Chinese.
- File `开发计划-纯笔记，禁止提交.md` is developer notes, not for commit.
