import { getImage } from 'astro:assets';
import { getCollection } from 'astro:content';
import { isoDay } from '../../lib/content';

// Static `/content/recipes.json` → { recipes }, newest first: the Recipes window's list and each recipe's header
// (its photo as WebP sizes). The method and notes load per recipe from /content/recipes/<slug>.json.
export async function GET() {
  const entries = (await getCollection('recipes')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
  const recipes = await Promise.all(
    entries.map(async ({ id, data }) => ({
      slug: id,
      title: data.title,
      date: isoDay(data.date),
      summary: data.summary,
      yield: data.yield,
      time: data.time,
      ingredients: data.ingredients,
      photo: data.photo
        ? await getImage({ src: data.photo, widths: [320, 640, 960], format: 'webp', quality: 78 }).then((image) => ({
            src: image.src,
            srcset: image.srcSet.attribute,
            width: data.photo!.width,
            height: data.photo!.height,
            alt: data.photoAlt ?? '',
          }))
        : null,
    })),
  );
  return Response.json({ recipes });
}
