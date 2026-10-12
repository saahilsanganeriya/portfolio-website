import * as THREE from 'three';
import type { Photograph, PhotoSection } from './photographs';
import type { TextureStore } from './textures';

// The album's pages, drawn into canvases only when they are near the open spread: a title page, then each section
// of the collection (favourites first, then each series) behind its own divider, one photograph to a page with its
// title, year and caption. A small number of page textures and pictures is kept; the rest are let go.

export type Page =
  | { kind: 'title'; count: number }
  | { kind: 'section'; title: string; count: number }
  | { kind: 'photo'; photo: Photograph; number: number; count: number }
  | { kind: 'end' };

/** Every page in reading order; pages[0] is the first right-hand page, facing the inside of the front cover. */
export function albumPages(sections: PhotoSection[]): Page[] {
  const count = sections.reduce((n, s) => n + s.photos.length, 0);
  const pages: Page[] = [{ kind: 'title', count }];
  let number = 0;
  for (const section of sections) {
    pages.push({ kind: 'section', title: section.title, count: section.photos.length });
    for (const photo of section.photos) pages.push({ kind: 'photo', photo, number: ++number, count });
  }
  pages.push({ kind: 'end' });
  return pages;
}

/** Spoken and probed name of a page. */
export function pageLabel(page: Page | null): string {
  if (!page) return 'endpaper';
  switch (page.kind) {
    case 'title':
      return 'A Narrative in a Frame';
    case 'section':
      return page.title;
    case 'photo':
      return page.photo.title;
    case 'end':
      return 'the end';
  }
}

const PAGE_HEIGHT_PX = 1024;
const MAX_PAGES = 8;
const INK = '#14110f';
const PAPER = '#ede4d3';
const DUST = '#6f675c';
const THREAD = '#b4442c';
const SERIF = '"Newsreader Variable", Georgia, serif';
const SANS = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';

interface Entry {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  bitmap: Promise<ImageBitmap | null> | null;
}

/** Page textures by page index (-1 is the inside of the front cover, pages.length the inside of the back cover). */
export class PageCache {
  readonly width: number;
  readonly height = PAGE_HEIGHT_PX;
  private readonly entries = new Map<number, Entry>();
  private readonly endpaper: THREE.CanvasTexture;
  readonly cover: THREE.CanvasTexture;
  private readonly fontsReady: Promise<unknown>;

  constructor(
    private readonly pages: Page[],
    private readonly textures: TextureStore,
    aspect: number,
  ) {
    this.width = Math.round(PAGE_HEIGHT_PX * aspect);
    this.endpaper = this.texture(this.drawEndpaper(this.canvas()));
    this.cover = this.texture(this.drawCover(this.canvas()));
    this.fontsReady = Promise.all([
      document.fonts?.load(`italic 40px ${SERIF}`),
      document.fonts?.load(`64px ${SERIF}`),
      document.fonts?.load(`16px ${SANS}`),
    ]).catch(() => undefined);
    // Text drawn before the fonts arrived is drawn again with them.
    void this.fontsReady.then(() => {
      this.drawCover(this.cover.image as HTMLCanvasElement);
      this.cover.needsUpdate = true;
      for (const [index, entry] of this.entries) this.draw(index, entry);
    });
  }

  get size() {
    return this.entries.size;
  }

  /** The texture for page `index`, drawn now (its picture follows when it arrives). */
  get(index: number): THREE.Texture {
    if (index < 0 || index >= this.pages.length) return this.endpaper;
    let entry = this.entries.get(index);
    if (entry) {
      // Most recently used last.
      this.entries.delete(index);
      this.entries.set(index, entry);
      return entry.texture;
    }
    const canvas = this.canvas();
    entry = { canvas, texture: this.texture(canvas), bitmap: null };
    const page = this.pages[index];
    if (page.kind === 'photo') {
      entry.bitmap = this.textures.bitmap(page.photo.medium.src).catch((error) => {
        console.warn(`room: album photograph ${page.photo.slug} did not load`, error);
        return null;
      });
      void entry.bitmap.then(() => this.entries.get(index) === entry && this.draw(index, entry!));
    }
    this.draw(index, entry);
    this.entries.set(index, entry);
    this.evict();
    return entry.texture;
  }

  /** Draws the pages of the spreads around the open one ahead of time. */
  prefetch(indices: number[]) {
    for (const index of indices) if (index >= 0 && index < this.pages.length && !this.entries.has(index)) this.get(index);
  }

