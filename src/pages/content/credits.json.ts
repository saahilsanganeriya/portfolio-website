import { creditSections } from '../../lib/assets-register';

// Static `/content/credits.json` → { sections }: every file the site ships with its source and licence (blender/ASSETS.md),
// which SaahilOS's Credits window loads when opened.
export function GET() {
  return Response.json({ sections: creditSections() });
}
