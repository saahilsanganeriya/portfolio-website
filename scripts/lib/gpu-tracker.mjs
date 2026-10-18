// GPU memory counted from the page's own WebGL calls, so it works on any build of the site, in Chromium and WebKit:
// every texture level, renderbuffer (each MSAA sample counted) and buffer the page allocates, by internal format,
// minus what it deletes, plus the canvases' drawing buffers. A texture attached to a framebuffer counts as a render
// target. The numbers are what the page asks the GPU to hold, which is what a real GPU holds too; a software GPU
// (this devbox) may store some formats differently, so it is not the browser process's own memory.
//
//   await page.addInitScript({ content: gpuTrackerScript() });   // before page.goto
//   const memory = await page.evaluate(() => window.__gpuTracker.snapshot());

/** GL enum → [name, bytes per texel] for sized and unsized uncompressed formats (RGB8 is padded to 4 by GPUs). */
const UNCOMPRESSED = {
  0x8058: ['RGBA8', 4], 0x8c43: ['SRGB8_ALPHA8', 4], 0x8051: ['RGB8', 4], 0x8c41: ['SRGB8', 4],
  0x881a: ['RGBA16F', 8], 0x881b: ['RGB16F', 8], 0x8814: ['RGBA32F', 16], 0x8815: ['RGB32F', 16],
  0x8c3a: ['R11F_G11F_B10F', 4], 0x8c3d: ['RGB9_E5', 4], 0x8229: ['R8', 1], 0x822b: ['RG8', 2],
  0x822d: ['R16F', 2], 0x822f: ['RG16F', 4], 0x822e: ['R32F', 4], 0x8230: ['RG32F', 8],
  0x8232: ['R8UI', 1], 0x8234: ['R16UI', 2], 0x8236: ['R32UI', 4], 0x8d7c: ['RGBA8UI', 4],
  0x8056: ['RGBA4', 2], 0x8057: ['RGB5_A1', 2], 0x8d62: ['RGB565', 2], 0x8059: ['RGB10_A2', 4],
  0x81a5: ['DEPTH16', 2], 0x81a6: ['DEPTH24', 4], 0x8cac: ['DEPTH32F', 4], 0x88f0: ['DEPTH24_STENCIL8', 4],
  0x8cad: ['DEPTH32F_STENCIL8', 8], 0x8d48: ['STENCIL8', 1], 0x84f9: ['DEPTH_STENCIL', 4],
};
/** Unsized formats: channels; the type gives the bytes per channel. */
const UNSIZED = { 0x1908: ['RGBA', 4], 0x1907: ['RGB', 4], 0x190a: ['LUMINANCE_ALPHA', 2], 0x1909: ['LUMINANCE', 1], 0x1906: ['ALPHA', 1], 0x1903: ['RED', 1], 0x1902: ['DEPTH', 1] };
const TYPE_BYTES = { 0x1401: 1, 0x1400: 1, 0x140b: 2, 0x8d61: 2, 0x1406: 4, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4 };
/** Packed types: bytes per whole texel. */
const PACKED = { 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x84fa: 4, 0x8368: 4, 0x8c3b: 4, 0x8c3e: 4, 0x8dad: 8 };
/** Compressed formats: [name, block width, block height, bytes per block]. */
const COMPRESSED = {
  0x83f0: ['BC1', 4, 4, 8], 0x83f1: ['BC1', 4, 4, 8], 0x8c4c: ['BC1', 4, 4, 8], 0x8c4d: ['BC1', 4, 4, 8],
  0x83f2: ['BC2', 4, 4, 16], 0x8c4e: ['BC2', 4, 4, 16], 0x83f3: ['BC3', 4, 4, 16], 0x8c4f: ['BC3', 4, 4, 16],
  0x8e8c: ['BC7', 4, 4, 16], 0x8e8d: ['BC7', 4, 4, 16], 0x8dbb: ['BC4', 4, 4, 8], 0x8dbd: ['BC5', 4, 4, 16],
  0x8d64: ['ETC1', 4, 4, 8], 0x9274: ['ETC2 RGB', 4, 4, 8], 0x9275: ['ETC2 RGB', 4, 4, 8],
  0x9276: ['ETC2 RGB A1', 4, 4, 8], 0x9277: ['ETC2 RGB A1', 4, 4, 8], 0x9278: ['ETC2 RGBA', 4, 4, 16],
  0x9279: ['ETC2 RGBA', 4, 4, 16], 0x9270: ['EAC R11', 4, 4, 8], 0x9271: ['EAC R11', 4, 4, 8],
  0x9272: ['EAC RG11', 4, 4, 16], 0x9273: ['EAC RG11', 4, 4, 16],
  0x8c00: ['PVRTC', 8, 8, 32], 0x8c01: ['PVRTC', 16, 8, 32], 0x8c02: ['PVRTC', 8, 8, 32], 0x8c03: ['PVRTC', 16, 8, 32],
};
const ASTC_BLOCKS = [[4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8], [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12]];
ASTC_BLOCKS.forEach(([w, h], i) => {
  COMPRESSED[0x93b0 + i] = [`ASTC ${w}x${h}`, w, h, 16];
  COMPRESSED[0x93d0 + i] = [`ASTC ${w}x${h}`, w, h, 16];
});

