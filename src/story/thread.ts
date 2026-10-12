// The thread that runs through the reel: a verlet rope of 60 points drawn as a thin shaded line in the accent colour.
// Springs carry both ends to each frame's hold points, the moving film drags it, and the pointer tugs it.

export interface Point {
  x: number;
  y: number;
}

const COUNT = 60;
const STEP = 1 / 60;
// Many small substeps with a few constraint passes each keep a 60-point rope from stretching under gravity, far better
// than many passes per step.
const SUBSTEPS = 12;
const ITERATIONS = 3;
const DAMPING = 0.98 ** (1 / SUBSTEPS);
// While placing the thread at rest, heavy damping settles it in a few hundred steps.
const SETTLE_DAMPING = 0.82 ** (1 / SUBSTEPS);
const PIN_STIFFNESS = 140;
const PIN_DAMPING = 2 * 0.62 * Math.sqrt(PIN_STIFFNESS);
// Below this many px of movement per step for half a second, the thread is at rest and the loop may sleep.
const REST_SPEED = 0.03;

const BODY = '#b4442c';
const SHADOW = 'rgba(10, 8, 7, 0.55)';
const HIGHLIGHT = 'rgba(232, 150, 118, 0.5)';

class Pin {
  pos: Point;
  vel: Point = { x: 0, y: 0 };
  target: Point;

  constructor(at: Point) {
    this.pos = { ...at };
    this.target = { ...at };
  }

  /** One spring step toward the target; returns the distance moved. */
  step(h: number): number {
    const ax = PIN_STIFFNESS * (this.target.x - this.pos.x) - PIN_DAMPING * this.vel.x;
    const ay = PIN_STIFFNESS * (this.target.y - this.pos.y) - PIN_DAMPING * this.vel.y;
    this.vel.x += ax * h;
    this.vel.y += ay * h;
    this.pos.x += this.vel.x * h;
    this.pos.y += this.vel.y * h;
    return Math.hypot(this.vel.x, this.vel.y) * h;
  }

  snap(): void {
    this.pos = { ...this.target };
    this.vel = { x: 0, y: 0 };
  }
}

