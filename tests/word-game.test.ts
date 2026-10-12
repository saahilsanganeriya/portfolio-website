import { describe, expect, test } from 'vitest';
import { isWord, score, shareText } from '../src/os/apps/game/game';
import { GUESSES } from '../src/os/apps/game/guesses';
import { ANSWERS, answerFor, dayNumber } from '../src/os/apps/game/words';

describe('Daily word', () => {
  /** Catches the classic bug of marking a repeated letter present more times than the answer holds it. */
  test('a repeated letter is marked only as often as the answer has it', () => {
    expect(score('EERIE', 'SCENE')).toEqual(['present', 'absent', 'absent', 'absent', 'correct']);
    expect(score('SPOOL', 'LOOMS')).toEqual(['present', 'absent', 'correct', 'present', 'present']);
    expect(score('REELS', 'SCENE')).toEqual(['absent', 'present', 'correct', 'absent', 'present']);
  });

  /** Catches an answer the guess check would reject, which makes that day unwinnable. */
  test('every answer is a valid guess, and a non-word is not', () => {
    for (const [word] of ANSWERS) expect(isWord(word, GUESSES), word).toBe(true);
    expect(isWord('XQZVJ', GUESSES)).toBe(false);
  });

  /** Catches a day boundary taken in UTC instead of the visitor's own calendar, and a share grid that leaks letters. */
  test('the day follows the local calendar and the share text holds no letters', () => {
    expect(dayNumber(new Date(2026, 9, 12, 0, 5))).toBe(0);
    expect(dayNumber(new Date(2026, 9, 12, 23, 55))).toBe(0);
    expect(answerFor(0).word).toBe('FRAME');
    expect(shareText(0, ['CRANE', 'FRAME'], 'FRAME', true)).toBe('Daily word 1, 2/6\n⬛🟧🟧⬛🟧\n🟧🟧🟧🟧🟧');
  });
});
