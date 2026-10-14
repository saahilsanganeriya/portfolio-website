import type { OsApi } from '../types';
import { RESUME_PDF } from './AboutApp';
import { PageReader } from './Reader';

export function ResumeApp({ os }: { os: OsApi }) {
  return (
    <PageReader
      slug="resume"
      os={os}
      after={
        <p className="os-reader-links">
          <a href={RESUME_PDF} target="_blank" rel="noopener">
            Open the PDF
          </a>
        </p>
      }
    />
  );
}
