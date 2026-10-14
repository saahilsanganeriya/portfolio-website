import { getContainerRenderer } from '@astrojs/mdx/container-renderer';
import type { APIContext } from 'astro';
import { experimental_AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getCollection, render, type CollectionEntry } from 'astro:content';
import { getPosts } from '../../../lib/content';

type Entry = CollectionEntry<'projects' | 'blog' | 'pages' | 'recipes' | 'voyager'>;

// Static `/content/<collection>/<slug>.json` → { data, html }: SaahilOS reader windows load bodies from here.
export async function getStaticPaths() {
  const entries: Entry[] = [
    ...(await getCollection('projects')),
    ...(await getPosts()),
    ...(await getCollection('pages')),
    ...(await getCollection('recipes')),
    ...(await getCollection('voyager')),
  ];
  return entries.map((entry) => ({ params: { collection: entry.collection, slug: entry.id }, props: { entry } }));
}

const container = await experimental_AstroContainer.create({
  renderers: await loadRenderers([getContainerRenderer()]),
});

export async function GET({ props }: APIContext<{ entry: Entry }>) {
  const { Content } = await render(props.entry);
  const html = await container.renderToString(Content);
  return Response.json({ data: props.entry.data, html });
}