  /** Whether every page in `indices` has its picture (or needs none). */
  async ready(indices: number[]) {
    await Promise.all(indices.map((i) => this.entries.get(i)?.bitmap ?? null));
  }

  dispose() {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.endpaper.dispose();
    this.cover.dispose();
  }

  private evict() {
    while (this.entries.size > MAX_PAGES) {
      const [index, entry] = this.entries.entries().next().value!;
      this.entries.delete(index);
      this.release(entry);
    }
  }

  private release(entry: Entry) {
    entry.texture.dispose();
    void entry.bitmap?.then((b) => b?.close());
  }

  private canvas() {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    return canvas;
  }

  private texture(canvas: HTMLCanvasElement) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private draw(index: number, entry: Entry) {
    const page = this.pages[index];
    const ctx = entry.canvas.getContext('2d')!;
    this.paper(ctx);
    if (page.kind === 'title') this.drawTitle(ctx, page.count);
    else if (page.kind === 'section') this.drawSection(ctx, page.title, page.count);
    else if (page.kind === 'end') this.drawEnd(ctx);
    else {
      this.drawPhotoText(ctx, page.photo, page.number, page.count, index);
      void entry.bitmap?.then((bitmap) => {
        if (this.entries.get(index) !== entry) return;
        this.drawPhoto(ctx, bitmap);
        entry.texture.needsUpdate = true;
      });
    }
    entry.texture.needsUpdate = true;
  }

  // ---- drawing ----

