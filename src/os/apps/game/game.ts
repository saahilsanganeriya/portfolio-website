export type Mark = 'correct' | 'present' | 'absent';

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/**
 * Marks each letter of a guess against the answer. A repeated letter is marked present only as many times as the
 * answer still holds it after the exact matches: EERIE against SCENE marks the last E correct, one E present and one absent.
 */
export function score(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(WORD_LENGTH).fill('absent');
  const left = new Map<string, number>();
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) marks[i] = 'correct';
    else left.set(answer[i], (left.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    const count = left.get(guess[i]) ?? 0;
    if (marks[i] === 'correct' || count === 0) continue;
    marks[i] = 'present';
    left.set(guess[i], count - 1);
  }
  return marks;
}

const RANK: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };

/** The best mark each letter has earned so far, for the on-screen keys. */
export function keyMarks(guesses: readonly string[], answer: string): Map<string, Mark> {
  const keys = new Map<string, Mark>();
  for (const guess of guesses) {
    score(guess, answer).forEach((mark, i) => {
      const seen = keys.get(guess[i]);
      if (!seen || RANK[mark] > RANK[seen]) keys.set(guess[i], mark);
    });
  }
  return keys;
}

const SQUARES: Record<Mark, string> = { correct: '🟧', present: '🟦', absent: '⬛' };

/** The shareable result: a heading line, then one row of squares per guess and no letters. */
export function shareText(day: number, guesses: readonly string[], answer: string, won: boolean): string {
  const rows = guesses.map((guess) => score(guess, answer).map((mark) => SQUARES[mark]).join(''));
  return [`Daily word ${day + 1}, ${won ? guesses.length : 'X'}/${MAX_GUESSES}`, ...rows].join('\n');
}

/** Whether a guess counts as a word: a binary search of the sorted, fixed-width GUESSES string. */
export function isWord(guess: string, guesses: string): boolean {
  const word = guess.toLowerCase();
  let low = 0;
  let high = guesses.length / WORD_LENGTH - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = guesses.slice(mid * WORD_LENGTH, mid * WORD_LENGTH + WORD_LENGTH);
    if (candidate === word) return true;
    if (candidate < word) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}
