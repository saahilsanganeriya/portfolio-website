import * as THREE from 'three';
import blendGlsl from '../shaders/window_blend.glsl?raw';
import landFrag from '../shaders/window.frag.glsl?raw';
import landVert from '../shaders/window_land.vert.glsl?raw';
import skyFrag from '../shaders/window_sky.frag.glsl?raw';
import skyVert from '../shaders/window_sky.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import { CITIES, type CityId } from './daylight';
import { loadHand, seedOf, writeHand } from './handwriting';
import { BLEND_HALF_WIDTH_M, completeDome, horizons, skyColour, type SkyFrame } from './sky';
import type { WindowMotifNode, WindowSkyNode, WindowViewNode } from './nodes';
import type { TextureStore } from './textures';

// The window looks out on San Francisco (left) and New Delhi (right), both by day. One sky spans them (window_sky): its
// colour runs from San Francisco's day sky to Delhi's with no seam, worked out once per vertex (sky.ts). Each city's
// land is its day picture, loaded with the room. Across the sky a small plane flies a dotted arc from New Delhi to San
// Francisco, the two names written in his hand (window_motif); under reduced motion the plane holds still.

const ROOM_PATH = '/room/';
// Without the sky's markers (an older room), how far in front of the window the eye stands.
const FALLBACK_EYE_M = 3;
const CITY_ORDER: CityId[] = ['sf', 'delhi'];

export interface CityState {
  name: string;
  /** Whether its day picture has arrived. */
  loaded: boolean;
}

export interface MotifState {
  drawn: boolean;
  /** Where the plane is on the arc: 0 over New Delhi, 1 over San Francisco; -1 while it is off the arc. */
  plane: number;
  moving: boolean;
}

const vec3 = () => new THREE.Vector3();
const withBlend = (glsl: string) => glsl.replace('#include <window_blend>', blendGlsl);

interface View {
  node: WindowViewNode;
  material: THREE.ShaderMaterial;
  day: THREE.Texture | null;
}

export class WindowView {
  private readonly views: View[];
  private readonly frame: SkyFrame;
  private readonly skyMaterial: THREE.ShaderMaterial | null;
  /** Grid cells of the dome the build had culled and this filled, and the triangles added (0 for a whole dome). */
  private readonly skyFilled = { cells: 0, triangles: 0 };
  private readonly motif: Motif | null;

  constructor(
    nodes: WindowViewNode[],
    skyNode: WindowSkyNode | null,
    motifNode: WindowMotifNode | null,
    private readonly textures: TextureStore,
    options: { reducedMotion?: boolean } = {},
  ) {
    this.frame = placeBlend(nodes, skyNode);
    const [sfHorizon, delhiHorizon] = horizons();
    const shared = {
      uCentre: { value: this.frame.centre },
      uEye: { value: this.frame.eye },
      uOut: { value: this.frame.out },
      uRight: { value: this.frame.right },
      uBand: { value: this.frame.band },
      uHorizonSide: { value: [new THREE.Vector3(...sfHorizon), new THREE.Vector3(...delhiHorizon)] },
      uHaze: { value: farLand(nodes, this.frame) },
    };
    this.views = nodes.map((node) => {
      const old = node.mesh.material as THREE.MeshBasicMaterial;
      // The room's own material carries the day picture when the exporter embedded it (not a deferred placeholder).
      const deferred = old.map?.userData.deferredWindowPicture === true;
      if (deferred) old.map!.dispose();
      const day = deferred ? null : (old.map ?? null);
      const material = new THREE.ShaderMaterial({
        vertexShader: withBlend(landVert),
        fragmentShader: landFrag,
        uniforms: { uDay: { value: day }, ...shared },
      });
      node.mesh.material = material;
      return { node, material, day };
    });
    if (skyNode) {
      const mask = skyNode.mesh.parent?.getObjectByName('window_view_mask');
      skyNode.mesh.updateWorldMatrix(true, false);
      const done = completeDome(skyNode.mesh.geometry, skyNode.mesh.matrixWorld, this.frame, mask ? new THREE.Box3().setFromObject(mask) : null);
      if (done.geometry !== skyNode.mesh.geometry) {
        skyNode.mesh.geometry.dispose();
        skyNode.mesh.geometry = done.geometry;
      }
      Object.assign(this.skyFilled, { cells: done.filledCells, triangles: done.addedTriangles });
    }
    this.skyMaterial = skyNode ? paintSky(skyNode.mesh, this.frame) : null;
    this.motif = motifNode ? new Motif(motifNode, options.reducedMotion ?? false) : null;
  }