export class Thread {
  private readonly x = new Float32Array(COUNT);
  private readonly y = new Float32Array(COUNT);
  private readonly px = new Float32Array(COUNT);
  private readonly py = new Float32Array(COUNT);
  private readonly lastX = new Float32Array(COUNT);
  private readonly lastY = new Float32Array(COUNT);
  private readonly ctx: CanvasRenderingContext2D;
  private readonly head = new Pin({ x: 0, y: 0 });
  private readonly tail = new Pin({ x: 0, y: 0 });
  private width = 0;
  private height = 0;
  private dpr = 1;
  private slack = 1.1;
  private rest = 1;
  private tied = false;
  private carry = 0;
  private filmDrag = 0;
  private tug = { x: 0, y: 0, dx: 0, dy: 0 };
  private stillTicks = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  get awake(): boolean {
    return this.stillTicks < 30;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  /** Where the two ends should be held, and how much thread hangs between them. */
  hold(head: Point, tail: Point, slack: number, tied: boolean): void {
    const moved = Math.abs(head.x - this.head.target.x) + Math.abs(head.y - this.head.target.y) +
      Math.abs(tail.x - this.tail.target.x) + Math.abs(tail.y - this.tail.target.y);
    this.head.target = head;
    this.tail.target = tail;
    this.slack = slack;
    this.tied = tied;
    if (moved > 0.5) this.stillTicks = 0;
  }

  /** Puts the thread at rest on its hold points, as if it had always hung there. */
  place(): void {
    this.head.snap();
    this.tail.snap();
    const a = this.head.pos;
    const b = this.tail.pos;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    this.rest = (span * this.slack) / (COUNT - 1);
    const sag = Math.sqrt((3 * span * span * (this.slack - 1)) / 8);
    for (let i = 0; i < COUNT; i++) {
      const t = i / (COUNT - 1);
      this.x[i] = this.px[i] = a.x + (b.x - a.x) * t;
      this.y[i] = this.py[i] = a.y + (b.y - a.y) * t + 4 * sag * t * (1 - t);
    }
    for (let i = 0; i < 60; i++) this.tick(STEP, SETTLE_DAMPING);
    this.px.set(this.x);
    this.py.set(this.y);
    this.stillTicks = 0;
  }

  /** The film moved by `dy` px: friction in the gate drags the thread along with it. */
  drag(dy: number): void {
    if (Math.abs(dy) < 0.01) return;
    this.filmDrag += dy;
    this.stillTicks = 0;
  }

  /** The pointer moved by (dx, dy) to (x, y); thread within reach is pulled along. */
  pull(x: number, y: number, dx: number, dy: number): void {
    this.tug.x = x;
    this.tug.y = y;
    this.tug.dx += dx;
    this.tug.dy += dy;
    this.stillTicks = 0;
  }

  /** Advances the simulation by `dt` seconds in fixed steps; returns whether the thread is still moving. */
  step(dt: number): boolean {
    this.carry = Math.min(this.carry + dt, 0.1);
    while (this.carry >= STEP) {
      this.tick(STEP);
      this.carry -= STEP;
    }
    return this.awake;
  }

  private tick(h: number, damping = DAMPING): void {
    const n = COUNT - 1;
    const pins = this.head.step(h) + this.tail.step(h);
    this.lastY.set(this.y);
    this.lastX.set(this.x);

    const span = Math.hypot(this.tail.target.x - this.head.target.x, this.tail.target.y - this.head.target.y);
    this.rest += ((span * this.slack) / n - this.rest) * Math.min(1, 6 * h);

    const sub = h / SUBSTEPS;
    const gravity = 1.6 * this.height * sub * sub;
    const reach = Math.max(36, this.height * 0.07);
    const drag = this.filmDrag * 0.05;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 1; i < n; i++) {
        const vx = (this.x[i] - this.px[i]) * damping;
        const vy = (this.y[i] - this.py[i]) * damping;
        this.px[i] = this.x[i];
        this.py[i] = this.y[i];
        this.x[i] += vx;
        this.y[i] += vy + gravity;
        if (s === 0) {
          this.y[i] += drag;
          if (this.tug.dx || this.tug.dy) {
            const d = Math.hypot(this.x[i] - this.tug.x, this.y[i] - this.tug.y);
            if (d < reach) {
              const w = (1 - d / reach) ** 2 * 0.7;
              this.x[i] += this.tug.dx * w;
              this.y[i] += this.tug.dy * w;
            }
          }
        }
      }
      this.constrain();
    }
    this.filmDrag = 0;
    this.tug.dx = this.tug.dy = 0;
    let motion = pins;
    for (let i = 1; i < n; i++) motion = Math.max(motion, Math.abs(this.x[i] - this.lastX[i]) + Math.abs(this.y[i] - this.lastY[i]));
    this.stillTicks = motion < REST_SPEED ? this.stillTicks + 1 : 0;
  }

  // Distance constraints, swept alternately from each end so corrections reach the middle quickly.
  private constrain(): void {
    const n = COUNT - 1;
    for (let k = 0; k < ITERATIONS; k++) {
      this.x[0] = this.head.pos.x;
      this.y[0] = this.head.pos.y;
      this.x[n] = this.tail.pos.x;
      this.y[n] = this.tail.pos.y;
      for (let j = 0; j < n; j++) {
        const i = k % 2 === 0 ? j : n - 1 - j;
        const dx = this.x[i + 1] - this.x[i];
        const dy = this.y[i + 1] - this.y[i];
        const d = Math.hypot(dx, dy) || 1e-6;
        const push = (d - this.rest) / d;
        const first = i === 0 ? 0 : i + 1 === n ? 1 : 0.5;
        this.x[i] += dx * push * first;
        this.y[i] += dy * push * first;
        this.x[i + 1] -= dx * push * (1 - first);
        this.y[i + 1] -= dy * push * (1 - first);
      }
    }
  }

  draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const width = Math.min(2.4, Math.max(1.1, this.height * 0.0019));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.stroke(SHADOW, width + 0.6, 0.6, 1.1);
    this.stroke(BODY, width, 0, 0);
    this.stroke(HIGHLIGHT, width * 0.35, -0.3, -0.45);
    if (this.tied) this.knot(width);
  }

  private stroke(color: string, width: number, ox: number, oy: number): void {
    const { ctx, x, y } = this;
    const n = COUNT - 1;
    ctx.beginPath();
    ctx.moveTo(x[0] + ox, y[0] + oy);
    for (let i = 1; i < n; i++) {
      ctx.quadraticCurveTo(x[i] + ox, y[i] + oy, (x[i] + x[i + 1]) / 2 + ox, (y[i] + y[i + 1]) / 2 + oy);
    }
    ctx.lineTo(x[n] + ox, y[n] + oy);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // A small loop around the stem and a short loose end, drawn where the thread is tied.
  private knot(width: number): void {
    const { ctx } = this;
    const { x, y } = this.tail.pos;
    ctx.strokeStyle = BODY;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(x + width, y, width * 3.2, width * 2.1, -0.35, 0, Math.PI * 2);
    ctx.moveTo(x + width * 3, y + width);
    ctx.quadraticCurveTo(x + width * 7, y + width * 5, x + width * 5.5, y + width * 13);
    ctx.stroke();
  }
}
