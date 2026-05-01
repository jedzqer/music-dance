import jsmediatags from 'jsmediatags';
import { clamp, hslToRgb, rgbToHsl } from './utils.js';
import { extractRiffChunk } from './riff.js';

export function pictureToImageUrl(picture) {
    if (!picture || !picture.data || !picture.format) return null;
    const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
    return URL.createObjectURL(new Blob([bytes], { type: picture.format }));
}

export async function readEmbeddedPicture(file) {
    let picture = await readPictureFromTags(file);
    if (!picture) picture = await extractFlacPicture(file);
    if (!picture) picture = await extractWavId3Picture(file);
    return picture;
}

async function readPictureFromTags(file) {
    return new Promise((resolve) => {
        try {
            jsmediatags.read(file, {
                onSuccess: (tag) => resolve(tag.tags?.picture || null),
                onError: () => resolve(null)
            });
        } catch (_) {
            resolve(null);
        }
    });
}

export async function loadCoverPalette(file) {
    const picture = await readEmbeddedPicture(file);
    const url = pictureToImageUrl(picture);
    if (!url) return null;
    try {
        return await imageUrlToPalette(url);
    } catch (_) {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function flacPictureBlockToPicture(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder('utf-8');
    let pos = 4;
    if (pos + 4 > data.length) return null;
    const mimeLength = view.getUint32(pos, false);
    pos += 4;
    if (pos + mimeLength + 4 > data.length) return null;
    const format = decoder.decode(data.slice(pos, pos + mimeLength));
    pos += mimeLength;
    const descriptionLength = view.getUint32(pos, false);
    pos += 4 + descriptionLength + 16;
    if (pos + 4 > data.length) return null;
    const pictureLength = view.getUint32(pos, false);
    pos += 4;
    if (pos + pictureLength > data.length) return null;
    return { format, data: data.slice(pos, pos + pictureLength) };
}

async function extractFlacPicture(file) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (header[0] !== 0x66 || header[1] !== 0x4c || header[2] !== 0x61 || header[3] !== 0x43) return null;

    let offset = 4;
    while (offset + 4 <= file.size) {
        const blockHeader = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
        const isLast = (blockHeader[0] & 0x80) !== 0;
        const blockType = blockHeader[0] & 0x7f;
        const blockLength = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];
        offset += 4;

        if (blockType === 6) {
            const data = new Uint8Array(await file.slice(offset, offset + blockLength).arrayBuffer());
            return flacPictureBlockToPicture(data);
        }

        offset += blockLength;
        if (isLast) break;
    }
    return null;
}

async function extractWavId3Picture(file) {
    const data = await extractRiffChunk(file, ['ID3 ']);
    if (!data || chunkId(data, 0, 3) !== 'ID3') return null;
    return readPictureFromTags(new File([data], `${file.name}.id3`, { type: 'audio/mpeg' }));
}

function chunkId(bytes, offset, length = 4) {
    let id = '';
    for (let i = 0; i < length; i++) id += String.fromCharCode(bytes[offset + i]);
    return id;
}

async function imageUrlToPalette(url) {
    const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ictx = c.getContext('2d', { willReadFrequently: true });
    ictx.drawImage(img, 0, 0, size, size);
    const pixels = ictx.getImageData(0, 0, size, size).data;
    const buckets = new Map();

    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a < 128) continue;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const [, s, l] = rgbToHsl(r, g, b);
        if (l < 5 || l > 98) continue;
        const key = `${r >> 3},${g >> 3},${b >> 3}`;
        const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, score: 0 };
        const satWeight = 0.3 + s / 100;
        const lightWeight = 1 - Math.abs(l - 50) / 50;
        const weight = satWeight * (0.6 + lightWeight * 0.4);
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        bucket.count += 1;
        bucket.score += weight;
        buckets.set(key, bucket);
    }

    const colors = Array.from(buckets.values())
        .filter(color => color.count >= 2)
        .map(color => ({
            r: color.r / color.count,
            g: color.g / color.count,
            b: color.b / color.count,
            score: color.score / color.count
        }))
        .sort((a, b) => b.score - a.score);

    if (!colors.length) return null;
    const palette = [colors[0]];
    if (colors.length > 1) {
        palette.push(colors[1]);
    }
    return { colors: palette };
}
