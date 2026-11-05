import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}
const line = (x, y, ax, ay, bx, by, r) => {
  const t = Math.max(
    0,
    Math.min(
      1,
      ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) /
        ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  return (x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2 < r * r;
};
const leaf = (x, y, cx, cy, angle) => {
  const dx = x - cx,
    dy = y - cy,
    u = dx * Math.cos(angle) + dy * Math.sin(angle),
    v = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return (u / 9) ** 2 + (v / 16) ** 2 < 1;
};
for (const size of [192, 512]) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let coverage = 0;
      for (let sy = 0; sy < 2; sy++)
        for (let sx = 0; sx < 2; sx++) {
          const u = ((x + (sx + 0.5) / 2) / size) * 128,
            v = ((y + (sy + 0.5) / 2) / size) * 128;
          if (
            line(u, v, 64, 99, 64, 48, 3) ||
            line(u, v, 64, 76, 42, 54, 3) ||
            line(u, v, 64, 66, 86, 44, 3) ||
            leaf(u, v, 37, 43, -0.7) ||
            leaf(u, v, 64, 34, 0) ||
            leaf(u, v, 90, 38, 0.7)
          )
            coverage++;
        }
      const blend = coverage / 4,
        pos = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++)
        pixels[pos + c] = Math.round(
          [38, 78, 67][c] * (1 - blend) + [225, 235, 200][c] * blend,
        );
      pixels[pos + 3] = 255;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png);
}
console.log("Generated both install icons.");
