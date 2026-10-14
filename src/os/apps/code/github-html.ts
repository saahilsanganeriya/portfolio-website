// GitHub's rendered Markdown (the REST API's `application/vnd.github.html+json` media type) → the markup the Code
// window shows. GitHub has already sanitised it; this drops its chrome, resolves the links and pictures it leaves
// relative in the file's own repository, and points pictures at raw.githubusercontent.com. Used by `npm run repos` at
// snapshot time and in the browser for repositories outside the snapshot, so it imports nothing.

const ANCHOR_HEADING =
  /<div class="markdown-heading"[^>]*>\s*<(h[1-6])[^>]*>([\s\S]*?)<\/\1>\s*<a id="user-content-([^"]+)" class="anchor"[^>]*>[\s\S]*?<\/a>\s*<\/div>/g;

/** The path of the rendered file, from GitHub's wrapper (`data-path="docs/README.md"`), when it says. */
export function renderedPath(html: string): string | null {
  return html.match(/<div id="(?:readme|file)" class="[^"]*" data-path="([^"]+)"/)?.[1] ?? null;
}

/** Where a rendered file lives, so its relative links and pictures resolve in its own repository. */
export interface RenderedAt {
  owner: string;
  repo: string;
  /** The ref links name (the default branch keeps them inside the snapshot). */
  ref: string;
  /** The ref pictures load from (the snapshot's commit); `ref` when absent. */
  rawRef?: string;
  path: string;
}

// Anything with a scheme, a protocol-relative URL or an in-page anchor is left as it is.
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function resolveRelative(html: string, at: RenderedAt): string {
  const page = `https://github.com/${at.owner}/${at.repo}/blob/${at.ref}/${at.path}`;
  const raw = `https://raw.githubusercontent.com/${at.owner}/${at.repo}/${at.rawRef ?? at.ref}/${at.path}`;
  const resolve = (url: string, base: string) => (ABSOLUTE.test(url) ? url : new URL(url, base).href);
  return html
    .replace(/(<a\b[^>]*?\shref=")([^"]*)"/g, (_, head: string, url: string) => `${head}${resolve(url, page)}"`)
    .replace(/(<img\b[^>]*?\ssrc=")([^"]*)"/g, (_, head: string, url: string) => `${head}${resolve(url, raw)}"`);
}

export function cleanGithubHtml(html: string, at?: RenderedAt): string {
  // GitHub's API leaves a file's relative links relative; here they would point at this site.
  const resolved = at ? resolveRelative(html, at) : html;
  return (
    resolved
      // The wrapper GitHub puts around every rendered file.
      .replace(/^\s*<div id="(?:readme|file)"[^>]*>\s*<article[^>]*>/, '')
      .replace(/<\/article>\s*<\/div>\s*$/, '')
      // Headings: drop the permalink icon, keep the anchor name so in-page links can scroll to it.
      .replace(ANCHOR_HEADING, (_, tag: string, text: string, anchor: string) => `<${tag} data-anchor="${anchor}">${text}</${tag}>`)
      .replace(/<svg\b[\s\S]*?<\/svg>/g, '')
      // Pictures uploaded in GitHub's editor render as signed URLs that expire in minutes; their stable address
      // redirects to a fresh one on every request.
      .replace(
        /https:\/\/private-user-images\.githubusercontent\.com\/\d+\/\d+-([0-9a-f-]{36})\.[a-z0-9]+\?[^"\s]*/gi,
        'https://github.com/user-attachments/assets/$1',
      )
      // GitHub links each picture to its own file in a new tab; here the picture is enough.
      .replace(/<a target="_blank" rel="noopener noreferrer(?: nofollow)?" href="[^"]*">(<img\b[^>]*>)<\/a>/g, '$1')
      .replace(
        /(<img\b[^>]*?\ssrc=")https:\/\/github\.com\/([^/"]+)\/([^/"]+)\/raw\//g,
        '$1https://raw.githubusercontent.com/$2/$3/',
      )
      .replace(/<img\b(?![^>]*\sloading=)/g, '<img loading="lazy" decoding="async"')
      .replace(/\sdata-snippet-clipboard-copy-content="[^"]*"/g, '')
      .replace(/\sdir="auto"/g, '')
      // A fenced block's language (`<pre lang="mermaid">`) is not a human language; as `lang` it fails WCAG 3.1.2.
      .replace(/(<pre\b[^>]*?)\slang="([^"]*)"/g, '$1 data-lang="$2"')
      .trim()
  );
}
