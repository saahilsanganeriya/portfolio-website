import type { Transition } from 'motion/react';

// Windows open, close and settle on one spring: quick, with a small overshoot so they land rather than stop.
const WINDOW_SPRING: Transition = { type: 'spring', stiffness: 520, damping: 36, mass: 0.9 };
const INSTANT: Transition = { duration: 0 };

export const springOrInstant = (reduceMotion: boolean | null): Transition => (reduceMotion ? INSTANT : WINDOW_SPRING);
