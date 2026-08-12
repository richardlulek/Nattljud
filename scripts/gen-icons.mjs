/**
 * Genererar appikonerna (PNG) utan externa beroenden: månskära + ljudvågor
 * på mörk botten. Körs med `npm run icons`; resultatet checkas in i
 * public/icons/ så att bygget inte behöver köra skriptet.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const här = dirname(fileURLToPath(import.meta.url));
const utKatalog = join(här, "..", "public", "icons");

/* ------------------------------------------------------------------ PNG */

const crcTabell = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTabell[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTabell[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(typ, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(typ, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bitdjup
  ihdr[9] = 6; // RGBA
  const rad = size * 4 + 1;
  const raw = Buffer.alloc(rad * size);
  for (let y = 0; y < size; y++) {
    raw[y * rad] = 0; // filter: none
    rgba.copy(raw, y * rad + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ scen */

const AMBER = [224, 167, 92];
const AMBER_DOV = [138, 106, 58];
const STJÄRNOR = [
  [0.18, 0.2],
  [0.8, 0.14],
  [0.87, 0.6],
  [0.14, 0.74],
  [0.66, 0.87],
];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Färg i normaliserade koordinater u,v ∈ [0,1]. skala < 1 för maskable. */
function färg(u, v, skala) {
  // Bakgrund: mörk vertikal gradient.
  let c = mix([11, 14, 24], [5, 6, 10], v);

  // Transformera in i "konstens" koordinater (krymper motivet för maskable).
  const fu = (u - 0.5) / skala + 0.5;
  const fv = (v - 0.5) / skala + 0.5;

  for (const [sx, sy] of STJÄRNOR) {
    const d = Math.hypot(fu - sx, fv - sy);
    if (d < 0.008) c = mix(c, [66, 72, 96], 0.9);
  }

  const M = [0.4, 0.45];
  const R = 0.21;
  const dm = Math.hypot(fu - M[0], fv - M[1]);
  const dc = Math.hypot(fu - (M[0] + 0.085), fv - (M[1] - 0.05));

  // Ljudvågor: tre bågar till höger om månen.
  const vinkel = (Math.atan2(fv - M[1], fu - M[0]) * 180) / Math.PI;
  if (vinkel > -52 && vinkel < 52) {
    const bågar = [
      [R * 1.55, 0.85],
      [R * 1.95, 0.55],
      [R * 2.35, 0.32],
    ];
    for (const [rad, styrka] of bågar) {
      if (Math.abs(dm - rad) < 0.014) c = mix(c, AMBER, styrka);
    }
  }

  // Månskäran (cirkel minus förskjuten cirkel).
  if (dm <= R && dc > R * 0.93) {
    const kant = Math.min(1, (R - dm) / 0.01);
    c = mix(c, mix(AMBER, [240, 196, 130], Math.max(0, 0.5 - dm * 2)), kant);
  } else if (dm <= R && dc <= R * 0.93) {
    // "Jordskenet" på månens mörka del – aningen ljusare än bakgrunden.
    c = mix(c, AMBER_DOV, 0.12);
  }

  return c;
}

function rita(size, skala) {
  const SS = 3; // supersampling för mjuka kanter
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = färg(u, v, skala);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(utKatalog, { recursive: true });
const filer = [
  ["icon-512.png", 512, 1],
  ["icon-192.png", 192, 1],
  ["apple-touch-icon.png", 180, 1],
  ["icon-maskable-512.png", 512, 0.72],
];
for (const [namn, size, skala] of filer) {
  const png = rita(size, skala);
  writeFileSync(join(utKatalog, namn), png);
  console.log(`skrev ${namn} (${png.length} byte)`);
}
