/* Makes favicon.ico and apple-touch-icon.png from public/favicon.svg.
   Run:  node scripts/make-icons.js   (only needed if you change the logo) */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pub = path.join(__dirname, '..', 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'));

(async () => {
  const png = size => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

  fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), await png(180));

  /* A .ico file can hold a PNG picture: 6-byte header, 16-byte entry, then the PNG */
  const image = await png(48);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt8(48, 6); header.writeUInt8(48, 7);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([header, image]));
  console.log('Icons written to public/');
})();
