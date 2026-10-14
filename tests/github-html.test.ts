import { describe, expect, test } from 'vitest';
import { cleanGithubHtml } from '../src/os/apps/code/github-html';

describe("the Code window's copy of GitHub's rendered Markdown", () => {
  /**
   * Catches a fenced block's language reaching the page as an HTML `lang` attribute: GitHub renders a Mermaid block as
   * `<pre lang="mermaid">`, which names no human language, and axe reports it as serious (valid-lang, swe-sim's README).
   */
  test('a code block keeps its language as data, not as the HTML lang attribute', () => {
    const html = cleanGithubHtml('<p>Flow:</p>\n<pre lang="mermaid" aria-label="Raw mermaid code"><code>graph LR\n  a --> b</code></pre>');
    expect(html).not.toMatch(/\slang=/);
    expect(html).toContain('<pre data-lang="mermaid" aria-label="Raw mermaid code">');
  });
});
