import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import favorites from '../src/content/favorites.json' with { type: 'json' };
import tour from '../src/scene/tour.json' with { type: 'json' };

// Lines the room says about itself, held to what the room does and to the data they describe.

const caption = (id: string) => tour.stops.find((s) => s.id === id)!.caption;
const filmsApp = readFileSync(new URL('../src/os/apps/FilmsApp.tsx', import.meta.url), 'utf8');
const NUMBERS = ['no', 'one', 'two', 'three', 'four'];

describe('the favourites', () => {
  // Catches a line that calls every favourite a film when favorites.json marks one a series (T98b: Normal People, a
  // mini-series, in the tour's poster stop and the Films app), and a count that goes stale when the favourites change.
  it('the tour and the Films app count them as films and series, as favorites.json does', () => {
    const series = favorites.films.filter((f) => 'kind' in f && f.kind === 'mini-series').length;
    const films = favorites.films.length - series;
    const phrase = `${NUMBERS[films]} film${films === 1 ? '' : 's'}${series === 0 ? '' : series === 1 ? ' and a series' : ` and ${NUMBERS[series]} series`}`;
    for (const line of [caption('posters'), filmsApp]) {
      expect(line.toLowerCase()).toContain(phrase);
      expect(line).not.toMatch(/four (?:favourite )?films/i);
    }
  });
});

describe('the tour', () => {
  // Catches a caption that still promises round 8's click (the object opened its page at once): a click now flies to
  // the object and shows its card, and the card's Learn more opens the write-up.
  it('says the space pieces open their write-ups through Learn more', () => {
    expect(caption('space')).toMatch(/Learn more/);
    expect(caption('space')).not.toMatch(/Each opens/);
  });
});