const TABLES = { UNCOMPRESSED, UNSIZED, TYPE_BYTES, PACKED, COMPRESSED };

/**
 * [format name, bytes] of one level of `internalFormat` at width×height×depth; an unsized format (RGBA, RGB…) takes
 * its bytes from `type`. Unknown formats count 4 bytes per texel, named by their enum.
 */
export function levelBytes(tables, internalFormat, width, height, depth = 1, type = 0x1401) {
  const texels = Math.max(1, width) * Math.max(1, height) * Math.max(1, depth);
  const compressed = tables.COMPRESSED[internalFormat];
  if (compressed) {
    const [name, bw, bh, block] = compressed;
    return [name, Math.ceil(Math.max(1, width) / bw) * Math.ceil(Math.max(1, height) / bh) * Math.max(1, depth) * block];
  }
  const sized = tables.UNCOMPRESSED[internalFormat];
  if (sized) return [sized[0], texels * sized[1]];
  const unsized = tables.UNSIZED[internalFormat];
  if (unsized) {
    const packed = tables.PACKED[type];
    const perTexel = packed ?? unsized[1] * (tables.TYPE_BYTES[type] ?? 1);
    const suffix = type === 0x140b || type === 0x8d61 ? '16F' : type === 0x1406 ? '32F' : '8';
    return [`${unsized[0]}${suffix}`, texels * perTexel];
  }
  return [`0x${internalFormat.toString(16)}`, texels * 4];
}

/**
 * Installs the counter on `root` (the page's window): wraps WebGL's allocation and binding calls and exposes
 * `root.__gpuTracker.snapshot()`. Self-contained (it runs as an init script), so everything it needs is passed in.
 */
