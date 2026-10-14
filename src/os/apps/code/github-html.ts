// GitHub's rendered Markdown (the REST API's `application/vnd.github.html+json` media type) → the markup the Code
// window shows. GitHub has already sanitised it and made relative links absolute (`github.com/<o>/<r>/blob|raw/…`),
// so this only drops its chrome and points pictures at raw.githubusercontent.com. Used by `npm run repos` at
// snapshot time and in the browser for repositories outside the snapshot, so it imports nothing.

const ANCHOR_HEADING =
  /<div class="markdown-heading"[^>]*>\s*<(h[1-6])[^>]*>([\s\S]*?)<\/\1>\s*<a id="user-content-([^"]+)" class="anchor"[^>]*>[\s\S]*?<\/a>\s*<\/div>/g;

/** The path of the rendered file, from GitHub's wrapper (`data-path="docs/README.md"`), when it says. */
export function renderedPath(html: string): string | null {
  return html.match(/<div id="(?:readme|file)" class="[^"]*" data-path="([^"]+)"/)?.[1] ?? null;
}

export function cleanGithubHtml(html: string): string {
  return (
    html
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
      .trim()
  );
}
