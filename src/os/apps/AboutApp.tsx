import { PixelIcon } from '../assets/PixelIcon';
import type { IconName } from '../assets/icons';
import type { OsApi, OsPage } from '../types';
import { useContent } from './content';
import { Body } from './Reader';

export const RESUME_PDF = '/resume/saahil-sanganeriya-resume.pdf';

interface Action {
  href: string;
  label: string;
  hint: string;
  icon: IconName;
  download?: string;
}

// The four things a first-time visitor came for, one click each. The résumé downloads; its window stays in Start.
const ACTIONS: Action[] = [
  { href: '#projects', label: 'Projects', hint: 'What I have built', icon: 'projects' },
  { href: '#blog', label: 'Writing', hint: 'Notes on the work', icon: 'page' },
  { href: '#code', label: 'Code', hint: 'My public repositories', icon: 'code' },
  {
    href: RESUME_PDF,
    label: 'Résumé',
    hint: 'Download the PDF',
    icon: 'resume',
    download: 'Saahil-Sanganeriya-resume.pdf',
  },
];

/** The window SaahilOS opens first: who he is, the ways on, then the About page with its photos beside the text. */
export function AboutApp({ os }: { os: OsApi }) {
  const { portrait } = os.index.me;
  const page: OsPage | undefined = os.index.pages.find((p) => p.slug === 'about');
  const content = useContent<{ title: string; summary: string }>('pages', 'about');
  return (
    <article className="os-reader os-about">
      <header className="os-about-head">
        <img
          className="os-about-portrait"
          src={portrait.src}
          srcSet={portrait.srcset}
          sizes="(max-width: 600px) 80px, 112px"
          width={portrait.width}
          height={portrait.height}
          alt={portrait.alt}
        />
        <div>
          <h2 className="os-about-name">Saahil Sanganeriya</h2>
          <p className="os-about-role">Software Engineer, Applied AI at Mercor · San Francisco</p>
        </div>
      </header>

      <nav className="os-about-actions" aria-label="Start here">
        <ul>
          {ACTIONS.map((action) => (
            <li key={action.label}>
              <a
                className="os-about-action"
                href={action.href}
                {...(action.download ? { download: action.download } : {})}
              >
                <PixelIcon name={action.icon} size={32} />
                <span className="os-about-action-text">
                  <span className="os-about-action-label">{action.label}</span>
                  <span className="os-about-action-hint">{action.hint}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {page && <p className="os-reader-lead os-about-lead">{page.summary}</p>}
      <Body content={content} what="About" />
    </article>
  );
}
