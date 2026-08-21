export interface StoredZipEntry {
  name: string;
  data: Uint8Array;
}

const textEncoder = new TextEncoder();

// CRC-32 is required by the ZIP format. This writer intentionally supports
// only stored (uncompressed) entries; JPEG data is already compressed.
const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
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

const concat = (parts: Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

export const createStoredZip = (entries: StoredZipEntry[]): Blob => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

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
    localParts.push(localHeader, data);

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

    localOffset += localHeader.length + data.length;
  });

  const centralDirectory = concat(centralParts);
  const localData = concat(localParts);
  const end = new Uint8Array(22);
  writeU32(end, 0, 0x06054b50);
  writeU16(end, 8, entries.length);
  writeU16(end, 10, entries.length);
  writeU32(end, 12, centralDirectory.length);
  writeU32(end, 16, localData.length);

  return new Blob([localData, centralDirectory, end], { type: "application/zip" });
};
