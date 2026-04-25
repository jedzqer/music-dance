import { extractRiffChunk } from './riff.js';

export function parseLyrics(raw) {
    if (raw && typeof raw === 'object') raw = raw.lyrics || raw.text || raw.description || raw.data || String(raw);
    if (!raw || typeof raw !== 'string') return null;
    const lines = raw.split(/\r?\n/);
    const result = [];
    const lrcRe = /^\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)/;
    let isLRC = false;

    for (const line of lines) {
        const m = line.match(lrcRe);
        if (m) {
            isLRC = true;
            const min = parseInt(m[1], 10);
            const sec = parseInt(m[2], 10);
            const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
            const time = min * 60 + sec + ms / 1000;
            const text = m[4].trim();
            if (text) result.push({ time, text });
        } else {
            const text = line.trim();
            if (text && !text.startsWith('[ti:') && !text.startsWith('[ar:') &&
                !text.startsWith('[al:') && !text.startsWith('[by:') &&
                !text.startsWith('[offset:') && !text.startsWith('[re:') &&
                !text.startsWith('[ve:')) {
                result.push({ time: -1, text });
            }
        }
    }
    if (result.length === 0) return null;
    if (isLRC) result.sort((a, b) => a.time - b.time);
    return { isLRC, lines: result };
}

export async function readEmbeddedLyrics(file) {
    const rawFromTags = await readLyricsFromTags(file);
    if (rawFromTags) return rawFromTags;

    const rawFromFlac = await extractFlacLyrics(file);
    if (rawFromFlac) return rawFromFlac;

    return extractWavId3Lyrics(file);
}

function readLyricsFromTags(file) {
    return new Promise((resolve) => {
        try {
            window.jsmediatags.read(file, {
                onSuccess: (tag) => {
                    let raw = null;
                    if (tag.tags && tag.tags.lyrics) {
                        raw = normalizeRawLyrics(tag.tags.lyrics);
                    }
                    if (!raw && tag.tags) {
                        const uslt = tag.tags.USLT;
                        if (uslt) raw = normalizeRawLyrics(uslt);
                    }
                    resolve(raw);
                },
                onError: () => resolve(null)
            });
        } catch (_) {
            resolve(null);
        }
    });
}

function normalizeRawLyrics(raw) {
    if (!raw || typeof raw === 'string') return raw;
    return raw.lyrics || raw.text || raw.description || raw.data || String(raw);
}

async function extractFlacLyrics(file) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (header[0] !== 0x66 || header[1] !== 0x4c || header[2] !== 0x61 || header[3] !== 0x43) return null;

    let offset = 4;
    const decoder = new TextDecoder('utf-8');
    while (offset + 4 <= file.size) {
        const blockHeader = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
        const isLast = (blockHeader[0] & 0x80) !== 0;
        const blockType = blockHeader[0] & 0x7f;
        const blockLength = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];
        offset += 4;

        if (blockType === 4) {
            const data = new Uint8Array(await file.slice(offset, offset + blockLength).arrayBuffer());
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            let pos = 0;
            const readString = () => {
                if (pos + 4 > data.length) return null;
                const len = view.getUint32(pos, true);
                pos += 4;
                if (pos + len > data.length) return null;
                const text = decoder.decode(data.slice(pos, pos + len));
                pos += len;
                return text;
            };

            readString();
            if (pos + 4 > data.length) return null;
            const count = view.getUint32(pos, true);
            pos += 4;

            for (let i = 0; i < count; i++) {
                const comment = readString();
                if (!comment) continue;
                const eq = comment.indexOf('=');
                if (eq === -1) continue;
                const key = comment.slice(0, eq).toUpperCase();
                if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'SYNCEDLYRICS') {
                    return comment.slice(eq + 1);
                }
            }
            return null;
        }

        offset += blockLength;
        if (isLast) break;
    }
    return null;
}

async function extractWavId3Lyrics(file) {
    const data = await extractRiffChunk(file, ['ID3 ']);
    if (!data || chunkId(data, 0, 3) !== 'ID3') return null;
    return await readLyricsFromTags(new File([data], `${file.name}.id3`, { type: 'audio/mpeg' })) || parseId3Lyrics(data);
}

function parseId3Lyrics(data) {
    const version = data[3];
    const tagSize = readSyncSafeInt(data, 6);
    let pos = 10;
    const end = Math.min(data.length, 10 + tagSize);

    while (pos + 10 <= end) {
        const frameId = chunkId(data, pos, 4);
        if (/^\x00+$/.test(frameId)) break;

        const frameSize = version === 4 ? readSyncSafeInt(data, pos + 4) : readInt32(data, pos + 4);
        const frameStart = pos + 10;
        const frameEnd = frameStart + frameSize;
        if (frameSize <= 0 || frameEnd > end) break;

        const frame = data.slice(frameStart, frameEnd);
        const text = frameId === 'USLT' ? decodeUsltFrame(frame) : frameId === 'TXXX' ? decodeTxxxFrame(frame) : null;
        if (text && parseLyrics(text)) return text;

        pos = frameEnd;
    }
    return null;
}

function decodeUsltFrame(frame) {
    if (frame.length < 5) return null;
    const textStart = findTextAfterTerminator(frame, 4, frame[0]);
    if (textStart < 0) return decodeId3Text(frame.slice(4), frame[0]);
    return decodeId3Text(frame.slice(textStart), frame[0]);
}

function decodeTxxxFrame(frame) {
    if (frame.length < 2) return null;
    const valueStart = findTextAfterTerminator(frame, 1, frame[0]);
    if (valueStart < 0) return null;
    return decodeId3Text(frame.slice(valueStart), frame[0]);
}

function findTextAfterTerminator(frame, pos, encoding) {
    const step = encoding === 1 || encoding === 2 ? 2 : 1;
    for (let i = pos; i + step <= frame.length; i += step) {
        if (step === 2 ? frame[i] === 0 && frame[i + 1] === 0 : frame[i] === 0) return i + step;
    }
    return -1;
}

function decodeId3Text(bytes, encoding) {
    if (!bytes.length) return null;
    if (encoding === 1) {
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2)).replace(/\0+$/g, '');
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2)).replace(/\0+$/g, '');
        return new TextDecoder('utf-16le').decode(bytes).replace(/^\ufeff|\0+$/g, '');
    }
    if (encoding === 2) return new TextDecoder('utf-16be').decode(bytes).replace(/^\ufeff|\0+$/g, '');
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(bytes).replace(/\0+$/g, '');
}

function readInt32(data, offset) {
    return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function readSyncSafeInt(data, offset) {
    return (data[offset] << 21) | (data[offset + 1] << 14) | (data[offset + 2] << 7) | data[offset + 3];
}

function chunkId(bytes, offset, length = 4) {
    let id = '';
    for (let i = 0; i < length; i++) id += String.fromCharCode(bytes[offset + i]);
    return id;
}
