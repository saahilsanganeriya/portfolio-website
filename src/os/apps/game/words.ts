// The Daily word's answers: five-letter words from the owner's world. The order was shuffled once and is fixed, so
// a day always has the same word; append new words at the end so earlier days keep theirs.
export type WordTopic = 'film' | 'code' | 'kitchen' | 'delhi' | 'sf';

export const ANSWERS: readonly (readonly [string, WordTopic])[] = [
  ['FRAME', 'film'], ['STUNT', 'film'], ['CACHE', 'code'], ['LEMON', 'kitchen'], ['LINUX', 'code'], ['HILLS', 'sf'],
  ['LOOMS', 'delhi'], ['GENRE', 'film'], ['CRUMB', 'kitchen'], ['ASYNC', 'code'], ['MERGE', 'code'], ['KULFI', 'kitchen'],
  ['MUTEX', 'code'], ['TITLE', 'film'], ['SHELL', 'code'], ['QUTUB', 'delhi'], ['GLAZE', 'kitchen'], ['LOGIC', 'code'],
  ['SUGAR', 'kitchen'], ['MATTE', 'film'], ['MOVIE', 'film'], ['SCALE', 'code'], ['MARIN', 'sf'], ['TAKES', 'film'],
  ['CREAM', 'kitchen'], ['TOAST', 'kitchen'], ['SHOTS', 'film'], ['ROUTE', 'code'], ['YIELD', 'code'], ['ROAST', 'kitchen'],
  ['LATCH', 'code'], ['SHOOT', 'film'], ['CLOUD', 'code'], ['MOCHA', 'kitchen'], ['CHOWK', 'delhi'], ['TOKEN', 'code'],
  ['CHILI', 'kitchen'], ['DOUGH', 'kitchen'], ['TARTS', 'kitchen'], ['SEALS', 'sf'], ['FLICK', 'film'], ['REELS', 'film'],
  ['PIXEL', 'code'], ['MODEL', 'code'], ['STEAM', 'kitchen'], ['SAUCE', 'kitchen'], ['OLIVE', 'kitchen'], ['MILLS', 'delhi'],
  ['DEBUG', 'code'], ['SCONE', 'kitchen'], ['CHOLE', 'kitchen'], ['CABLE', 'sf'], ['CLASS', 'code'], ['BROTH', 'kitchen'],
  ['STILL', 'film'], ['FOGGY', 'sf'], ['WHISK', 'kitchen'], ['EDITS', 'film'], ['PARSE', 'code'], ['WHARF', 'sf'],
  ['FLASH', 'film'], ['SOUND', 'film'], ['BOOTH', 'film'], ['SUTRO', 'sf'], ['PRINT', 'film'], ['SPOOL', 'film'],
  ['YARNS', 'delhi'], ['AUDIO', 'film'], ['GRIND', 'kitchen'], ['SEPIA', 'film'], ['NODES', 'code'], ['BASIL', 'kitchen'],
  ['CAMEO', 'film'], ['PROXY', 'code'], ['PIZZA', 'kitchen'], ['MANGO', 'kitchen'], ['SHARD', 'code'], ['PATCH', 'code'],
  ['STAGE', 'film'], ['GRAPH', 'code'], ['AGENT', 'code'], ['QUEUE', 'code'], ['FETCH', 'code'], ['CRUST', 'kitchen'],
  ['SPICE', 'kitchen'], ['COAST', 'sf'], ['ACTOR', 'film'], ['KNEAD', 'kitchen'], ['HONEY', 'kitchen'], ['DHABA', 'delhi'],
  ['BEANS', 'kitchen'], ['EPOCH', 'code'], ['BUILD', 'code'], ['INDEX', 'code'], ['PIERS', 'sf'], ['OCEAN', 'sf'],
  ['JEERA', 'kitchen'], ['LASSI', 'kitchen'], ['QUERY', 'code'], ['GRAIN', 'film'], ['CREPE', 'kitchen'], ['CLONE', 'code'],
  ['DELHI', 'delhi'], ['CHAAT', 'kitchen'], ['BREAD', 'kitchen'], ['YEAST', 'kitchen'], ['ARRAY', 'code'], ['BYTES', 'code'],
  ['SCORE', 'film'], ['PLOTS', 'film'], ['LODHI', 'delhi'], ['TADKA', 'kitchen'], ['DRAMA', 'film'], ['TUPLE', 'code'],
  ['STACK', 'code'], ['CURRY', 'kitchen'], ['METRO', 'delhi'], ['BATCH', 'code'], ['FLOUR', 'kitchen'], ['SLATE', 'film'],
  ['KHADI', 'delhi'], ['FIBRE', 'delhi'], ['RAITA', 'kitchen'], ['PULAO', 'kitchen'], ['LAYER', 'code'], ['PAUSE', 'film'],
  ['EXTRA', 'film'], ['DOLLY', 'film'], ['PASTA', 'kitchen'], ['REGEX', 'code'], ['FADES', 'film'], ['OSCAR', 'film'],
  ['SCENE', 'film'], ['LIGHT', 'film'], ['FOCUS', 'film'], ['LATTE', 'kitchen'],
];

export const TOPIC_LINES: Record<WordTopic, string> = {
  film: 'A word from the films.',
  code: 'A word from the code.',
  kitchen: 'A word from the kitchen.',
  delhi: 'A word from Delhi.',
  sf: 'A word from San Francisco.',
};

const LAUNCH_DAY = Date.UTC(2026, 9, 12);

/** Days since the game began (12 October 2026 is day 0), by the visitor's own calendar. */
export const dayNumber = (now: Date): number =>
  Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - LAUNCH_DAY) / 86_400_000);

export function answerFor(day: number): { word: string; topic: WordTopic } {
  const [word, topic] = ANSWERS[((day % ANSWERS.length) + ANSWERS.length) % ANSWERS.length];
  return { word, topic };
}
