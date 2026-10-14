import { parseAssetsRegister } from '../../lib/assets-register';

// Static `/content/credits.json` → { sections }: every third-party file with its source and licence (blender/ASSETS.md),
// which SaahilOS's Credits window loads when opened.
export function GET() {
  return Response.json({ sections: parseAssetsRegister().filter((section) => section.rows.length > 0) });
}
