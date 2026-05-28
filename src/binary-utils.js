import jsmediatags from 'jsmediatags';
import { extractRiffChunk } from './riff.js';

export function chunkId(bytes, offset, length = 4) {
  let id = '';
  for (let i = 0; i < length; i++) id += String.fromCharCode(bytes[offset + i]);
  return id;
}

export function readInt32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

export function readSyncSafeInt(data, offset) {
  return (data[offset] << 21) | (data[offset + 1] << 14) | (data[offset + 2] << 7) | data[offset + 3];
}

export function decodeId3Text(bytes, encoding) {
  if (!bytes.length) return null;
  if (encoding === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.slice(2)).replace(/\0+$/g, '');
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.slice(2)).replace(/\0+$/g, '');
    return new TextDecoder('utf-16le').decode(bytes).replace(/^﻿|\0+$/g, '');
  }
  if (encoding === 2) return new TextDecoder('utf-16be').decode(bytes).replace(/^﻿|\0+$/g, '');
  return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(bytes).replace(/\0+$/g, '');
}

export function findTextAfterTerminator(frame, pos, encoding) {
  const step = encoding === 1 || encoding === 2 ? 2 : 1;
  for (let i = pos; i + step <= frame.length; i += step) {
    if (step === 2 ? frame[i] === 0 && frame[i + 1] === 0 : frame[i] === 0) return i + step;
  }
  return -1;
}

export async function parseFlacBlocks(file, callback) {
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (header[0] !== 0x66 || header[1] !== 0x4c || header[2] !== 0x61 || header[3] !== 0x43) return null;

  let offset = 4;
  while (offset + 4 <= file.size) {
    const blockHeader = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
    const isLast = (blockHeader[0] & 0x80) !== 0;
    const blockType = blockHeader[0] & 0x7f;
    const blockLength = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];
    offset += 4;

    const data = new Uint8Array(await file.slice(offset, offset + blockLength).arrayBuffer());
    const result = callback(blockType, data, isLast);
    if (result !== undefined) return result;

    offset += blockLength;
    if (isLast) break;
  }
  return null;
}

export async function extractWavId3Data(file) {
  const data = await extractRiffChunk(file, ['ID3 ']);
  if (!data || chunkId(data, 0, 3) !== 'ID3') return null;
  return new File([data], `${file.name}.id3`, { type: 'audio/mpeg' });
}

export function readJsmediatags(file, selector) {
  return new Promise((resolve) => {
    try {
      jsmediatags.read(file, {
        onSuccess: (tag) => resolve(selector(tag) ?? null),
        onError: () => resolve(null)
      });
    } catch (_) {
      resolve(null);
    }
  });
}
