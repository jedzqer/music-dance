import { chunkId, readInt32, readSyncSafeInt, decodeId3Text, findTextAfterTerminator, parseFlacBlocks, extractWavId3Data, readJsmediatags } from './binary-utils.js';

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
    return readJsmediatags(file, tag => {
        const raw = tag.tags?.lyrics || tag.tags?.USLT;
        return raw ? normalizeRawLyrics(raw) : null;
    });
}

function normalizeRawLyrics(raw) {
    if (!raw || typeof raw === 'string') return raw;
    return raw.lyrics || raw.text || raw.description || raw.data || String(raw);
}

async function extractFlacLyrics(file) {
    return parseFlacBlocks(file, (blockType, data) => {
        if (blockType !== 4) return undefined;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const decoder = new TextDecoder('utf-8');
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
    });
}

async function extractWavId3Lyrics(file) {
    const id3File = await extractWavId3Data(file);
    return id3File ? readLyricsFromTags(id3File) : null;
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

