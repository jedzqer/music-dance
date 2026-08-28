/**
 * Visualizer SDK Host bridge and runtime manager.
 * The SDK contract is additive-only within major version 1.
 */

export const MUSIC_DANCE_SDK_VERSION = '1.0.0';
export const MUSIC_DANCE_FRAME_SCHEMA = 1;

export class VisualizerManager {
    constructor(options = {}) {
        this.container = options.container;
        this.onNativeUIChange = options.onNativeUIChange || (() => {});
        this.onControlsAction = options.onControlsAction || (() => {});
        
        this.iframe = null;
        this.currentVizId = 'radial';
        this.customVisualizers = []; // list of registered templates
        this.frameCallbacks = new Set();
        this.trackChangeCallbacks = new Set();
        this.lyricsCallbacks = new Set();
        this.stateCallbacks = new Set();
        
        this.currentTrack = null;
        this.currentLyrics = null;
        this.currentState = null;
        this._loadToken = null;
        this.visualizerNativeUI = null;

        this.nativeUIState = {
            controls: true,
            lyrics: true,
            progressBar: true,
            coverArt: true
        };

        this._setupHostListener();
    }

    _setupHostListener() {
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.type !== 'MUSIC_DANCE_BRIDGE') return;
            if (!this.iframe || event.source !== this.iframe.contentWindow) return;
            const { action, payload } = event.data;

