import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

function entries(collection: string) {
  return glob({
    base: './src/content',
    pattern: `${collection}/[^_]*.{md,mdx}`,
    generateId: ({ entry }) => entry.split('/').pop()!.replace(/\.mdx?$/, ''),
  });
}

const projects = defineCollection({
  loader: entries('projects'),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string().max(140),
      year: z.number().int(),
      years: z.string().optional(),
      status: z.enum(['shipped', 'research', 'archived']),
      role: z.string(),
      team: z.string(),
      stack: z.array(z.string()),
      featured: z.boolean(),
      order: z.number().int().optional(),
      links: z.object({
        repo: z.url().optional(),
        paper: z.url().optional(),
        demo: z.url().optional(),
        page: z.url().optional(),
        pypi: z.url().optional(),
      }),
      cover: image().optional(),
      coverAlt: z.string().optional(),
    }),
});

const blog = defineCollection({
  loader: entries('blog'),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    summary: z.string(),
    tags: z.array(z.string()),
    draft: z.boolean().default(false),
    film: z
      .object({
        title: z.string(),
        year: z.number().int(),
        rating: z.number().min(0.5).max(5).multipleOf(0.5).optional(),
        letterboxd: z.url(),
      })
      .optional(),
  }),
});

const pages = defineCollection({
  loader: entries('pages'),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
  }),
});

const story = defineCollection({
  loader: entries('story'),
  schema: ({ image }) =>
    z.object({
      n: z.number().int(),
      title: z.string(),
      intertitle: z.string().max(90),
      background: z.object({
        src: image(),
        alt: z.string(),
        credit: z.string(),
        licence: z.string(),
        sourceUrl: z.url(),
        placeholder: z.boolean().optional(),
      }),
    }),
});

export const collections = { projects, blog, pages, story };
