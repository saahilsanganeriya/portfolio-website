import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The one stable résumé address. Built from the same file the résumé pipeline publishes, so there is one copy.
export function GET() {
  const pdf = readFileSync(join(process.cwd(), 'public/resume/saahil-sanganeriya-resume.pdf'));
  return new Response(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Saahil-Sanganeriya-resume.pdf"',
    },
  });
}
