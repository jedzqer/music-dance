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
            window.jsmediatags.read(file, {
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
    const size = 48;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ictx = c.getContext('2d', { willReadFrequently: true });
    ictx.drawImage(img, 0, 0, size, size);
    const pixels = ictx.getImageData(0, 0, size, size).data;
    const buckets = new Map();

    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a < 180) continue;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const [, s, l] = rgbToHsl(r, g, b);
        if (l < 8) continue;
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, score: 0 };
        const weight = 1 + s / 55 + (100 - Math.abs(l - 55)) / 100;
        bucket.r += r * weight;
        bucket.g += g * weight;
        bucket.b += b * weight;
        bucket.count += weight;
        bucket.score += weight * (0.65 + s / 80) * (1 - Math.abs(l - 52) / 80);
        buckets.set(key, bucket);
    }

    const colors = Array.from(buckets.values())
        .filter(color => color.count > 0)
        .map(color => ({
            r: color.r / color.count,
            g: color.g / color.count,
            b: color.b / color.count,
            score: color.score
        }))
        .sort((a, b) => b.score - a.score);

    if (!colors.length) return null;
    const palette = [];
    for (const color of colors) {
        const [h] = rgbToHsl(color.r, color.g, color.b);
        const isDistinct = palette.every((existing) => {
            const [eh] = rgbToHsl(existing.r, existing.g, existing.b);
            return Math.abs(((h - eh + 540) % 360) - 180) > 28;
        });
        if (isDistinct) palette.push(color);
        if (palette.length >= 2) break;
    }
    while (palette.length < 2) {
        const source = palette[0] || colors[0];
        const [h, s, l] = rgbToHsl(source.r, source.g, source.b);
        const [r, g, b] = hslToRgb((h + 180) % 360, clamp(s + 18, 48, 96), clamp(l + 10, 42, 72));
        palette.push({ r, g, b, score: source.score * 0.75 });
    }
    return { colors: palette.slice(0, 2) };
}