  /** Loads each city's day picture and draws the motif before the room is shown. */
  async load() {
    await Promise.all([...this.views.map((view) => this.fetch(view)), this.motif?.draw()]);
  }

  update(dt: number) {
    this.motif?.update(Math.max(dt, 0));
  }

  /** "San Francisco and New Delhi" */
  label() {
    return CITY_ORDER.map((id) => CITIES[id].name).join(' and ');
  }

  state(): { sf?: CityState; delhi?: CityState; motif: MotifState | null; sky: boolean; skyFilled: { cells: number; triangles: number } } {
    const cities = Object.fromEntries(this.views.map((v) => [v.node.city, { name: CITIES[v.node.city].name, loaded: v.day != null }]));
    return { ...cities, motif: this.motif?.state() ?? null, sky: this.skyMaterial != null, skyFilled: { ...this.skyFilled } };
  }

  dispose() {
    this.skyMaterial?.dispose();
    this.motif?.dispose();
    for (const view of this.views) {
      view.material.dispose();
      view.day?.dispose();
    }
  }

  private async fetch(view: View) {
    const file = view.node.dayFile;
    if (view.day || !file) return;
    try {
      view.day = await this.textures.ktx2(ROOM_PATH + file);
      view.material.uniforms.uDay.value = view.day;
    } catch (error) {
      console.warn(`room: the window's ${view.node.city} view did not load`, error);
    }
  }
}

/** Where the sky's directions start, the eye the blend is seen from, and the window's out and right directions. */
function placeBlend(nodes: WindowViewNode[], skyNode: WindowSkyNode | null): SkyFrame {
  const centre = vec3();
  const eye = vec3();
  if (skyNode) {
    centre.copy(skyNode.centre);
    eye.copy(skyNode.eye);
  } else {
    // An older room: the window's seam between the halves, facing the room's front (glTF +Z), the eye in front of it.
    const bounds = nodes.map((n) => new THREE.Box3().setFromObject(n.mesh));
    const all = bounds.reduce((box, b) => box.union(b), new THREE.Box3());
    const sf = bounds[nodes.findIndex((n) => n.city === 'sf')];
    const delhi = bounds[nodes.findIndex((n) => n.city === 'delhi')];
    centre.set(sf && delhi ? (sf.max.x + delhi.min.x) / 2 : all.getCenter(vec3()).x, all.min.y, all.max.z);
    eye.copy(centre).add(new THREE.Vector3(0, 0, FALLBACK_EYE_M * WORLD_SCALE));
  }
  const out = vec3().subVectors(centre, eye).setY(0).normalize();
  const right = vec3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
  return { centre, eye, out, right, band: BLEND_HALF_WIDTH_M * WORLD_SCALE };
}

/** The far land hazes into the sky's horizon: from about half the land's depth behind the window to its far edge. */
function farLand(nodes: WindowViewNode[], frame: SkyFrame) {
  let far = 0;
  for (const node of nodes) {
    const box = new THREE.Box3().setFromObject(node.mesh);
    for (const x of [box.min.x, box.max.x])
      for (const z of [box.min.z, box.max.z]) far = Math.max(far, new THREE.Vector3(x, frame.centre.y, z).sub(frame.centre).dot(frame.out));
  }
  return new THREE.Vector2(far * 0.45, far);
}

