import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

// The owner's own photography, one YAML file per photo, written by `npm run photos:ingest`. Never photos of him: only
// what he shot on his film or digital camera and posted, with the camera line from his post as the evidence (or his
// own pick by name, for a post without one).
const photography = defineCollection({
  loader: glob({ base: './src/content/photography', pattern: '[^_]*.{yaml,yml}' }),
  schema: ({ image }) =>
    z
      .object({
        file: image(),
        title: z.string(),
        /** The year he took it. */
        year: z.number().int(),
        place: z.string().optional(),
        /** One line in his voice; it also serves as the photo's alt text. */
        caption: z.string().max(140),
        /** Camera and lens, as his post names them; film stock separately (none for digital). */
        camera: z.string().min(1).optional(),
        /** He asked for this photograph by name, so it hangs without a camera line. */
        ownerPick: z.literal(true).optional(),
        film: z.string().optional(),
        /** The one order of the set: the room's darkroom line and SaahilOS both follow it. */
        order: z.number().int().optional(),
        /** The few words he writes on the print's border in the room, in marker. */
        sharpie: z.string().max(40).optional(),
        /** The day he posted it. */
        date: z.coerce.date().optional(),
        /** His own Instagram caption for it, as posted. */
        igCaption: z.string().optional(),
      })
      .refine((photo) => Boolean(photo.camera) || photo.ownerPick === true, {
        message: 'a photograph needs the camera line from his post (or ownerPick: true when he asked for it by name)',
        path: ['camera'],
      }),
});

// ---- SaahilOS shelves: Books, Recipes and Voyager. Each may be empty (or absent) and the build still passes. ----

// src/content/books.json: an array of { title, author, year, line }, kept in the order written.
const books = defineCollection({
  loader: {
    name: 'books-json',
    load: async ({ config, store, parseData, watcher }) => {
      const file = new URL('src/content/books.json', config.root);
      watcher?.add(fileURLToPath(file));
      store.clear();
      if (!existsSync(file)) return;
      const list: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(list)) throw new Error('src/content/books.json: expected an array of books');
      for (const [order, book] of list.entries()) {
        const id = String(order);
        store.set({ id, data: await parseData({ id, data: { ...book, order } }) });
      }
    },
  },
  schema: z.object({
    title: z.string().min(1),
    author: z.string().min(1),
    year: z.number().int(),
    /** One line in his voice. */
    line: z.string().min(1),
    order: z.number().int(),
  }),
});

// src/content/recipes/<slug>.mdx: frontmatter below, body `## Method` and `## Notes`.
const recipes = defineCollection({
  loader: entries('recipes'),
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        /** The day it was first published here. */
        date: z.coerce.date(),
        summary: z.string(),
        yield: z.string(),
        time: z.string(),
        /** Plain lines, or groups ("For the dough") of lines. */
        ingredients: z
          .array(z.union([z.string().min(1), z.object({ group: z.string().min(1), items: z.array(z.string().min(1)).min(1) })]))
          .min(1),
        photo: image().optional(),
        photoAlt: z.string().optional(),
        /** The recipe it is adapted from, credited with a link, when it is not wholly his. */
        adaptedFrom: z.object({ name: z.string().min(1), url: z.url() }).optional(),
      })
      .refine((recipe) => !recipe.photo || Boolean(recipe.photoAlt), {
        message: 'a recipe photo needs photoAlt',
        path: ['photoAlt'],
      }),
});

// src/content/voyager.mdx: the Voyager Golden Record window.
const voyager = defineCollection({
  loader: glob({ base: './src/content', pattern: 'voyager.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
  }),
});

export const collections = { projects, blog, pages, photography, books, recipes, voyager };
