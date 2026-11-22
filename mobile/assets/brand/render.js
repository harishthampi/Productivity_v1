// Regenerates every app icon PNG from mark.svg. Needs @resvg/resvg-js installed in the CURRENT directory (kept out of
// the app's dependencies):  mkdir /tmp/icons && cd /tmp/icons && npm i @resvg/resvg-js@2.6.2 && node <repo>/mobile/assets/brand/render.js <repo>/mobile/assets
const fs = require('fs');
const path = require('path');
const { Resvg } = require(require.resolve('@resvg/resvg-js', { paths: [process.cwd()] }));

const assets = process.argv[2];
const mark = fs.readFileSync(path.join(assets, 'brand/mark.svg'), 'utf8').match(/<path[^>]*\/>/)[0];

const bg = (rx = 0) => `
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6366F1"/><stop offset="1" stop-color="#4338CA"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#g)"/>`;
// scale the mark around the canvas center
const scaled = (s, p = mark) => `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">${p}</g>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`;

const out = {
  // iOS / store icon: full-bleed square, no transparency (the OS applies its own mask).
  'icon.png': [svg(bg() + scaled(0.82)), 1024],
  // Android adaptive: the visible safe zone is the central ~61%, so the foreground mark is drawn smaller.
  'android-icon-foreground.png': [svg(scaled(0.68)), 512],
  'android-icon-background.png': [svg(bg()), 512],
  'android-icon-monochrome.png': [svg(scaled(0.68)), 432],
  // Splash: mark alone; the background color comes from app.json.
  'splash-icon.png': [svg(scaled(1)), 1024],
  // Web favicon: browsers don't round it, so round it here.
  'favicon.png': [svg(bg(230) + scaled(0.82)), 48],
};

for (const [name, [s, size]] of Object.entries(out)) {
  const png = new Resvg(s, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();
  fs.writeFileSync(path.join(assets, name), png);
  console.log(name, size, png.length, 'bytes');
}
// Preview sheet to eyeball: icon at several sizes, on light and dark.
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520">
  <rect width="600" height="520" fill="#F7F7F9"/><rect x="600" width="600" height="520" fill="#111118"/>
  ${[[60, 60, 300], [400, 60, 120], [400, 220, 60], [400, 320, 29], [660, 60, 300], [1000, 60, 120], [1000, 220, 60]]
    .map(([x, y, w]) => `<svg x="${x}" y="${y}" width="${w}" height="${w}" viewBox="0 0 1024 1024"><clipPath id="c${x}${y}"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#c${x}${y})">${bg()}${scaled(0.82)}</g></svg>`)
    .join('')}
  <svg x="60" y="380" width="120" height="120" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="512" fill="#4F46E5"/>${scaled(0.68)}</svg>
  <svg x="660" y="380" width="120" height="120" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="512" fill="#4F46E5"/>${scaled(0.68)}</svg>
</svg>`;
fs.writeFileSync(path.join(process.cwd(), 'preview.png'), new Resvg(preview).render().asPng());
console.log('preview.png written');
