export interface StoredZipEntry {
  name: string;
  data: Uint8Array;
}

const textEncoder = new TextEncoder();

// CRC-32 is required by the ZIP format. This writer intentionally supports
// only stored (uncompressed) entries; JPEG data is already compressed.
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeU16 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
};

const writeU32 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
};

export const createStoredZip = (entries: StoredZipEntry[]): Blob => {
  // Keep each JPEG as its own Blob part. The browser can assemble these
  // parts without an additional archive-sized concatenated allocation.
  const zipParts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let centralDirectorySize = 0;

  entries.forEach(({ name, data }) => {
    const filename = textEncoder.encode(name);
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + filename.length);
    writeU32(localHeader, 0, 0x04034b50);
    writeU16(localHeader, 4, 20);
    // Bit 11 marks the UTF-8 filename encoding.
    writeU16(localHeader, 6, 0x0800);
    writeU16(localHeader, 8, 0); // STORE, no compression
    writeU32(localHeader, 14, checksum);
    writeU32(localHeader, 18, data.length);
    writeU32(localHeader, 22, data.length);
    writeU16(localHeader, 26, filename.length);
    localHeader.set(filename, 30);
    zipParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + filename.length);
    writeU32(centralHeader, 0, 0x02014b50);
    writeU16(centralHeader, 4, 20);
    writeU16(centralHeader, 6, 20);
    writeU16(centralHeader, 8, 0x0800);
    writeU16(centralHeader, 10, 0); // STORE, no compression
    writeU32(centralHeader, 16, checksum);
    writeU32(centralHeader, 20, data.length);
    writeU32(centralHeader, 24, data.length);
    writeU16(centralHeader, 28, filename.length);
    writeU32(centralHeader, 42, localOffset);
    centralHeader.set(filename, 46);
    centralParts.push(centralHeader);
    centralDirectorySize += centralHeader.length;

    localOffset += localHeader.length + data.length;
  });

  const end = new Uint8Array(22);
  writeU32(end, 0, 0x06054b50);
  writeU16(end, 8, entries.length);
  writeU16(end, 10, entries.length);
  writeU32(end, 12, centralDirectorySize);
  writeU32(end, 16, localOffset);

  return new Blob([...zipParts, ...centralParts, end], { type: "application/zip" });
};
