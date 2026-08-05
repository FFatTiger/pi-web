// Generate Pi logo favicon + PWA icons.
/* eslint-disable @typescript-eslint/no-require-imports */
// PiLogo glyph (solid accent color, matching the left-top logo style) rendered
// via sharp, then packaged:
//  - app/favicon.ico       (PNG-in-ICO: 16/32/48)
//  - public/icons/icon-192.png / icon-512.png / apple-touch-icon.png (180)
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Solid accent (dark theme --accent); no gradient.
const COLOR = "#000000";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 470">
  <path fill-rule="evenodd" clip-rule="evenodd" fill="${COLOR}"
    d="M0 0H352.07V234.71H234.71V352.07H117.36V469.43H0V0ZM117.36 117.36V234.71H234.71V117.36H117.36Z"/>
  <path fill="${COLOR}" d="M352.07 234.71H469.43V469.43H352.07V234.71Z"/>
</svg>`;

const root = path.resolve(__dirname, "..");

async function main() {
  const pngs = {};
  for (const s of [16, 32, 48, 180, 192, 512]) {
    pngs[s] = await sharp(Buffer.from(svg)).resize(s, s).png().toBuffer();
  }

  // PNG-in-ICO: ICONDIR + ICONDIRENTRY[] + PNG data
  const icoSizes = [16, 32, 48];
  const offset = 6 + icoSizes.length * 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(icoSizes.length, 4); // count
  const entries = [];
  const datas = [];
  let cursor = offset;
  for (const s of icoSizes) {
    const data = pngs[s];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(s >= 256 ? 0 : s, 0); // width
    entry.writeUInt8(s >= 256 ? 0 : s, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(data.length, 8); // size
    entry.writeUInt32LE(cursor, 12); // offset
    cursor += data.length;
    entries.push(entry);
    datas.push(data);
  }
  fs.writeFileSync(path.join(root, "app/favicon.ico"), Buffer.concat([header, ...entries, ...datas]));
  fs.writeFileSync(path.join(root, "public/icons/icon-192.png"), pngs[192]);
  fs.writeFileSync(path.join(root, "public/icons/icon-512.png"), pngs[512]);
  fs.writeFileSync(path.join(root, "public/icons/apple-touch-icon.png"), pngs[180]);
  console.log("wrote app/favicon.ico, public/icons/{icon-192,icon-512,apple-touch-icon}.png");
}

main().catch((e) => { console.error(e); process.exit(1); });