  private paper(ctx: CanvasRenderingContext2D, colour = PAPER) {
    const { width: w, height: h } = this;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, w, h);
    // Paper is never flat: a faint fibre speckle, the same on every page.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = 'rgba(80, 60, 40, 0.035)';
    for (let i = 0; i < 1400; i++) ctx.fillRect(random() * w, random() * h, 1 + random() * 2, 1);
  }

  private setFont(ctx: CanvasRenderingContext2D, font: string, colour: string, align: CanvasTextAlign = 'center') {
    ctx.font = font;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
  }

  private spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  }

  /** Wraps `text` to `maxWidth`, at most `lines` lines (the last one ends in an ellipsis if cut). */
  private wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, lines: number): string[] {
    const words = text.split(/\s+/);
    const out: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    if (out.length > lines) {
      out.length = lines;
      out[lines - 1] = `${out[lines - 1].replace(/\s+\S*$/, '')}…`;
    }
    return out;
  }

  private drawTitle(ctx: CanvasRenderingContext2D, count: number) {
    const { width: w, height: h } = this;
    this.setFont(ctx, `italic 30px ${SERIF}`, DUST);
    ctx.fillText('photographs by Saahil Sanganeriya', w / 2, h * 0.3);
    this.setFont(ctx, `64px ${SERIF}`, INK);
    this.wrap(ctx, 'A Narrative in a Frame', w * 0.8, 2).forEach((line, i) => ctx.fillText(line, w / 2, h * 0.42 + i * 72));
    ctx.fillStyle = THREAD;
    ctx.fillRect(w / 2 - 60, h * 0.42 + 110, 120, 3);
    this.setFont(ctx, `500 16px ${SANS}`, DUST);
    this.spaced(ctx, `${count} PHOTOGRAPHS`, w / 2, h * 0.42 + 160, 4);
    this.setFont(ctx, `italic 22px ${SERIF}`, DUST);
    ctx.fillText('turn the page →', w / 2, h * 0.9);
  }

  private drawSection(ctx: CanvasRenderingContext2D, title: string, count: number) {
    const { width: w, height: h } = this;
    this.setFont(ctx, `76px ${SERIF}`, INK);
    this.wrap(ctx, title, w * 0.8, 2).forEach((line, i) => ctx.fillText(line, w / 2, h * 0.46 + i * 84));
    ctx.fillStyle = THREAD;
    ctx.fillRect(w / 2 - 40, h * 0.46 + 46, 80, 3);
    this.setFont(ctx, `500 16px ${SANS}`, DUST);
    this.spaced(ctx, `${count} ${count === 1 ? 'PHOTOGRAPH' : 'PHOTOGRAPHS'}`, w / 2, h * 0.46 + 96, 4);
  }

  private drawEnd(ctx: CanvasRenderingContext2D) {
    const { width: w, height: h } = this;
    this.setFont(ctx, `italic 26px ${SERIF}`, DUST);
    ctx.fillText('Each one is in SaahilOS too,', w / 2, h * 0.46);
    ctx.fillText('in A Narrative in a Frame.', w / 2, h * 0.46 + 38);
    ctx.fillStyle = THREAD;
    ctx.fillRect(w / 2 - 30, h * 0.46 + 76, 60, 3);
  }

  /** The box the photograph is mounted in, the same on every photo page. */
  private photoBox() {
    const { width: w, height: h } = this;
    return { x: w * 0.1, y: h * 0.09, w: w * 0.8, h: h * 0.6 };
  }

  private drawPhoto(ctx: CanvasRenderingContext2D, image: ImageBitmap | null) {
    const box = this.photoBox();
    if (!image) return;
    const scale = Math.min(box.w / image.width, box.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const x = box.x + (box.w - w) / 2;
    const y = box.y + (box.h - h) / 2;
    ctx.clearRect(box.x - 30, box.y - 30, box.w + 60, box.h + 60);
    this.paperPatch(ctx, box.x - 30, box.y - 30, box.w + 60, box.h + 60);
    // A print with a white border and a soft shadow, held by four paper corners.
    ctx.save();
    ctx.shadowColor = 'rgba(40, 28, 18, 0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#f7f3ea';
    ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
    ctx.restore();
    ctx.drawImage(image, x, y, w, h);
    ctx.fillStyle = '#2d241d';
    const c = 28;
    for (const [cx, cy, dx, dy] of [
      [x - 10, y - 10, 1, 1],
      [x + w + 10, y - 10, -1, 1],
      [x - 10, y + h + 10, 1, -1],
      [x + w + 10, y + h + 10, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx * c, cy);
      ctx.lineTo(cx, cy + dy * c);
      ctx.fill();
    }
  }

  /** Paper behind the photograph area (before it is drawn again with its picture). */
  private paperPatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    this.paper(ctx);
    ctx.restore();
  }

  private drawPhotoText(ctx: CanvasRenderingContext2D, photo: Photograph, number: number, count: number, index: number) {
    const { width: w, height: h } = this;
    const box = this.photoBox();
    // Where the picture will sit: a pale mount until it arrives.
    ctx.fillStyle = 'rgba(60, 45, 30, 0.08)';
    ctx.fillRect(box.x + box.w * 0.1, box.y + box.h * 0.15, box.w * 0.8, box.h * 0.7);
    const top = box.y + box.h + 70;
    this.setFont(ctx, `italic 40px ${SERIF}`, INK);
    this.wrap(ctx, photo.title, w * 0.8, 2).forEach((line, i) => ctx.fillText(line, w / 2, top + i * 46));
    const titleLines = Math.min(2, this.wrap(ctx, photo.title, w * 0.8, 2).length);
    const meta = [String(photo.year), photo.place].filter(Boolean).join(' · ').toUpperCase();
    this.setFont(ctx, `500 15px ${SANS}`, DUST);
    this.spaced(ctx, meta, w / 2, top + titleLines * 46 + 6, 3);
    this.setFont(ctx, `25px ${SERIF}`, '#3b322a');
    this.wrap(ctx, photo.caption, w * 0.74, 3).forEach((line, i) => ctx.fillText(line, w / 2, top + titleLines * 46 + 52 + i * 34));
    // Page numbers on the outer corners: odd pages are on the left of a spread.
    this.setFont(ctx, `16px ${SANS}`, DUST, index % 2 === 0 ? 'right' : 'left');
    ctx.fillText(`${number} / ${count}`, index % 2 === 0 ? w - 40 : 40, h - 36);
  }

  private drawEndpaper(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    this.paper(ctx, '#c9b99c');
    // A quiet repeating pattern, as on old album endpapers.
    ctx.strokeStyle = 'rgba(59, 42, 30, 0.18)';
    ctx.lineWidth = 1.5;
    for (let y = 24; y < this.height; y += 48) {
      for (let x = 24 + ((y / 48) % 2) * 24; x < this.width; x += 48) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    return canvas;
  }

  private drawCover(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = this;
    ctx.fillStyle = '#3b2a1e';
    ctx.fillRect(0, 0, w, h);
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let i = 0; i < 2600; i++) ctx.fillRect(random() * w, random() * h, 2, 1);
    ctx.strokeStyle = 'rgba(237, 228, 211, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(46, 46, w - 92, h - 92);
    ctx.fillStyle = 'rgba(237, 228, 211, 0.75)';
    ctx.textAlign = 'center';
    ctx.font = `italic 46px ${SERIF}`;
    ctx.fillText('Photographs', w / 2, h * 0.42);
    ctx.fillStyle = THREAD;
    ctx.fillRect(w / 2 - 50, h * 0.42 + 30, 100, 3);
    return canvas;
  }
}
