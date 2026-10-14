import { describe, expect, it } from 'vitest';
import { classifyLink, FRAMEABLE_HOSTS } from '../src/os/routes.ts';

const ORIGIN = 'https://example.test';
const where = (href: string) => classifyLink(href, ORIGIN);

describe('links inside SaahilOS', () => {
  // Catches a GitHub link leaving the room (GitHub refuses framing), or landing in the Code window at the wrong place.
  it('maps every github.com address onto the Code window, path for path', () => {
    expect(where('https://github.com/saahilsanganeriya')).toEqual({ kind: 'window', route: { app: 'code' } });
    expect(where('https://github.com/saahilsanganeriya/projectionist#readme')).toEqual({
      kind: 'window',
      route: { app: 'code', slug: 'saahilsanganeriya/projectionist' },
    });
    expect(where('https://github.com/saahilsanganeriya/real_time_streaming/blob/main/docs/design.md')).toEqual({
      kind: 'window',
      route: { app: 'code', slug: 'saahilsanganeriya/real_time_streaming/blob/main/docs/design.md' },
    });
    expect(where('https://github.com/henryjeff/portfolio-website/tree/c53c5a5/static/audio')).toEqual({
      kind: 'window',
      route: { app: 'code', slug: 'henryjeff/portfolio-website/tree/c53c5a5/static/audio' },
    });
    // GitHub's own pages and other people's profiles are not repositories: a new tab.
    expect(where('https://github.com/features/actions').kind).toBe('external');
    expect(where('https://github.com/henryjeff').kind).toBe('external');
  });

  // Catches the browser window opening a site that refuses framing (a blank window), or a framable one leaving the room.
  it('opens only the checked framable sites in the browser window, every other site in a new tab', () => {
    for (const host of FRAMEABLE_HOSTS) {
      expect(where(`https://${host}/some/page`)).toEqual({ kind: 'window', route: { app: 'browser', slug: `https://${host}/some/page` } });
    }
    for (const href of ['https://letterboxd.com/saahilsan/', 'https://pypi.org/project/samcell-napari/', 'https://doi.org/10.1371/x']) {
      expect(where(href).kind).toBe('external');
    }
  });

  // Catches an own address with no window of its own replacing the whole tab (the room) instead of opening a window.
  it('turns every own address into a window, so nothing replaces the tab', () => {
    expect(where('/')).toEqual({ kind: 'window', route: { app: 'about' } });
    expect(where('/#books')).toEqual({ kind: 'window', route: { app: 'books' } });
    expect(where('/projects/samcell')).toEqual({ kind: 'window', route: { app: 'projects', slug: 'samcell' } });
    expect(where('/not-a-window')).toEqual({ kind: 'window', route: { app: 'about' } });
    expect(where('/resume.pdf').kind).toBe('external');
  });
});
