import { describe, expect, it } from 'vitest';
import { PLANE_LENGTH_M, flightPath, routeAt } from '../src/scene/World/WindowView';

// The plane over the window flies the motif's dotted arc (the room's motif: 1.24 x 0.48 m) from New Delhi to San
// Francisco; the two names are written under the arc's ends.
const WIDTH = 1.24;
const HEIGHT = 0.48;

describe('the plane over the window', () => {
  /**
   * Catches a name moved up under the arc (LABEL_DROP 0.07 instead of 0.17 puts New Delhi under the take-off), or a
   * plane or flight changed until it covers a name: the plane's footprint (a circle 0.6 of its length across its
   * centre, which holds it at any heading) stays off both names' boxes all along the flight.
   */
  it('stays clear of both names all along its flight', () => {
    const path = flightPath(WIDTH, HEIGHT);
    for (let k = 0; k <= 1; k += 0.002) {
      const at = path.point(routeAt(k));
      for (const box of path.labels) expect(box.distanceToPoint(at), `k ${k.toFixed(3)}`).toBeGreaterThan(0.6 * PLANE_LENGTH_M);
    }
  });

  /** Catches a flight that jumps or runs backwards: it moves on along the route all the way, from Delhi's end to San Francisco's. */
  it('moves on along the route from New Delhi toward San Francisco', () => {
    let last = routeAt(0);
    for (let k = 0.01; k <= 1; k += 0.01) {
      const u = routeAt(k);
      expect(u).toBeGreaterThan(last);
      expect(u - last).toBeLessThan(0.02);
      last = u;
    }
    expect(routeAt(0)).toBeLessThan(0.1);
    expect(routeAt(1)).toBeGreaterThan(0.9);
  });
});
