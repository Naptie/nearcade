/**
 * Generates the app icons in ./static.
 *
 * Usage: pnpm icons
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as fontkit from 'fontkit';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const STATIC = resolve(ROOT, 'static');
// Static ExtraBold (800) build: fontkit cannot decode the variable woff2's variation glyphs
const FONT_PATH = resolve(ROOT, 'node_modules/@fontsource/sora/files/sora-latin-800-normal.woff');

const GLYPH = 'n';
const GLYPH_HEIGHT_RATIO = 0.5; // glyph height relative to the icon size
const SUPERELLIPSE_EXPONENT = 4; // |x|^n + |y|^n = 1; 2 is a circle, larger is squarer
// Same stops as `from-sky-500 via-purple-500 to-rose-500` in SiteTitle.svelte
const GRADIENT = ['#0ea5e9', '#a855f7', '#f43f5e'];

const VIEWBOX = 512;

const opened = fontkit.openSync(FONT_PATH);
if (!('layout' in opened)) throw new Error('Expected a single font, got a collection');
const font = opened;
const glyph = font.layout(GLYPH).glyphs[0];
const { minX, minY, maxX, maxY } = glyph.bbox;

// Font units are y-up; flip, scale to the target height and centre the bounding box.
const scale = (VIEWBOX * GLYPH_HEIGHT_RATIO) / (maxY - minY);
const tx = (VIEWBOX - (maxX - minX) * scale) / 2 - minX * scale;
const ty = (VIEWBOX + (maxY - minY) * scale) / 2 + minY * scale;
const pathData = glyph.path.scale(scale, -scale).translate(tx, ty).toSVG();

function superellipsePath(): string {
  const half = VIEWBOX / 2;
  const steps = 256;
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = half + half * Math.sign(c) * Math.abs(c) ** (2 / SUPERELLIPSE_EXPONENT);
    const y = half + half * Math.sign(s) * Math.abs(s) ** (2 / SUPERELLIPSE_EXPONENT);
    points.push(`${+x.toFixed(1)} ${+y.toFixed(1)}`);
  }
  return `M${points.join('L')}Z`;
}

// "squircle" has transparent corners (browser tabs); "square" is full-bleed so that
// platforms (iOS, Android maskable icons) can apply their own mask. The glyph stays well
// inside the 80% maskable safe zone.
function buildSvg(shape: 'squircle' | 'square'): string {
  const background =
    shape === 'squircle'
      ? `<path d="${superellipsePath()}" fill="url(#g)"/>`
      : `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="url(#g)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRADIENT[0]}"/><stop offset=".5" stop-color="${GRADIENT[1]}"/><stop offset="1" stop-color="${GRADIENT[2]}"/></linearGradient></defs>${background}<path d="${pathData}" fill="#fff"/></svg>`;
}

const squircleSvg = buildSvg('squircle');
const squareSvg = buildSvg('square');

async function render(
  svg: string,
  name: string,
  size: number,
  formats: ('png' | 'webp')[]
): Promise<void> {
  const base = sharp(Buffer.from(svg), { density: (72 * size * 2) / VIEWBOX }).resize(size, size);
  for (const format of formats) {
    const image = base.clone();
    await (
      format === 'png' ? image.png({ compressionLevel: 9 }) : image.webp({ quality: 90 })
    ).toFile(resolve(STATIC, `${name}.${format}`));
    console.log(`${name}.${format}`);
  }
}

writeFileSync(resolve(STATIC, 'favicon.svg'), squircleSvg);
console.log('favicon.svg');
await render(squircleSvg, 'favicon', 128, ['webp']);

await render(squareSvg, 'icon-192', 192, ['png', 'webp']);
await render(squareSvg, 'icon-256', 256, ['png', 'webp']);
await render(squareSvg, 'icon-512', 512, ['png', 'webp']);
await render(squareSvg, 'apple-touch-icon', 180, ['png']);

// Keep the self-contained maintenance page's inlined favicon in sync
const maintenancePath = resolve(STATIC, 'maintenance.html');
const maintenance = readFileSync(maintenancePath, 'utf-8');
const inlined = `data:image/svg+xml,${encodeURIComponent(squircleSvg).replace(/'/g, '%27')}`;
const updated = maintenance.replace(/href="data:image\/svg\+xml,[^"]*"/, `href="${inlined}"`);
if (updated !== maintenance) {
  writeFileSync(maintenancePath, updated);
  console.log('maintenance.html');
}
