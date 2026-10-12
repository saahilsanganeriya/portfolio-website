import * as THREE from 'three';
import pageFrag from '../shaders/page.frag.glsl?raw';
import pageVert from '../shaders/page.vert.glsl?raw';
import { WORLD_SCALE } from '../Application/RoomModel';
import { albumPages, pageLabel, PageCache, type Page } from './albumPages';
import type { PhotoSection } from './photographs';
import type { TextureStore } from './textures';

// The photo album: clicked on the desk, it rises to the reader in front of the desk framing (album_open_anchor),
// its cover swings open, and its pages turn one at a time: the hinge and the free edge each follow a spring, so the
// edge leads off the page, the page arches over and settles with a small bounce. Right half or → turns on, left half
// or ← turns back, a click beside it or Escape closes it. Reduced motion cuts every move.

export type AlbumState = 'closed' | 'opening' | 'open' | 'turning' | 'closing';

export interface AlbumHost {
  collection(): Promise<PhotoSection[]>;
  readonly textures: TextureStore;
  readonly reducedMotion: boolean;
  announce(text: string): void;
  /** While the album is open it takes the stage's clicks and keys, and the monitor stops taking the pointer. */
  setCapturing(capturing: boolean): void;
}

export interface AlbumNode {
  closed: THREE.Object3D | null;
  anchor: THREE.Vector3;
  width: number;
  height: number;
}

type TurnKind = 'open' | 'next' | 'prev' | 'close';

