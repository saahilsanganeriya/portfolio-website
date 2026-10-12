// A near-monochrome code theme in the site palette: structure comes from italics and the dust tone, not hue.
/** @type {import('shiki').ThemeRegistration} */
export const darkroom = {
  name: 'darkroom',
  type: 'dark',
  colors: {
    'editor.background': '#3B2A1E',
    'editor.foreground': '#EDE4D3',
  },
  tokenColors: [
    { settings: { foreground: '#EDE4D3' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#A89F91', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type', 'keyword.control'], settings: { fontStyle: 'italic' } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: '#A89F91' } },
    { scope: ['string', 'constant.numeric', 'constant.language'], settings: { foreground: '#EDE4D3' } },
  ],
};