/** Gives every vertex of the dome its sky colour (it never changes) and a material that only draws it. */
function paintSky(mesh: THREE.Mesh, frame: SkyFrame) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const p = vec3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    colours.set(skyColour(p, frame), i * 3);
  }
  mesh.geometry.setAttribute('aSky', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag });
  mesh.material = material;
  return material;
}

// ---- the motif: a plane on a dotted arc from New Delhi to San Francisco ----

// The arc on the motif's canvas (fractions of its width and height): New Delhi's end, the control point, San
// Francisco's end. The plane crosses in FLIGHT_S, then is off the arc for GROUND_S; under reduced motion it holds at
// PARKED_AT.
const ARC: [number, number][] = [[0.87, 0.64], [0.5, -0.04], [0.13, 0.64]];
const MOTIF_PX = 2048;
const FLIGHT_S = 48;
const GROUND_S = 5;
const PARKED_AT = 0.62;
// Dark slate, as a plane and pencil marks read against a day sky, with a faint pale halo where the sky is deep blue.
const INK = '#1f2b3a';
const HALO = 'rgba(255, 255, 255, 0.4)';

function arcPoint(s: number, w: number, h: number): [number, number] {
  const [a, b, c] = ARC;
  const u = 1 - s;
  return [(u * u * a[0] + 2 * u * s * b[0] + s * s * c[0]) * w, (u * u * a[1] + 2 * u * s * b[1] + s * s * c[1]) * h];
}

function arcTangent(s: number, w: number, h: number): [number, number] {
  const [a, b, c] = ARC;
  return [(2 * (1 - s) * (b[0] - a[0]) + 2 * s * (c[0] - b[0])) * w, (2 * (1 - s) * (b[1] - a[1]) + 2 * s * (c[1] - b[1])) * h];
}

function canvasTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The plane seen from below, nose along +x: fuselage, swept wings and tailplane, in `size` px. */
function drawPlane(ctx: CanvasRenderingContext2D, size: number) {
  const s = size / 160;
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(80, 80);
  ctx.beginPath();
  ctx.moveTo(62, 0);
  ctx.quadraticCurveTo(60, -7, 48, -7.5);
  ctx.lineTo(10, -7.5);
  ctx.lineTo(-8, -58);
  ctx.lineTo(-20, -58);
  ctx.lineTo(-10, -7.5);
  ctx.lineTo(-44, -7);
  ctx.lineTo(-54, -24);
  ctx.lineTo(-62, -24);
  ctx.lineTo(-58, -5);
  ctx.lineTo(-64, 0);
  ctx.lineTo(-58, 5);
  ctx.lineTo(-62, 24);
  ctx.lineTo(-54, 24);
  ctx.lineTo(-44, 7);
  ctx.lineTo(-10, 7.5);
  ctx.lineTo(-20, 58);
  ctx.lineTo(-8, 58);
  ctx.lineTo(10, 7.5);
  ctx.lineTo(48, 7.5);
  ctx.quadraticCurveTo(60, 7, 62, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

class Motif {
  private readonly arc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly width: number;
  private readonly height: number;
  private readonly canvasH: number;
  private clock = PARKED_AT * FLIGHT_S;
  private drawn = false;
  private s = PARKED_AT;

  constructor(
    node: WindowMotifNode,
    private readonly still: boolean,
  ) {
    this.width = node.widthM;
    this.height = node.heightM;
    this.canvasH = Math.round((MOTIF_PX * this.height) / this.width);
    const material = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    this.arc = new THREE.Mesh(new THREE.PlaneGeometry(this.width, this.height), material());
    this.arc.name = 'window_motif_arc';
    const planeSize = 0.052 * (this.width / 1.24);
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), material());
    this.plane.name = 'window_motif_plane';
    this.plane.position.z = 0.002;
    node.anchor.add(this.arc, this.plane);
    this.place(PARKED_AT, 1);
  }

  async draw() {
    await loadHand();
    const arc = document.createElement('canvas');
    arc.width = MOTIF_PX;
    arc.height = this.canvasH;
    const ctx = arc.getContext('2d')!;
    const [w, h] = [arc.width, arc.height];
    ctx.shadowColor = HALO;
    ctx.shadowBlur = 6;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    // Dots every GAP px along the arc, measured along its length, clear of the end markers.
    const GAP = w * 0.0118;
    const steps = 2000;
    let travelled = 0;
    let next = GAP * 2.2;
    let [px, py] = arcPoint(0, w, h);
    let length = 0;
    for (let i = 1; i <= steps; i++) {
      const [x, y] = arcPoint(i / steps, w, h);
      length += Math.hypot(x - px, y - py);
      [px, py] = [x, y];
    }
    [px, py] = arcPoint(0, w, h);
    for (let i = 1; i <= steps; i++) {
      const [x, y] = arcPoint(i / steps, w, h);
      travelled += Math.hypot(x - px, y - py);
      [px, py] = [x, y];
      if (travelled >= next && travelled <= length - GAP * 2.2) {
        ctx.beginPath();
        ctx.arc(x, y, w * 0.0017, 0, Math.PI * 2);
        ctx.globalAlpha = 0.85;
        ctx.fill();
        next += GAP;
      }
    }
    ctx.globalAlpha = 1;
    const names: [string, number][] = [[CITIES.delhi.name, 0], [CITIES.sf.name, 1]];
    for (const [name, s] of names) {
      const [x, y] = arcPoint(s, w, h);
      ctx.lineWidth = w * 0.0017;
      ctx.beginPath();
      ctx.arc(x, y, w * 0.0049, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, w * 0.0017, 0, Math.PI * 2);
      ctx.fill();
      writeHand(ctx, name, x, y + h * 0.17, {
        size: w * 0.033,
        slant: 0.06,
        turn: s === 0 ? -0.025 : 0.02,
        colour: INK,
        weight: 0.045,
        maxWidth: w * 0.24,
        maxLines: 1,
        lineHeight: 1.1,
        seed: seedOf(name),
      });
    }
    const planeCanvas = document.createElement('canvas');
    planeCanvas.width = planeCanvas.height = 160;
    const pctx = planeCanvas.getContext('2d')!;
    pctx.shadowColor = HALO;
    pctx.shadowBlur = 4;
    pctx.fillStyle = INK;
    drawPlane(pctx, 160);
    this.arc.material.map = canvasTexture(arc);
    this.plane.material.map = canvasTexture(planeCanvas);
    for (const m of [this.arc.material, this.plane.material]) {
      m.opacity = 1;
      m.needsUpdate = true;
    }
    this.drawn = true;
    this.place(this.s, 1);
  }

  update(dt: number) {
    if (this.still || !this.drawn) return;
    this.clock = (this.clock + dt) % (FLIGHT_S + GROUND_S);
    const s = this.clock / FLIGHT_S;
    if (s > 1) {
      this.s = -1;
      this.plane.visible = false;
      return;
    }
    const fade = Math.min(1, s / 0.04, (1 - s) / 0.04);
    this.place(s, fade);
  }

  state(): MotifState {
    return { drawn: this.drawn, plane: Number(this.s.toFixed(3)), moving: !this.still && this.drawn };
  }

  dispose() {
    for (const mesh of [this.arc, this.plane]) {
      mesh.material.map?.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
  }

  /** Puts the plane at `s` along the arc, nose along it, at opacity `fade`. */
  private place(s: number, fade: number) {
    this.s = s;
    const [x, y] = arcPoint(s, MOTIF_PX, this.canvasH);
    const [dx, dy] = arcTangent(s, MOTIF_PX, this.canvasH);
    this.plane.position.x = (x / MOTIF_PX - 0.5) * this.width;
    this.plane.position.y = (0.5 - y / this.canvasH) * this.height;
    this.plane.rotation.z = Math.atan2(-dy * (this.height / this.canvasH), dx * (this.width / MOTIF_PX));
    this.plane.visible = true;
    if (this.drawn) this.plane.material.opacity = fade;
  }
}
