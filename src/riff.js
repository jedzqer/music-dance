export async function extractRiffChunk(file, wantedIds) {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (chunkId(header, 0) !== 'RIFF' || chunkId(header, 8) !== 'WAVE') return null;

    const wanted = new Set(wantedIds.map((id) => id.toUpperCase()));
    let offset = 12;
    while (offset + 8 <= file.size) {
        const chunkHeader = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
        const id = chunkId(chunkHeader, 0);
        const size = (chunkHeader[4] | (chunkHeader[5] << 8) | (chunkHeader[6] << 16) | (chunkHeader[7] << 24)) >>> 0;
        const dataOffset = offset + 8;
        if (dataOffset + size > file.size) return null;

        if (wanted.has(id.toUpperCase())) {
            return new Uint8Array(await file.slice(dataOffset, dataOffset + size).arrayBuffer());
        }

        offset = dataOffset + size + (size % 2);
    }
    return null;
}

function chunkId(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}
