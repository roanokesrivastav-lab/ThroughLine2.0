// Generates the PWA icons without any native image dependency.
// The motif is the product itself: a single thread running through five points.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const paper = [246, 241, 233], ink = [28, 25, 23], ember = [166, 76, 52];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function motif(size, { maskable }) {
  const pad = maskable ? size * 0.2 : size * 0.12;
  const radius = maskable ? 0 : size * 0.22;
  const pts = [0.12, 0.32, 0.5, 0.68, 0.88].map((t, i) => [pad + (size - 2 * pad) * t, size / 2 + Math.sin(i * 1.7) * size * 0.12]);
  return (x, y) => {
    // rounded-square alpha
    const dx = Math.max(radius - x, x - (size - 1 - radius), 0), dy = Math.max(radius - y, y - (size - 1 - radius), 0);
    if (!maskable && Math.hypot(dx, dy) > radius) return [0, 0, 0, 0];
    let col = paper;
    // thread: piecewise line
    let dmin = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      dmin = Math.min(dmin, Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)));
    }
    const w = size * 0.028;
    if (dmin < w) col = mix(ink, paper, Math.max(0, (dmin - w + 1) / 1));
    for (const [px, py] of pts) {
      const d = Math.hypot(x - px, y - py), r = size * 0.075;
      if (d < r) col = mix(ember, col, Math.max(0, d - r + 1));
    }
    return [...col, 255];
  };
}
mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, motif(192, { maskable: false })));
writeFileSync("public/icons/icon-512.png", png(512, motif(512, { maskable: false })));
writeFileSync("public/icons/maskable-512.png", png(512, motif(512, { maskable: true })));
writeFileSync("public/icons/apple-touch-icon.png", png(180, motif(180, { maskable: true })));
writeFileSync("public/icons/badge-72.png", png(72, (x, y) => {
  const d = Math.hypot(x - 36, y - 36);
  return d < 30 ? [255, 255, 255, 255] : [0, 0, 0, 0];
}));
console.log("icons written");
