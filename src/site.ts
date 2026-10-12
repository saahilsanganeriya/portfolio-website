export const SITE = {
  name: 'Saahil Sanganeriya',
  description:
    'Saahil Sanganeriya is a software engineer who builds data systems and research tools. Projects, essays and film notes.',
  email: 'saahilsanganeria666@gmail.com',
  github: 'https://github.com/saahilsanganeriya',
  linkedin: 'https://www.linkedin.com/in/saahil-sanganeriya/',
  letterboxd: 'https://letterboxd.com/saahilsan/',
  ogImage: '/og/default.png',
  ogImageAlt: 'Saahil Sanganeriya, in cream serif type on a dark background, above a thin red thread.',
} as const;

export const NAV = [
  { href: '/projects', label: 'Projects' },
  { href: '/blog', label: 'Writing' },
  { href: '/films', label: 'Films' },
  { href: '/about', label: 'About' },
  { href: '/resume', label: 'Résumé' },
] as const;
