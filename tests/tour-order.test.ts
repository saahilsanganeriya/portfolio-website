import { describe, expect, it } from 'vitest';
import { nextStopIndex } from '../src/components/RoomTourMap';

describe('the played tour', () => {
  // Catches the tour stopping at the projector while its wall shows nothing (T52 fix 6), and a film stop left out
  // while the film plays.
  it('passes a film stop while no film plays, and visits it while one does', () => {
    const stops = [{}, { when: 'film' }, {}];
    expect(nextStopIndex(stops, 0, false)).toBe(2);
    expect(nextStopIndex(stops, 0, true)).toBe(1);
    expect(nextStopIndex(stops, 2, false)).toBe(3);
  });
});