export function installGpuTracker(root, tables, levelBytesOf) {
  if (root.__gpuTracker || (root.top && root !== root.top)) return;
  const TEXTURE_CUBE_MAP = 0x8513;
  const TEXTURE_3D = 0x806f;
  const textures = new Map();
  const renderbuffers = new Map();
  const buffers = new Map();
  const contexts = [];
  const perContext = new WeakMap();
  let total = 0;
  let peak = 0;
  const change = (delta) => {
    total += delta;
    if (total > peak) peak = total;
  };
  const state = (gl) => {
    let s = perContext.get(gl);
    if (!s) perContext.set(gl, (s = { unit: 0x84c0, textures: new Map(), renderbuffer: null, buffers: new Map() }));
    return s;
  };
  const isCubeFace = (target) => target >= 0x8515 && target <= 0x851a;
  const bound = (gl, target) => state(gl).textures.get(`${state(gl).unit}:${isCubeFace(target) ? TEXTURE_CUBE_MAP : target}`);
  const record = (texture) => {
    let r = textures.get(texture);
    if (!r) textures.set(texture, (r = { levels: new Map(), format: '', width: 0, height: 0, target: false, storage: false, internalFormat: 0, type: 0x1401, bytes: 0 }));
    return r;
  };
  const setLevel = (r, key, bytes) => {
    const before = r.levels.get(key) ?? 0;
    r.levels.set(key, bytes);
    r.bytes += bytes - before;
    change(bytes - before);
  };
  const allocate = (gl, target, level, internalFormat, width, height, depth, type) => {
    const texture = bound(gl, target);
    if (!texture) return;
    const r = record(texture);
    const [format, bytes] = levelBytesOf(tables, internalFormat, width, height, depth, type);
    if (level === 0) Object.assign(r, { format, width, height, internalFormat, type });
    setLevel(r, `${isCubeFace(target) ? target : 0}:${level}`, bytes);
  };
  const sourceSize = (source) => {
    if (!source) return [0, 0];
    return [source.videoWidth || source.naturalWidth || source.displayWidth || source.width || 0, source.videoHeight || source.naturalHeight || source.displayHeight || source.height || 0];
  };

  const wrap = (proto, name, before) => {
    const original = proto[name];
    if (typeof original !== 'function') return;
    proto[name] = function (...args) {
      const result = original.apply(this, args);
      try {
        before.call(this, args, result);
      } catch {
        // counting must never break the page
      }
      return result;
    };
  };

  for (const ctor of [root.WebGL2RenderingContext, root.WebGLRenderingContext]) {
    const proto = ctor?.prototype;
    if (!proto) continue;
    wrap(proto, 'activeTexture', function ([unit]) {
      state(this).unit = unit;
    });
    wrap(proto, 'bindTexture', function ([target, texture]) {
      state(this).textures.set(`${state(this).unit}:${target}`, texture);
    });
    wrap(proto, 'deleteTexture', function ([texture]) {
      const r = textures.get(texture);
      if (r) change(-r.bytes);
      textures.delete(texture);
    });
    wrap(proto, 'texStorage2D', function ([target, levels, internalFormat, width, height]) {
      const texture = bound(this, target);
      if (!texture) return;
      const r = record(texture);
      r.storage = true;
      const faces = target === TEXTURE_CUBE_MAP ? 6 : 1;
      for (let level = 0; level < levels; level++) {
        const [format, bytes] = levelBytesOf(tables, internalFormat, Math.max(1, width >> level), Math.max(1, height >> level), 1);
        if (level === 0) Object.assign(r, { format, width, height, internalFormat });
        setLevel(r, `0:${level}`, bytes * faces);
      }
    });
    wrap(proto, 'texStorage3D', function ([target, levels, internalFormat, width, height, depth]) {
      const texture = bound(this, target);
      if (!texture) return;
      const r = record(texture);
      r.storage = true;
      for (let level = 0; level < levels; level++) {
        const d = target === TEXTURE_3D ? Math.max(1, depth >> level) : depth;
        const [format, bytes] = levelBytesOf(tables, internalFormat, Math.max(1, width >> level), Math.max(1, height >> level), d);
        if (level === 0) Object.assign(r, { format, width, height, internalFormat });
        setLevel(r, `0:${level}`, bytes);
      }
    });
    wrap(proto, 'texImage2D', function (args) {
      // (target, level, internalformat, width, height, border, format, type, pixels…) or (…, format, type, source)
      const [target, level, internalFormat] = args;
      const [width, height, type] = args.length >= 9 ? [args[3], args[4], args[7]] : [...sourceSize(args[5]), args[4]];
      allocate(this, target, level, internalFormat, width, height, 1, type);
    });
    wrap(proto, 'texImage3D', function ([target, level, internalFormat, width, height, depth, , , type]) {
      allocate(this, target, level, internalFormat, width, height, depth, type);
    });
    wrap(proto, 'copyTexImage2D', function ([target, level, internalFormat, , , width, height]) {
      allocate(this, target, level, internalFormat, width, height, 1, 0x1401);
    });
    wrap(proto, 'compressedTexImage2D', function ([target, level, internalFormat, width, height]) {
      allocate(this, target, level, internalFormat, width, height, 1);
    });
    wrap(proto, 'compressedTexImage3D', function ([target, level, internalFormat, width, height, depth]) {
      allocate(this, target, level, internalFormat, width, height, depth);
    });
    wrap(proto, 'generateMipmap', function ([target]) {
      const texture = bound(this, target);
      const r = texture && textures.get(texture);
      if (!r || r.storage || !r.width) return;
      const faces = target === TEXTURE_CUBE_MAP ? [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a] : [0];
      const levels = Math.floor(Math.log2(Math.max(r.width, r.height))) + 1;
      for (const face of faces) {
        for (let level = 1; level < levels; level++) {
          const [, bytes] = levelBytesOf(tables, r.internalFormat, Math.max(1, r.width >> level), Math.max(1, r.height >> level), 1, r.type);
          setLevel(r, `${face}:${level}`, bytes);
        }
      }
    });
    const attach = function ([, , , texture]) {
      if (texture) record(texture).target = true;
    };
    wrap(proto, 'framebufferTexture2D', attach);
    wrap(proto, 'framebufferTextureLayer', function ([, , texture]) {
      if (texture) record(texture).target = true;
    });

    wrap(proto, 'bindRenderbuffer', function ([, renderbuffer]) {
      state(this).renderbuffer = renderbuffer;
    });
    const storeRenderbuffer = (gl, samples, internalFormat, width, height) => {
      const renderbuffer = state(gl).renderbuffer;
      if (!renderbuffer) return;
      const [format, bytes] = levelBytesOf(tables, internalFormat, width, height, 1);
      const total = bytes * Math.max(1, samples);
      change(total - (renderbuffers.get(renderbuffer)?.bytes ?? 0));
      renderbuffers.set(renderbuffer, { format, width, height, samples, bytes: total });
    };
    wrap(proto, 'renderbufferStorage', function ([, internalFormat, width, height]) {
      storeRenderbuffer(this, 0, internalFormat, width, height);
    });
    wrap(proto, 'renderbufferStorageMultisample', function ([, samples, internalFormat, width, height]) {
      storeRenderbuffer(this, samples, internalFormat, width, height);
    });
    wrap(proto, 'deleteRenderbuffer', function ([renderbuffer]) {
      change(-(renderbuffers.get(renderbuffer)?.bytes ?? 0));
      renderbuffers.delete(renderbuffer);
    });

    wrap(proto, 'bindBuffer', function ([target, buffer]) {
      state(this).buffers.set(target, buffer);
      if (buffer && !buffers.has(buffer)) buffers.set(buffer, { target, bytes: 0 });
    });
    wrap(proto, 'bufferData', function ([target, data, , srcOffset, length]) {
      const buffer = state(this).buffers.get(target);
      const r = buffer && buffers.get(buffer);
      if (!r) return;
      const element = data?.BYTES_PER_ELEMENT ?? 1;
      const bytes = typeof data === 'number' ? data : length ? length * element : (data?.byteLength ?? 0) - (srcOffset ?? 0) * element;
      change(bytes - r.bytes);
      r.bytes = bytes;
    });
    wrap(proto, 'deleteBuffer', function ([buffer]) {
      change(-(buffers.get(buffer)?.bytes ?? 0));
      buffers.delete(buffer);
    });
  }

  const canvasProto = root.HTMLCanvasElement?.prototype;
  if (canvasProto) {
    const getContext = canvasProto.getContext;
    canvasProto.getContext = function (type, ...rest) {
      const gl = getContext.call(this, type, ...rest);
      if (gl && /webgl/i.test(String(type)) && !contexts.some((c) => c.gl === gl)) contexts.push({ canvas: this, gl });
      return gl;
    };
  }

  const BUFFER_KINDS = { 0x8892: 'vertex', 0x8893: 'index', 0x8a11: 'uniform', 0x88eb: 'pixel', 0x88ec: 'pixel', 0x8f36: 'copy', 0x8f37: 'copy', 0x8c8e: 'feedback' };
  const add = (map, key, bytes) => {
    const entry = map[key] ?? (map[key] = { count: 0, bytes: 0 });
    entry.count += 1;
    entry.bytes += bytes;
  };

  root.__gpuTracker = {
    /** Totals by category and format, the drawing buffers, the largest objects, and the peak since the page began. */
    snapshot() {
      const out = { textures: {}, targets: {}, renderbuffers: {}, buffers: {}, canvases: [], largest: [], totals: {}, peak };
      for (const r of textures.values()) {
        if (!r.bytes) continue;
        add(r.target ? out.targets : out.textures, `${r.format} ${r.width}x${r.height}`.trim(), r.bytes);
        out.largest.push({ kind: r.target ? 'target' : 'texture', format: r.format, width: r.width, height: r.height, levels: r.levels.size, bytes: r.bytes });
      }
      for (const r of renderbuffers.values()) {
        add(out.renderbuffers, `${r.format}${r.samples ? ` x${r.samples}` : ''} ${r.width}x${r.height}`, r.bytes);
        out.largest.push({ kind: 'renderbuffer', format: r.format, width: r.width, height: r.height, samples: r.samples, bytes: r.bytes });
      }
      for (const r of buffers.values()) if (r.bytes) add(out.buffers, BUFFER_KINDS[r.target] ?? `0x${r.target.toString(16)}`, r.bytes);
      for (const { canvas, gl } of contexts) {
        if (gl.isContextLost()) continue;
        const attrs = gl.getContextAttributes() ?? {};
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const samples = attrs.antialias ? 4 : 1;
        const depth = attrs.depth || attrs.stencil ? 4 : 0;
        // One copy of the colour (and depth/stencil) buffer, multisampled if asked, plus its resolve; the browser's
        // compositor keeps further copies of the colour that are not counted here.
        const bytes = width * height * (4 + depth) * samples + (samples > 1 ? width * height * 4 : 0);
        out.canvases.push({ width, height, connected: canvas.isConnected, alpha: attrs.alpha, depth: attrs.depth, antialias: attrs.antialias, bytes });
      }
      out.largest.sort((a, b) => b.bytes - a.bytes);
      out.largest = out.largest.slice(0, 24);
      const sum = (map) => Object.values(map).reduce((s, e) => s + e.bytes, 0);
      out.totals = {
        textures: sum(out.textures),
        targets: sum(out.targets) + sum(out.renderbuffers),
        buffers: sum(out.buffers),
        // Canvases in the document; probes made and dropped (capability checks) are listed but not counted.
        canvases: out.canvases.filter((c) => c.connected).reduce((s, c) => s + c.bytes, 0),
      };
      out.totals.all = out.totals.textures + out.totals.targets + out.totals.buffers + out.totals.canvases;
      out.current = total;
      return out;
    },
  };
}

/** The init script's source: the tracker installed on the page's window before any of its scripts run. */
export function gpuTrackerScript() {
  return `(${installGpuTracker})(window, ${JSON.stringify(TABLES)}, ${levelBytes});`;
}

export { TABLES };
