import { getCollection } from 'astro:content';

// Static `/content/books.json` → { books }: SaahilOS's Books window loads its shelf from here, in the order written.
export async function GET() {
  const books = (await getCollection('books'))
    .sort((a, b) => a.data.order - b.data.order)
    .map(({ data: { title, author, year, line } }) => ({ title, author, year, line }));
  return Response.json({ books });
}
