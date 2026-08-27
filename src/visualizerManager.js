/**
 * Visualizer SDK Host bridge and runtime manager.
 * Injects the `$musicDance` communication API into the visualizer iframe.
 */

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
            const { action, payload } = event.data;

            switch (action) {
                case 'SET_NATIVE_UI':
                    this.setNativeUI(payload);
                    break;
                case 'CONTROLS_ACTION':
                    this.onControlsAction(payload.method, payload.args);
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

    /**
     * Mounts and loads a visualizer by ID or raw HTML/URL
     */
    async loadVisualizer(vizItem) {
        this.currentVizId = vizItem.id;
        this.resetNativeUI();

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
            this.iframe.onload = () => {
                try {
                    this._injectSDK(this.iframe.contentWindow);
                    // Sync initial state
                    if (this.currentTrack) {
                        this.notifyTrackChange(this.currentTrack);
                    }
                    if (this.currentLyrics) {
                        this.notifyLyricsUpdate(this.currentLyrics);
                    }
                } catch (e) {
                    console.warn('SDK injection error:', e);
                }
                resolve();
            };

            if (vizItem.entryUrl) {
                this.iframe.src = vizItem.entryUrl;
            } else if (vizItem.htmlContent) {
                this.iframe.srcdoc = vizItem.htmlContent;
            }
        });
    }

    _injectSDK(targetWindow) {
        if (!targetWindow) return;

        const frameHandlers = [];
        const trackHandlers = [];
        const lyricsHandlers = [];
        const stateHandlers = [];

        targetWindow.$musicDance = {
            onFrame(cb) {
                if (typeof cb === 'function') frameHandlers.push(cb);
            },
            onTrackChange(cb) {
                if (typeof cb === 'function') {
                    trackHandlers.push(cb);
                    if (this._lastTrack) cb(this._lastTrack);
                }
            },
            onLyricsUpdate(cb) {
                if (typeof cb === 'function') {
                    lyricsHandlers.push(cb);
                    if (this._lastLyrics) cb(this._lastLyrics);
                }
            },
            onStateChange(cb) {
                if (typeof cb === 'function') stateHandlers.push(cb);
            },
            controls: {
                play: () => this._sendAction('play'),
                pause: () => this._sendAction('pause'),
                togglePlay: () => this._sendAction('togglePlay'),
                next: () => this._sendAction('next'),
                prev: () => this._sendAction('prev'),
                seek: (time) => this._sendAction('seek', [time]),
                setVolume: (vol) => this._sendAction('setVolume', [vol])
            },
            ui: {
                setNativeUI: (cfg) => {
                    window.postMessage({
                        type: 'MUSIC_DANCE_BRIDGE',
                        action: 'SET_NATIVE_UI',
                        payload: cfg
                    }, '*');
                }
            },
            _sendAction: (method, args = []) => {
                window.postMessage({
                    type: 'MUSIC_DANCE_BRIDGE',
                    action: 'CONTROLS_ACTION',
                    payload: { method, args }
                }, '*');
            }
        };

        // Cache dispatchers on window
        targetWindow.__mdDispatchFrame = (frameData) => {
            for (let i = 0; i < frameHandlers.length; i++) {
                frameHandlers[i](frameData);
            }
        };
        targetWindow.__mdDispatchTrack = (trackData) => {
            targetWindow.$musicDance._lastTrack = trackData;
            for (let i = 0; i < trackHandlers.length; i++) {
                trackHandlers[i](trackData);
            }
        };
        targetWindow.__mdDispatchLyrics = (lyricsData) => {
            targetWindow.$musicDance._lastLyrics = lyricsData;
            for (let i = 0; i < lyricsHandlers.length; i++) {
                lyricsHandlers[i](lyricsData);
            }
        };
        targetWindow.__mdDispatchState = (stateData) => {
            for (let i = 0; i < stateHandlers.length; i++) {
                stateHandlers[i](stateData);
            }
        };
    }

    notifyFrame(frameData) {
        if (this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.__mdDispatchFrame) {
            try {
                this.iframe.contentWindow.__mdDispatchFrame(frameData);
            } catch (err) {
                // Ignore transient frame dispatch issues during iframe reload
            }
        }
    }

    notifyTrackChange(trackData) {
        this.currentTrack = trackData;
        if (this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.__mdDispatchTrack) {
            try {
                this.iframe.contentWindow.__mdDispatchTrack(trackData);
            } catch (_) {}
        }
    }

    notifyLyricsUpdate(lyricsData) {
        this.currentLyrics = lyricsData;
        if (this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.__mdDispatchLyrics) {
            try {
                this.iframe.contentWindow.__mdDispatchLyrics(lyricsData);
            } catch (_) {}
        }
    }

    notifyStateChange(stateData) {
        this.currentState = stateData;
        if (this.iframe && this.iframe.contentWindow && this.iframe.contentWindow.__mdDispatchState) {
            try {
                this.iframe.contentWindow.__mdDispatchState(stateData);
            } catch (_) {}
        }
    }
}
