// Art direction for the story reel: how each photo is framed, which side the words sit on, and where the thread is
// held in each frame. Frame points are fractions of the frame (x to the right, y down); `tie` is a point in the photo.

export type Side = 'left' | 'right';

export interface ThreadHold {
  head: [number, number];
  tail: [number, number];
  /** Thread length as a multiple of the distance between its ends; more slack hangs lower. */
  slack: number;
}

export interface SceneDirection {
  /** CSS object-position of the photo, in percent. */
  focus: [number, number];
  side: Side;
  thread: ThreadHold;
}

export const TITLE_THREAD: ThreadHold = { head: [0, 0.5], tail: [1, 0.74], slack: 1.1 };
export const CARD_THREAD: ThreadHold = { head: [0, 0.5], tail: [1, 0.6], slack: 1.11 };

// Over a scene the thread runs above the words, so it never crosses the text at rest.
const ABOVE_WORDS: ThreadHold = { head: [0, 0.17], tail: [1, 0.33], slack: 1.04 };

const DEFAULT_SCENE: SceneDirection = { focus: [50, 50], side: 'left', thread: ABOVE_WORDS };

const SCENES: Record<string, SceneDirection> = {
  '01-delhi': { focus: [50, 55], side: 'right', thread: { head: [0, 0.32], tail: [1, 0.15], slack: 1.04 } },
  '02-the-mill': { focus: [50, 45], side: 'left', thread: ABOVE_WORDS },
  '03-eighteen': { focus: [50, 40], side: 'left', thread: { head: [0, 0.12], tail: [1, 0.3], slack: 1.05 } },
  '04-seeing-cells': { focus: [100, 70], side: 'right', thread: { head: [0, 0.3], tail: [1, 0.14], slack: 1.04 } },
  '05-building': { focus: [50, 50], side: 'left', thread: { head: [0, 0.2], tail: [1, 0.22], slack: 1.04 } },
  '06-home': { focus: [50, 52], side: 'left', thread: ABOVE_WORDS },
};

export function sceneDirection(chapterId: string): SceneDirection {
  return SCENES[chapterId] ?? DEFAULT_SCENE;
}

/** The closing frame shows the last chapter's photo again; the thread comes in low and is tied to the stem. */
export const END_SCENE = {
  focus: [50, 58] as [number, number],
  thread: { head: [0, 0.88], tail: [1, 0.88], slack: 1.03 } satisfies ThreadHold,
  tie: [0.594, 0.62] as [number, number],
};

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function numeral(n: number): string {
  return NUMERALS[n - 1] ?? String(n);
}
