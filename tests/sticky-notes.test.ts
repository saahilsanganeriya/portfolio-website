import { describe, expect, it } from 'vitest';
import { parseEquation } from '../src/scene/World/StickyNotes';
import { NOTE_SLOTS, readNotes, STICKY_NOTES } from '../src/scene/World/stickyContent';

describe('the sticky notes on the monitor', () => {
  // Catches the notes growing back past three (the owner: fewer, and each with a reason), two notes on one slot, or a
  // kind the room cannot draw.
  it('are his phrases, a few equations and a to-do list, one per bezel slot', () => {
    expect(STICKY_NOTES.map((note) => note.kind)).toEqual(['text', 'equations', 'todo']);
    expect(new Set(STICKY_NOTES.map((note) => note.slot)).size).toBe(STICKY_NOTES.length);
    expect(STICKY_NOTES[0].lines.join(' ')).toBe('You win some, you lose some. Cost of doing business.');
    // A to-do's hover label reads out what is still open.
    expect(STICKY_NOTES[2].label).toMatch(/^To do: /);
    expect(STICKY_NOTES[2].label).not.toContain('idempotent');
  });

  // Catches a content edit that would draw a blank or garbled note instead of failing the build.
  it('refuses a note the room cannot draw', () => {
    expect(() => readNotes([{ kind: 'todo', lines: ['water the mango'] }])).toThrow(/starts with "\[x\] " or "\[ \] "/);
    expect(() => readNotes([{ kind: 'poem', lines: ['x'] }])).toThrow(/no kind/);
    expect(() => readNotes(Array.from({ length: NOTE_SLOTS.length + 1 }, () => ({ kind: 'text', lines: ['x'] })))).toThrow(/at most/);
  });

  // Catches Bayes' rule set inline as "P(B|A) P(A) / P(B)" (or the fraction split at the wrong place).
  it('sets "a = b / c" as a stacked fraction and keeps any other line inline', () => {
    expect(parseEquation('P(A|B) = P(B|A) P(A) / P(B)')).toEqual([
      { kind: 'text', text: 'P(A|B) = ' },
      { kind: 'fraction', numerator: 'P(B|A) P(A)', denominator: 'P(B)' },
    ]);
    expect(parseEquation('s² = (ct)² − x²')).toEqual([{ kind: 'text', text: 's² = (ct)² − x²' }]);
  });
});
