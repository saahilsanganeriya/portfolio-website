import data from '../../content/sticky-notes.json';

// The sticky notes on the monitor (src/content/sticky-notes.json): each is a kind and its lines.
//   text       his phrases, in marker, one entry per written line
//   equations  set in the site's serif; "a = b / c" (a spaced slash) is drawn as a stacked fraction
//   todo       "[x] done" or "[ ] open", in marker, each with its box
// An optional `label` is the hover label; text reads its lines out, a to-do its open items.

export type StickyKind = 'text' | 'equations' | 'todo';

export interface StickyNote {
  kind: StickyKind;
  lines: string[];
  label?: string;
}

export interface PlacedNote extends StickyNote {
  /** The room's `sticky_note_<slot>` it is written on. */
  slot: number;
  label: string;
}

/** Where the notes go, in the file's order: the right bezel's top, the left bezel, under the first. */
export const NOTE_SLOTS: readonly number[] = [0, 2, 1];

const KINDS: readonly string[] = ['text', 'equations', 'todo'];
const TODO_LINE = /^\[( |x)\] (.+)$/;

/** A to-do line's state and words. */
export function todoItem(line: string) {
  const match = TODO_LINE.exec(line);
  return match ? { done: match[1] === 'x', text: match[2] } : { done: false, text: line };
}

/** The notes from the content file; a malformed one is a content error, so it throws instead of drawing a blank note. */
export function readNotes(raw: unknown): StickyNote[] {
  if (!Array.isArray(raw)) throw new Error('sticky-notes.json: expected a list of notes');
  if (raw.length > NOTE_SLOTS.length) throw new Error(`sticky-notes.json: at most ${NOTE_SLOTS.length} notes fit on the monitor`);
  return raw.map((note, i) => {
    const { kind, lines, label } = (note ?? {}) as Record<string, unknown>;
    if (typeof kind !== 'string' || !KINDS.includes(kind)) throw new Error(`sticky-notes.json: note ${i} has no kind (text, equations or todo)`);
    if (!Array.isArray(lines) || !lines.length || !lines.every((l) => typeof l === 'string' && l.trim())) {
      throw new Error(`sticky-notes.json: note ${i} needs its lines`);
    }
    if (kind === 'todo' && !lines.every((l) => TODO_LINE.test(l))) throw new Error(`sticky-notes.json: note ${i}: every to-do line starts with "[x] " or "[ ] "`);
    if (label !== undefined && typeof label !== 'string') throw new Error(`sticky-notes.json: note ${i}: the label is text`);
    return { kind: kind as StickyKind, lines, ...(label ? { label } : {}) };
  });
}

function labelOf(note: StickyNote) {
  if (note.label) return note.label;
  if (note.kind === 'todo') {
    const open = note.lines.map(todoItem).filter((item) => !item.done);
    return open.length ? `To do: ${open.map((item) => item.text).join(', ')}` : 'All done';
  }
  return note.lines.join(' ');
}

export const STICKY_NOTES: readonly PlacedNote[] = readNotes(data).map((note, i) => ({ ...note, slot: NOTE_SLOTS[i], label: labelOf(note) }));
