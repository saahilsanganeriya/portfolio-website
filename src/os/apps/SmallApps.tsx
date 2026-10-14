import type { OsApi } from '../types';
import { RESUME_PDF } from './AboutApp';
import { linkAttributes } from './content';
import { PageReader } from './Reader';

export function ResumeApp({ os }: { os: OsApi }) {
  return (
    <PageReader
      slug="resume"
      os={os}
      after={
        <p className="os-reader-links">
          <a href={RESUME_PDF} {...linkAttributes(RESUME_PDF)}>
            Download the PDF
          </a>
        </p>
      }
    />
  );
}
