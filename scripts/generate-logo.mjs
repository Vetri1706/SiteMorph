import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKGROUND = [0x18, 0x18, 0x18, 0xff];
const TILES = [
  { x: 1232, y: 1232, width: 864, height: 864, radius: 216, color: [0x2e, 0x9e, 0xff, 0xff] },
  { x: 2288, y: 1232, width: 576, height: 576, radius: 144, color: [0x0c, 0x79, 0xd8, 0xff] },
  { x: 1232, y: 2288, width: 576, height: 576, radius: 144, color: [0x0c, 0x79, 0xd8, 0xff] },
  { x: 2000, y: 2000, width: 864, height: 864, radius: 216, color: [0x68, 0xc4, 0xff, 0xff] },
];

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function roundedRectCoverage(px, py, rect, scale) {
  const x = px / scale;
  const y = py / scale;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const qx = Math.abs(x - cx) - (rect.width / 2 - rect.radius);
  const qy = Math.abs(y - cy) - (rect.height / 2 - rect.radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const distance = outside + inside - rect.radius;
  return Math.max(0, Math.min(1, 0.5 - distance * scale));
}

function render(size) {
  const scale = size / 4096;
  const rowLength = 1 + size * 4;
  const raw = Buffer.alloc(rowLength * size);

  for (let y = 0; y < size; y += 1) {
    const row = y * rowLength;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = BACKGROUND[0];
      raw[offset + 1] = BACKGROUND[1];
      raw[offset + 2] = BACKGROUND[2];
      raw[offset + 3] = BACKGROUND[3];
    }
  }

  for (const tile of TILES) {
    const minX = Math.max(0, Math.floor((tile.x - 2) * scale));
    const maxX = Math.min(size - 1, Math.ceil((tile.x + tile.width + 2) * scale));
    const minY = Math.max(0, Math.floor((tile.y - 2) * scale));
    const maxY = Math.min(size - 1, Math.ceil((tile.y + tile.height + 2) * scale));
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * rowLength;
      for (let x = minX; x <= maxX; x += 1) {
        const coverage = roundedRectCoverage(x + 0.5, y + 0.5, tile, scale);
        if (coverage <= 0) continue;
        const offset = row + 1 + x * 4;
        raw[offset] = Math.round(raw[offset] * (1 - coverage) + tile.color[0] * coverage);
        raw[offset + 1] = Math.round(raw[offset + 1] * (1 - coverage) + tile.color[1] * coverage);
        raw[offset + 2] = Math.round(raw[offset + 2] * (1 - coverage) + tile.color[2] * coverage);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [size, fileName] of [[256, "sitemorph-logo-256.png"], [512, "sitemorph-logo-512.png"], [4096, "sitemorph-logo-4k.png"]]) {
  await writeFile(path.join(ROOT, "public", fileName), render(size));
  console.log(`Generated public/${fileName} (${size}x${size})`);
}
