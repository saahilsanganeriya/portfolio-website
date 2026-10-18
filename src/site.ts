export const SITE = {
  name: 'Saahil Sanganeriya',
  description:
    'Saahil Sanganeriya is a software engineer who builds data systems and research tools. Projects, essays and film notes.',
  // His own public address (no 'y' in "sanganeria"); scripts/check-routes.mjs fails a build that prints any other.
  email: 'saahilsanganeria666@gmail.com',
  github: 'https://github.com/saahilsanganeriya',
  linkedin: 'https://www.linkedin.com/in/saahil-sanganeriya/',
  letterboxd: 'https://letterboxd.com/saahilsan/',
  ogImage: '/og/default.png',
  ogImageAlt:
    'A pixel drawing of a cream vintage computer with a glowing amber screen, beside the name Saahil Sanganeriya and the line Software Engineer, Applied AI at Mercor.',
} as const;

export const NAV = [
  { href: '/projects', label: 'Projects' },
  { href: '/blog', label: 'Writing' },
  { href: '/films', label: 'Films' },
  { href: '/about', label: 'About' },
  { href: '/resume', label: 'Résumé' },
] as const;