const COLUMNS = 24;
const RISE_S = 0.7;
const BOARD = 0.004;
const BOARD_MARGIN = 0.008;
const BLOCK_MIN = 0.002;
const BLOCK_MAX = 0.014;
const CLOTH = new THREE.Color('#3b2a1e');
const EDGES = new THREE.Color('#d9ccb3');
// The hinge springs a little under critical damping (the page settles with a bounce); the free edge is stiffer,
// so it leads the page over and the page arches.
const HINGE = { stiffness: 40, damping: 9.5 };
const EDGE = { stiffness: 110, damping: 14.5 };
const ARCH = 1.6;
const STEP_S = 1 / 120;
// The open book takes at most this share of the desk framing's height, so its edges never leave the view.
const VIEW_SHARE = 0.78;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function pageMaterial(spineU: number, twoSided: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: pageVert,
    fragmentShader: pageFrag,
    uniforms: {
      uFront: { value: null },
      uBack: { value: null },
      uTwoSided: { value: twoSided ? 1 : 0 },
      uSpineU: { value: spineU },
      uLight: { value: 0.86 },
    },
    side: twoSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export class Album {
  state: AlbumState = 'closed';
  spread = 0;
  private pages: Page[] = [];
  private cache: PageCache | null = null;
  private readonly group = new THREE.Group();
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly left: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly right: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly sheet: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly leftBoard: THREE.Mesh;
  private readonly rightBoard: THREE.Mesh;
  private readonly leftBlock: THREE.Mesh;
  private readonly rightBlock: THREE.Mesh;
  private readonly boardMaterial = new THREE.MeshBasicMaterial({ color: CLOTH.clone().multiplyScalar(0.8) });
  private readonly edgeMaterial = new THREE.MeshBasicMaterial({ color: EDGES.clone().multiplyScalar(0.75) });
  private readonly openPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly closedPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  private readonly raycaster = new THREE.Raycaster();
  private abort = new AbortController();
  private camera: THREE.Camera | null = null;
  private turn: { kind: TurnKind; target: number; theta: number; omega: number; psi: number; psiOmega: number } | null = null;
  private rise: { from: 'closed' | 'open'; t: number } | null = null;
  private queued: TurnKind | null = null;

  constructor(
    private readonly node: AlbumNode,
    facing: THREE.Vector3,
    fovDeg: number,
    scene: THREE.Scene,
    private readonly container: HTMLElement,
    private readonly host: AlbumHost,
  ) {
    const P = node.width / 2 / WORLD_SCALE;
    const H = node.height / WORLD_SCALE;
    this.pageWidth = P;
    this.pageHeight = H;

    // Book space, in metres: x to the right, y up, z toward the reader; the spine runs up the y axis.
    this.left = new THREE.Mesh(new THREE.PlaneGeometry(P, H), pageMaterial(1, false));
    this.left.position.x = -P / 2;
    this.right = new THREE.Mesh(new THREE.PlaneGeometry(P, H), pageMaterial(0, false));
    this.right.position.x = P / 2;
    const sheetGeometry = new THREE.PlaneGeometry(P, H, COLUMNS, 1);
    sheetGeometry.translate(P / 2, 0, 0);
    this.sheet = new THREE.Mesh(sheetGeometry, pageMaterial(0, true));
    this.sheet.frustumCulled = false;
    const board = () => new THREE.Mesh(new THREE.BoxGeometry(P + BOARD_MARGIN, H + 2 * BOARD_MARGIN, BOARD), this.boardMaterial);
    this.leftBoard = board();
    this.leftBoard.position.set(-(P + BOARD_MARGIN) / 2, 0, -BOARD / 2);
    this.rightBoard = board();
    this.rightBoard.position.set((P + BOARD_MARGIN) / 2, 0, -BOARD / 2);
    const block = () => new THREE.Mesh(new THREE.BoxGeometry(P - 0.002, H - 0.002, 1), this.edgeMaterial);
    this.leftBlock = block();
    this.rightBlock = block();
    this.group.add(this.left, this.right, this.sheet, this.leftBoard, this.rightBoard, this.leftBlock, this.rightBlock);
    this.group.scale.setScalar(WORLD_SCALE);
    this.group.visible = false;
    scene.add(this.group);

    // Open: on the line from the desk framing through the anchor, far enough to fit the view, facing the framing.
    // Closed: lying where the album lies on the desk.
    const toAnchor = node.anchor.clone().sub(facing);
    const fit = (node.height + 2 * BOARD_MARGIN * WORLD_SCALE) / (VIEW_SHARE * 2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.openPose.position.copy(facing).addScaledVector(toAnchor.normalize(), Math.max(fit, node.anchor.distanceTo(facing)));
    const look = new THREE.Object3D();
    look.position.copy(this.openPose.position);
    look.lookAt(facing);
    this.openPose.quaternion.copy(look.quaternion);
    if (node.closed) {
      const box = new THREE.Box3().setFromObject(node.closed);
      node.closed.getWorldQuaternion(this.closedPose.quaternion);
      this.closedPose.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      const spineOffset = new THREE.Vector3(-P / 2, 0, 0).applyQuaternion(this.closedPose.quaternion).multiplyScalar(WORLD_SCALE);
      this.closedPose.position.copy(box.getCenter(new THREE.Vector3())).add(spineOffset);
      this.closedPose.position.y = box.max.y;
    } else {
      this.closedPose.position.copy(this.openPose.position);
      this.closedPose.quaternion.copy(this.openPose.quaternion);
    }
    this.layoutBlocks();
  }

  get isOpen() {
    return this.state !== 'closed';
  }

  get spreads() {
    return Math.ceil((this.pages.length + 1) / 2);
  }

  /** Whether something is moving that needs frames drawn (also while motion is paused: the visitor started it). */
  get animating() {
    return this.turn !== null || this.rise !== null;
  }

  probe() {
    return {
      state: this.state,
      spread: this.spread,
      spreads: this.spreads,
      pages: this.pages.length,
      left: this.spread === 0 ? 'endpaper' : pageLabel(this.pages[this.spread * 2 - 1] ?? null),
      right: pageLabel(this.pages[this.spread * 2] ?? null),
      cached: this.cache?.size ?? 0,
    };
  }

  /** Screen point of the left or right page (client pixels), for tests. */
  point(name: 'album_left' | 'album_right', rect: DOMRect): { x: number; y: number } | null {
    if (!this.camera || !this.isOpen) return null;
    const local = new THREE.Vector3(((name === 'album_left' ? -1 : 1) * this.pageWidth) / 2, 0, 0.01);
    const p = this.group.localToWorld(local).project(this.camera);
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  async open() {
    if (this.state !== 'closed') return;
    this.state = 'opening';
    this.listen();
    this.host.setCapturing(true);
    if (!this.cache) {
      try {
        this.pages = albumPages(await this.host.collection());
      } catch (error) {
        console.warn('room: the album could not load the photographs', error);
        this.host.setCapturing(false);
        this.closed();
        this.host.announce('The photo album could not open. The photographs are in SaahilOS, in A Narrative in a Frame.');
        return;
      }
      this.cache = new PageCache(this.pages, this.host.textures, this.pageWidth / this.pageHeight);
    }
    this.spread = 0;
    this.layoutBlocks();
    this.cache.prefetch([0, 1, 2]);
    if (this.node.closed) this.node.closed.visible = false;
    this.group.visible = true;
    this.setStatic(-1, 0);
    this.left.visible = this.leftBoard.visible = this.leftBlock.visible = false;
    this.startTurn('open');
    if (this.host.reducedMotion) this.finishMotion();
    else {
      this.rise = { from: 'closed', t: 0 };
      this.applyPose(0);
    }
    this.host.announce(`Photo album, open at the title page. ${this.spreads} spreads; right arrow turns the page, Escape closes it.`);
  }

  next() {
    this.request('next');
  }

  prev() {
    this.request('prev');
  }

  close() {
    this.request('close');
  }

  update(dt: number, camera: THREE.Camera) {
    this.camera = camera;
    if (this.state === 'closed') return;
    if (this.rise) {
      this.rise.t += dt / RISE_S;
      const t = Math.min(1, this.rise.t);
      this.applyPose(this.rise.from === 'closed' ? easeInOut(t) : 1 - easeInOut(t));
      if (t >= 1) {
        const from = this.rise.from;
        this.rise = null;
        if (from === 'open') this.closed();
      }
      // The cover waits until the book has risen.
      if (this.rise?.from === 'closed') return;
    }
    if (this.turn) this.stepTurn(dt);
  }

  dispose() {
    this.abort.abort();
    this.cache?.dispose();
    for (const mesh of [this.left, this.right, this.sheet]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const mesh of [this.leftBoard, this.rightBoard, this.leftBlock, this.rightBlock]) mesh.geometry.dispose();
    this.boardMaterial.dispose();
    this.edgeMaterial.dispose();
    this.group.removeFromParent();
  }

  // ---- turning ----

  private request(kind: TurnKind) {
    if (this.state === 'closed' || this.state === 'closing') return;
    if (kind === 'next' && this.spread >= this.spreads - 1) return;
    if (kind === 'prev' && this.spread <= 0) return;
    // While it opens (its pages may still be on the way) a request waits for the cover to land.
    if (this.state === 'opening') {
      this.queued = kind;
      return;
    }
    // A turn asked for mid-turn lands the moving one now, then starts.
    if (this.turn || this.rise) this.finishMotion();
    this.startTurn(kind);
    if (this.host.reducedMotion) this.finishMotion();
  }

  private startTurn(kind: TurnKind) {
    const forward = kind === 'open' || kind === 'next';
    const start = forward ? 0 : Math.PI;
    this.turn = { kind, target: forward ? Math.PI : 0, theta: start, omega: 0, psi: start, psiOmega: 0 };
    const k = this.spread;
    const sheet = this.sheet.material.uniforms;
    const cache = this.cache!;
    if (kind === 'open') {
      sheet.uFront.value = cache.cover;
      sheet.uBack.value = cache.get(-1);
    } else if (kind === 'next') {
      sheet.uFront.value = cache.get(2 * k);
      sheet.uBack.value = cache.get(2 * k + 1);
      this.setStatic(2 * k - 1, 2 * k + 2);
      this.state = 'turning';
      cache.prefetch([2 * k + 3, 2 * k + 4]);
    } else if (kind === 'prev') {
      sheet.uFront.value = cache.get(2 * k - 2);
      sheet.uBack.value = cache.get(2 * k - 1);
      this.setStatic(2 * k - 3, 2 * k);
      this.state = 'turning';
      cache.prefetch([2 * k - 4, 2 * k - 5]);
    } else {
      sheet.uFront.value = cache.cover;
      sheet.uBack.value = cache.get(2 * k - 1);
      this.left.visible = this.leftBoard.visible = this.leftBlock.visible = false;
      this.state = 'closing';
      this.host.setCapturing(false);
      this.host.announce('Photo album closed.');
    }
    this.sheet.visible = true;
    this.bend(start, start);
  }

  private stepTurn(dt: number) {
    const turn = this.turn!;
    for (let t = 0; t < dt; t += STEP_S) {
      const h = Math.min(STEP_S, dt - t);
      turn.omega += (HINGE.stiffness * (turn.target - turn.theta) - HINGE.damping * turn.omega) * h;
      turn.theta += turn.omega * h;
      turn.psiOmega += (EDGE.stiffness * (turn.target - turn.psi) - EDGE.damping * turn.psiOmega) * h;
      turn.psi += turn.psiOmega * h;
    }
    this.bend(turn.theta, turn.psi);
    const settled =
      Math.abs(turn.target - turn.theta) < 0.003 &&
      Math.abs(turn.omega) < 0.03 &&
      Math.abs(turn.target - turn.psi) < 0.003 &&
      Math.abs(turn.psiOmega) < 0.03;
    if (settled) this.landTurn();
  }

  /** Lands a turn: the sheet lies flat on its new side and the spread underneath takes its place. */
  private landTurn() {
    const turn = this.turn!;
    this.turn = null;
    this.sheet.visible = false;
    if (turn.kind === 'open') {
      this.state = 'open';
      this.showSpread();
    } else if (turn.kind === 'next' || turn.kind === 'prev') {
      this.spread += turn.kind === 'next' ? 1 : -1;
      this.state = 'open';
      this.showSpread();
      this.announceSpread();
    } else {
      // Closed on the reader's side: now it goes back down to the desk.
      this.setStatic(null, null);
      this.sheet.visible = true;
      this.bend(0, 0);
      this.sheet.material.uniforms.uFront.value = this.cache!.cover;
      if (this.host.reducedMotion) this.closed();
      else this.rise = { from: 'open', t: 0 };
    }
    const queued = this.queued;
    this.queued = null;
    if (queued) this.request(queued);
  }

  /** Lands whatever is moving now (a turn asked for mid-turn, or reduced motion). */
  private finishMotion() {
    if (this.rise?.from === 'closed') {
      this.rise = null;
      this.applyPose(1);
    }
    if (this.turn) {
      this.turn.theta = this.turn.psi = this.turn.target;
      this.landTurn();
    }
    if (this.rise?.from === 'open') {
      this.rise = null;
      this.closed();
    }
  }

  private closed() {
    this.state = 'closed';
    this.group.visible = false;
    if (this.node.closed) this.node.closed.visible = true;
    this.abort.abort();
  }

  private showSpread() {
    this.layoutBlocks();
    this.setStatic(2 * this.spread - 1, 2 * this.spread);
    this.left.visible = this.leftBoard.visible = this.leftBlock.visible = true;
    this.cache?.prefetch([2 * this.spread + 1, 2 * this.spread + 2, 2 * this.spread - 2, 2 * this.spread - 3]);
  }

  private announceSpread() {
    const [l, r] = [this.pages[2 * this.spread - 1], this.pages[2 * this.spread]];
    const describe = (page: Page | undefined) =>
      page?.kind === 'photo' ? `${page.photo.title}, ${page.photo.year}. ${page.photo.caption}` : pageLabel(page ?? null);
    this.host.announce(`Spread ${this.spread + 1} of ${this.spreads}: ${[l, r].filter(Boolean).map(describe).join(' — ')}`);
  }

  /** Static page textures by page index (null hides the page). */
  private setStatic(leftIndex: number | null, rightIndex: number | null) {
    const cache = this.cache!;
    this.left.visible = leftIndex !== null;
    this.right.visible = rightIndex !== null;
    if (leftIndex !== null) this.left.material.uniforms.uFront.value = cache.get(leftIndex);
    if (rightIndex !== null) this.right.material.uniforms.uFront.value = cache.get(rightIndex);
  }

  /** The page blocks thicken on the side already read. */
  private layoutBlocks() {
    const read = this.spreads > 1 ? this.spread / (this.spreads - 1) : 0;
    const thickness = (share: number) => BLOCK_MIN + (BLOCK_MAX - BLOCK_MIN) * share;
    const [leftDepth, rightDepth] = [thickness(read), thickness(1 - read)];
    for (const [block, page, depth, side] of [
      [this.leftBlock, this.left, leftDepth, -1],
      [this.rightBlock, this.right, rightDepth, 1],
    ] as const) {
      block.scale.z = depth;
      block.position.set((side * this.pageWidth) / 2, 0, depth / 2);
      page.position.z = depth + 0.0003;
    }
  }

  /**
   * Shapes the turning sheet: the hinge stands at `theta` (0 flat on the right, PI flat on the left) and the free
   * edge at `psi`; the angle along the page eases from one to the other, and the page is integrated along its length.
   */
  private bend(theta: number, psi: number) {
    const P = this.pageWidth;
    const H = this.pageHeight;
    const positions = this.sheet.geometry.attributes.position as THREE.BufferAttribute;
    const hingeZ = THREE.MathUtils.lerp(this.right.position.z, this.left.position.z, THREE.MathUtils.clamp(theta / Math.PI, 0, 1)) + 0.0004;
    const ds = P / COLUMNS;
    let x = 0;
    let z = 0;
    for (let i = 0; i <= COLUMNS; i++) {
      if (i > 0) {
        const u = (i - 0.5) / COLUMNS;
        const phi = THREE.MathUtils.clamp(theta + (psi - theta) * u ** ARCH, 0, Math.PI);
        x += Math.cos(phi) * ds;
        z += Math.sin(phi) * ds;
      }
      // PlaneGeometry(…, COLUMNS, 1): row 0 is the top edge, row 1 the bottom, COLUMNS + 1 vertices each.
      positions.setXYZ(i, x, H / 2, z + hingeZ);
      positions.setXYZ(COLUMNS + 1 + i, x, -H / 2, z + hingeZ);
    }
    positions.needsUpdate = true;
    this.sheet.geometry.computeVertexNormals();
    this.sheet.geometry.computeBoundingSphere();
  }

  /** 0: lying closed on the desk; 1: open in front of the reader. */
  private applyPose(t: number) {
    this.group.position.lerpVectors(this.closedPose.position, this.openPose.position, t);
    this.group.quaternion.slerpQuaternions(this.closedPose.quaternion, this.openPose.quaternion, t);
  }

  // ---- input while open ----

  private listen() {
    if (this.abort.signal.aborted) this.abort = new AbortController();
    const signal = this.abort.signal;
    // Capture phase on the stage: the room's own click handling (a glide back to the wide view) never sees these.
    this.container.addEventListener(
      'click',
      (event) => {
        if (this.state === 'closed' || this.state === 'closing') return;
        event.stopPropagation();
        event.preventDefault();
        const side = this.sideAt(event.clientX, event.clientY);
        if (side === 'right') this.next();
        else if (side === 'left') this.prev();
        else this.close();
      },
      { capture: true, signal },
    );
    this.container.addEventListener(
      'pointermove',
      (event) => {
        if (this.state === 'closed' || this.state === 'closing') return;
        this.container.style.cursor = this.sideAt(event.clientX, event.clientY) ? 'pointer' : 'zoom-out';
      },
      { capture: true, signal },
    );
    window.addEventListener(
      'keydown',
      (event) => {
        if (this.state === 'closed' || this.state === 'closing') return;
        const action = { ArrowRight: 'next', PageDown: 'next', ArrowLeft: 'prev', PageUp: 'prev', Escape: 'close' }[event.key];
        if (!action) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (action === 'next') this.next();
        else if (action === 'prev') this.prev();
        else this.close();
      },
      { capture: true, signal },
    );
    signal.addEventListener('abort', () => (this.container.style.cursor = ''));
  }

  private sideAt(clientX: number, clientY: number): 'left' | 'right' | null {
    if (!this.camera) return null;
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects([this.left, this.right, this.sheet, this.leftBoard, this.rightBoard], false)[0];
    if (!hit) return null;
    return this.group.worldToLocal(hit.point.clone()).x >= 0 ? 'right' : 'left';
  }
}
