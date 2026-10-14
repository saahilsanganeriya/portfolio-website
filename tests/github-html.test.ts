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

  /**
   * Catches a README's relative links resolving against this site: GitHub's API leaves `docs/grading.md` relative, so in
   * SaahilOS it pointed at /docs/grading.md here and opened a 404 in a new tab (swe-sim's README, 433 such links). A
   * relative link must name the file in its repository, which SaahilOS then opens in the Code window.
   */
  test("a relative link or picture resolves in the document's own repository", () => {
    const at = { owner: 'o', repo: 'r', ref: 'main', rawRef: 'abc1234', path: 'docs/guide.md' };
    const html = cleanGithubHtml('<a href="setup.md#run">setup</a> <a href="../LICENSE">licence</a> <a href="#top">top</a> <img src="img/flow.png" alt="">', at);
    expect(html).toContain('href="https://github.com/o/r/blob/main/docs/setup.md#run"');
    expect(html).toContain('href="https://github.com/o/r/blob/main/LICENSE"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('src="https://raw.githubusercontent.com/o/r/abc1234/docs/img/flow.png"');
  });
});
