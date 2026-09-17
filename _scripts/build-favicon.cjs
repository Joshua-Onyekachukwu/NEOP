// One-off brand build: render favicon PNGs from the NEOP mark with sharp and
// assemble a real multi-size ICO (PNG-compressed entries, 0x00000001 header).
// Usage: node _scripts/build-favicon.cjs
const sharp = require("../node_modules/sharp");
const fs = require("fs");
const path = require("path");

const MARK = path.join(__dirname, "..", "apps/web/public/images/logo-mark.svg");
const OUT = path.join(__dirname, "..", "apps/web/public");
const SIZES = [16, 32, 48];

(async () => {
  // Render each size as PNG
  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(MARK, { density: 512 }).resize(size, size).png().toBuffer();
    pngs.push({ size, buf });
    if (size >= 32) {
      fs.writeFileSync(path.join(OUT, size === 32 ? "favicon-32x32.png" : "favicon-48x48.png"), buf);
    }
  }
  // Also emit apple-touch-icon (180px) and a 192px manifest icon
  const apple = await sharp(MARK, { density: 512 }).resize(180, 180).png().toBuffer();
  fs.writeFileSync(path.join(OUT, "apple-touch-icon.png"), apple);
  const m192 = await sharp(MARK, { density: 512 }).resize(192, 192).png().toBuffer();
  fs.writeFileSync(path.join(OUT, "icon-192.png"), m192);

  // Assemble ICO: 6-byte header + 16-byte dir entries + image data
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4); // count

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }

  const ico = Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
  fs.writeFileSync(path.join(OUT, "..", "src/app/favicon.ico"), ico);
  console.log("favicon.ico:", ico.length, "bytes,", pngs.length, "sizes:", pngs.map(p => p.size).join("/"));
})().catch(e => { console.error(e); process.exit(1); });
