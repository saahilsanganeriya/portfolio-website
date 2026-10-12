// The projector pass over the reel: one full-gate WebGL quad that draws the film's black edge with a lit
// perforation per frame, the frame lines, and, over each picture, grain, dust, vignette, shutter flicker and light leaks.
// All geometry arrives in CSS pixels of the gate, so the pass lines up with the DOM strip it sits on.

export interface FilmState {
  /** Left edge of the film, left and right edges of the picture, right edge of the film. */
  strip: [number, number, number, number];
  /** y of frame 0's top edge (the strip's translation), the frame pitch, and the picture height. */
  offset: number;
  pitch: number;
  frameHeight: number;
  frames: number;
  weave: [number, number];
  seed: number;
  flicker: number;
  /** Light-leak strength 0..1 and its height in the frame 0..1. */
  leak: [number, number];
  /** Dust specks: x, y (gate CSS pixels) and radius, three at a time; radius 0 hides one. */
  dust: Float32Array;
}

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_scale;
uniform vec4 u_strip;
uniform float u_offset;
uniform float u_pitch;
uniform float u_frameH;
uniform float u_frames;
uniform vec2 u_weave;
uniform float u_seed;
uniform float u_flicker;
uniform vec2 u_leak;
uniform vec3 u_dust[3];

const vec3 PAPER = vec3(0.929, 0.894, 0.827);
const vec3 BASE = vec3(0.031, 0.027, 0.024);

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float roundedBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
  vec2 p = css - u_weave;
  float along = p.y - u_offset;
  float index = floor(along / u_pitch);
  float fy = along - index * u_pitch;
  bool onFilm = p.x >= u_strip.x && p.x <= u_strip.w && index >= 0.0 && index < u_frames;
  if (!onFilm) { gl_FragColor = vec4(0.0); return; }

  // Edges of the film: dense black; on the left, one perforation per frame at the frame's middle, lit by the lamp.
  if (p.x < u_strip.y || p.x > u_strip.z) {
    vec3 color = BASE;
    if (p.x < u_strip.y) {
      float edge = u_strip.y - u_strip.x;
      vec2 centre = vec2(u_strip.x + edge * 0.47, u_frameH * 0.5);
      vec2 halfSize = vec2(edge * 0.24, min(edge * 0.42, u_frameH * 0.07));
      float d = roundedBox(vec2(p.x, fy) - centre, halfSize, min(halfSize.x, halfSize.y) * 0.45);
      float hole = 1.0 - smoothstep(-0.7, 0.7, d);
      float halo = exp(-max(d, 0.0) / (edge * 0.16)) * 0.16 * (1.0 - hole);
      color = mix(color, PAPER * 0.96, hole) + PAPER * halo;
    }
    gl_FragColor = vec4(color, 1.0);
    return;
  }

  // Frame line between two pictures.
  if (fy > u_frameH) { gl_FragColor = vec4(BASE * 0.7, 1.0); return; }

  vec2 uv = vec2((p.x - u_strip.y) / (u_strip.z - u_strip.y), fy / u_frameH);
  // Darkening, as premultiplied black: vignette toward the corners plus the shutter's flicker.
  float vignette = smoothstep(0.45, 1.15, length((uv - 0.5) * vec2(1.0, 1.2)) * 1.3) * 0.38;
  float dark = clamp(vignette + u_flicker, 0.0, 1.0);
  vec4 color = vec4(0.0, 0.0, 0.0, dark);

  // Grain: light and dark specks about 1.4 css px across, new every film frame.
  float g = hash(floor(css * 0.8) + vec2(u_seed * 37.0, u_seed * 91.0)) - 0.5;
  float grain = abs(g) * 0.12;
  color = vec4((g > 0.0 ? PAPER : vec3(0.0)) * grain, grain) + color * (1.0 - grain);

  // Dust: up to three soft dark specks, placed anew every film frame.
  float dust = 0.0;
  for (int i = 0; i < 3; i++) {
    float d = length(p - u_dust[i].xy);
    dust = max(dust, (1.0 - smoothstep(u_dust[i].z * 0.5, u_dust[i].z, d)) * 0.6);
  }
  color = vec4(0.0, 0.0, 0.0, dust) + color * (1.0 - dust);

  // Light leak: warm light bleeding in from the right edge, strongest at its height.
  float reach = smoothstep(0.5, 1.0, uv.x + 0.12 * sin(uv.y * 5.0 + u_seed * 0.37));
  float leak = u_leak.x * reach * exp(-pow((uv.y - u_leak.y) * 2.4, 2.0)) * 0.5;
  vec3 warm = mix(vec3(0.71, 0.27, 0.17), vec3(0.98, 0.78, 0.52), reach * reach);
  color = vec4(warm * leak, leak) + color * (1.0 - leak);

  gl_FragColor = color;
}
`;

export class FilmPass {
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private scale = 1;

  private constructor(
    private readonly gl: WebGLRenderingContext,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const program = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['u_res', 'u_scale', 'u_strip', 'u_offset', 'u_pitch', 'u_frameH', 'u_frames', 'u_weave', 'u_seed', 'u_flicker', 'u_leak', 'u_dust']) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
  }

  /** Returns null where WebGL is unavailable; the reel then runs without the projector pass. */
  static create(canvas: HTMLCanvasElement): FilmPass | null {
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return null;
    try {
      return new FilmPass(gl, canvas);
    } catch {
      return null;
    }
  }

  resize(width: number, height: number, scale: number): void {
    this.scale = scale;
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(state: FilmState): void {
    const { gl, uniforms: u } = this;
    gl.uniform2f(u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_scale, this.scale);
    gl.uniform4f(u.u_strip, ...state.strip);
    gl.uniform1f(u.u_offset, state.offset);
    gl.uniform1f(u.u_pitch, state.pitch);
    gl.uniform1f(u.u_frameH, state.frameHeight);
    gl.uniform1f(u.u_frames, state.frames);
    gl.uniform2f(u.u_weave, ...state.weave);
    gl.uniform1f(u.u_seed, state.seed);
    gl.uniform1f(u.u_flicker, state.flicker);
    gl.uniform2f(u.u_leak, ...state.leak);
    gl.uniform3fv(u.u_dust, state.dust);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