            switch (action) {
                case 'SET_NATIVE_UI':
                    this.setNativeUI(payload && typeof payload === 'object' ? payload : {});
                    break;
                case 'CONTROLS_ACTION':
                    if (payload && typeof payload.method === 'string' && Array.isArray(payload.args)) {
                        this.onControlsAction(payload.method, payload.args);
                    }
                    break;
            }
        });
    }

    setNativeUI(uiConfig = {}) {
        this.nativeUIState = {
            controls: uiConfig.controls !== false,
            lyrics: uiConfig.lyrics !== false,
            progressBar: uiConfig.progressBar !== false,
            coverArt: uiConfig.coverArt !== false
        };
        this.onNativeUIChange(this.nativeUIState);
    }

    resetNativeUI() {
        this.setNativeUI({
            controls: true,
            lyrics: true,
            progressBar: true,
            coverArt: true
        });
    }

    applyVisualizerNativeUI() {
        if (this.visualizerNativeUI) {
            this.setNativeUI(this.visualizerNativeUI);
        } else {
            this.resetNativeUI();
        }
    }

    /**
     * Mounts and loads a visualizer by ID or raw HTML/URL
     */
    async loadVisualizer(vizItem) {
        if (!vizItem || !vizItem.id) vizItem = { id: 'radial' };
        this.currentVizId = vizItem.id;
        this.visualizerNativeUI = vizItem.nativeUI && typeof vizItem.nativeUI === 'object'
            ? { ...vizItem.nativeUI }
            : null;
        this.applyVisualizerNativeUI();

        if (vizItem.id === 'radial') {
            // Built-in canvas mode
            if (this.iframe) {
                this.iframe.style.display = 'none';
                this.iframe.src = 'about:blank';
            }
            return;
        }

        if (!this.iframe) {
            this.iframe = document.createElement('iframe');
            this.iframe.id = 'visualizer-sandbox';
            this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
            this.iframe.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                border: none;
                z-index: 1;
                background: transparent;
            `;
            this.container.appendChild(this.iframe);
        }

        this.iframe.style.display = 'block';

        return new Promise((resolve) => {
            const loadToken = Symbol('visualizer-load');
            this._loadToken = loadToken;
            this.iframe.onload = () => {
                if (this._loadToken !== loadToken) return resolve();
                try {
                    this._injectSDK(this.iframe.contentWindow);
                    // Existing preset pages may register after the SDK is available.
                    const FrameEvent = this.iframe.contentWindow.Event;
                    this.iframe.contentWindow.dispatchEvent(new FrameEvent('musicdance-ready'));
                    // Sync initial state
                    if (this.currentTrack) {
                        this.notifyTrackChange(this.currentTrack);
                    }
                    if (this.currentLyrics) {
                        this.notifyLyricsUpdate(this.currentLyrics);
                    }
                    if (this.currentState) {
                        this.notifyStateChange(this.currentState);
                    }
                } catch (e) {
                    console.warn('SDK injection error:', e);
                }
                resolve();
            };

            if (vizItem.entryUrl) {
                this.iframe.removeAttribute('srcdoc');
                this.iframe.src = vizItem.entryUrl;
            } else if (vizItem.htmlContent) {
                this.iframe.removeAttribute('src');
                this.iframe.srcdoc = vizItem.htmlContent;
            } else {
                this.iframe.style.display = 'none';
                resolve();
            }
        });
    }

    _injectSDK(targetWindow) {
        if (!targetWindow) return;

        const frameHandlers = [];
        const trackHandlers = [];
        const lyricsHandlers = [];
        const stateHandlers = [];

        const subscribe = (handlers, cb, replay) => {
            if (typeof cb !== 'function') return () => {};
            handlers.push(cb);
            if (replay !== undefined) {
                try { cb(replay); } catch (err) { console.warn('Visualizer SDK callback error:', err); }
            }
            return () => {
                const index = handlers.indexOf(cb);
                if (index >= 0) handlers.splice(index, 1);
            };
        };

        const capabilities = Object.freeze({
            frame: true,
            trackChange: true,
            lyricsUpdate: true,
            stateChange: true,
            controls: true,
            nativeUI: true,
            frameSchema: MUSIC_DANCE_FRAME_SCHEMA
        });

        targetWindow.$musicDance = {
            version: MUSIC_DANCE_SDK_VERSION,
            apiVersion: 1,
            capabilities,
            onFrame: (cb) => subscribe(frameHandlers, cb),
            onTrackChange: (cb) => subscribe(trackHandlers, cb, targetWindow.$musicDance._lastTrack),
            onLyricsUpdate: (cb) => subscribe(lyricsHandlers, cb, targetWindow.$musicDance._lastLyrics),
            onStateChange: (cb) => subscribe(stateHandlers, cb, targetWindow.$musicDance._lastState),
            controls: {
                play: () => targetWindow.$musicDance._sendAction('play'),
                pause: () => targetWindow.$musicDance._sendAction('pause'),
                togglePlay: () => targetWindow.$musicDance._sendAction('togglePlay'),
                next: () => targetWindow.$musicDance._sendAction('next'),
                prev: () => targetWindow.$musicDance._sendAction('prev'),
                seek: (time) => targetWindow.$musicDance._sendAction('seek', [time]),
                setVolume: (vol) => targetWindow.$musicDance._sendAction('setVolume', [vol])
            },
            ui: {
                setNativeUI: (cfg) => {
                    if (this.iframe?.contentWindow !== targetWindow) return;
                    this.visualizerNativeUI = cfg && typeof cfg === 'object' ? { ...cfg } : {};
                    this.applyVisualizerNativeUI();
                }
            },
            _sendAction: (method, args = []) => {
                if (this.iframe?.contentWindow !== targetWindow) return;
                this.onControlsAction(method, args);
            }
        };

        // Cache dispatchers on window
        targetWindow.__mdDispatchFrame = (frameData) => {
            for (let i = 0; i < frameHandlers.length; i++) {
                try { frameHandlers[i](frameData); } catch (err) {
                    console.warn('Visualizer frame callback error:', err);
                }
            }
        };
        targetWindow.__mdDispatchTrack = (trackData) => {
            targetWindow.$musicDance._lastTrack = trackData;
            for (let i = 0; i < trackHandlers.length; i++) {
                try { trackHandlers[i](trackData); } catch (err) {
                    console.warn('Visualizer track callback error:', err);
                }
            }
        };
        targetWindow.__mdDispatchLyrics = (lyricsData) => {
            targetWindow.$musicDance._lastLyrics = lyricsData;
            for (let i = 0; i < lyricsHandlers.length; i++) {
                try { lyricsHandlers[i](lyricsData); } catch (err) {
                    console.warn('Visualizer lyrics callback error:', err);
                }
            }
        };
        targetWindow.__mdDispatchState = (stateData) => {
            targetWindow.$musicDance._lastState = stateData;
            for (let i = 0; i < stateHandlers.length; i++) {
                try { stateHandlers[i](stateData); } catch (err) {
                    console.warn('Visualizer state callback error:', err);
                }
            }
        };
    }

    notifyFrame(frameData) {
        try {
            const dispatch = this.iframe?.contentWindow?.__mdDispatchFrame;
            if (typeof dispatch === 'function') dispatch(frameData);
        } catch (_) {}
    }

    notifyTrackChange(trackData) {
        this.currentTrack = trackData;
        try {
            const dispatch = this.iframe?.contentWindow?.__mdDispatchTrack;
            if (typeof dispatch === 'function') dispatch(trackData);
        } catch (_) {}
    }

    notifyLyricsUpdate(lyricsData) {
        this.currentLyrics = lyricsData;
        try {
            const dispatch = this.iframe?.contentWindow?.__mdDispatchLyrics;
            if (typeof dispatch === 'function') dispatch(lyricsData);
        } catch (_) {}
    }

    notifyStateChange(stateData) {
        this.currentState = stateData;
        try {
            const dispatch = this.iframe?.contentWindow?.__mdDispatchState;
            if (typeof dispatch === 'function') dispatch(stateData);
        } catch (_) {}
    }
}
