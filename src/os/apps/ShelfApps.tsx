import { useEffect, useId, type ReactNode } from 'react';
import { formatDay } from '../format';
import type { OsBook, OsIngredient, OsRecipe } from '../types';
import { useWindowStatus } from '../wm/Window';
import { linkAttributes, useContent, useJson, type Loaded } from './content';
import { DetailsList } from './Lists';
import { Body, Picture, ThreadLoader } from './Reader';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a list window shows before its JSON is ready, or when it never comes. */
function Pending({ loaded, what }: { loaded: Exclude<Loaded<unknown>, { state: 'ready' }>; what: string }) {
  const setStatus = useWindowStatus();
  useEffect(() => {
    setStatus(loaded.state === 'loading' ? `Loading ${what}…` : loaded.state === 'missing' ? 'Not published yet' : 'Did not load');
    return () => setStatus(null);
  }, [loaded.state, what, setStatus]);
  if (loaded.state === 'loading') return <ThreadLoader label={`Loading ${what}`} />;
  if (loaded.state === 'missing') return <p className="os-note">This is not published yet.</p>;
  return (
    <p className="os-note">
      The {what} did not load ({loaded.reason}). Check the connection, then close and reopen this window.
    </p>
  );
}

function StatusLine({ text }: { text: string }) {
  const setStatus = useWindowStatus();
  useEffect(() => {
    setStatus(text);
    return () => setStatus(null);
  }, [text, setStatus]);
  return null;
}

// ---- Books ----

/** The books on the shelf in the room, each with a line on why it is there. */
export function BooksApp() {
  const loaded = useJson<{ books: OsBook[] }>('/content/books.json');
  return (
    <article className="os-reader os-books">
      <header className="os-reader-head">
        <h2 className="os-reader-title">Books</h2>
      </header>
      {loaded.state !== 'ready' ? (
        <Pending loaded={loaded} what="books" />
      ) : loaded.value.books.length === 0 ? (
        <p className="os-note">No books on the shelf yet.</p>
      ) : (
        <>
          <StatusLine text={plural(loaded.value.books.length, 'book')} />
          <ol className="os-books-list">
            {loaded.value.books.map((book) => (
              <li key={`${book.title}-${book.author}`}>
                <h3 className="os-book-title">{book.title}</h3>
                <p className="os-book-by">
                  {book.author}, {book.year}
                </p>
                <p className="os-book-line">{book.line}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </article>
  );
}

// ---- Recipes ----

function Ingredients({ items }: { items: OsIngredient[] }) {
  const loose = items.filter((item): item is string => typeof item === 'string');
  const groups = items.filter((item): item is Exclude<OsIngredient, string> => typeof item !== 'string');
  const headingId = useId();
  return (
    <section className="os-recipe-ingredients" aria-labelledby={headingId}>
      <h3 id={headingId}>Ingredients</h3>
      {loose.length > 0 && (
        <ul>
          {loose.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {groups.map((group) => (
        <div key={group.group} className="os-recipe-group">
          <h4>{group.group}</h4>
          <ul>
            {group.items.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Recipe({ recipe }: { recipe: OsRecipe }) {
  const content = useContent<unknown>('recipes', recipe.slug);
  return (
    <article className="os-reader os-recipe">
      <p className="os-recipe-back">
        <a href="#recipes">‹ All recipes</a>
      </p>
      <header className="os-reader-head">
        <h2 className="os-reader-title">{recipe.title}</h2>
        <p className="os-reader-lead">{recipe.summary}</p>
        {recipe.photo && (
          <figure className="os-figure os-cover">
            <Picture image={recipe.photo} eager />
          </figure>
        )}
        <dl className="os-facts">
          <dt>Makes</dt>
          <dd>{recipe.yield}</dd>
          <dt>Time</dt>
          <dd>{recipe.time}</dd>
          <dt>Written</dt>
          <dd>
            <time dateTime={recipe.date}>{formatDay(recipe.date)}</time>
          </dd>
          {recipe.adaptedFrom && (
            <>
              <dt>Adapted from</dt>
              <dd>
                <a href={recipe.adaptedFrom.url} {...linkAttributes(recipe.adaptedFrom.url)}>
                  {recipe.adaptedFrom.name}
                </a>
              </dd>
            </>
          )}
        </dl>
      </header>
      <Ingredients items={recipe.ingredients} />
      <Body content={content} what={recipe.title} />
    </article>
  );
}

/** What he bakes: a list, and each recipe with its ingredients, method and notes. */
export function RecipesApp({ slug }: { slug?: string }) {
  const loaded = useJson<{ recipes: OsRecipe[] }>('/content/recipes.json');
  let body: ReactNode;
  if (loaded.state !== 'ready') body = <Pending loaded={loaded} what="recipes" />;
  else if (slug) {
    const recipe = loaded.value.recipes.find((r) => r.slug === slug);
    body = recipe ? (
      <Recipe recipe={recipe} />
    ) : (
      <article className="os-reader">
        <p className="os-recipe-back">
          <a href="#recipes">‹ All recipes</a>
        </p>
        <p className="os-note">This recipe is not published yet.</p>
      </article>
    );
  } else if (loaded.value.recipes.length === 0) body = <p className="os-note">No recipes written up yet.</p>;
  else {
    const { recipes } = loaded.value;
    const withPictures = recipes.some((r) => r.photo);
    body = (
      <div className="os-list">
        <StatusLine text={plural(recipes.length, 'recipe')} />
        <DetailsList
          heading="Recipes, newest first"
          metaLabel="Time"
          large={withPictures}
          rows={recipes.map((recipe) => ({
            href: `#recipes/${recipe.slug}`,
            title: recipe.title,
            summary: recipe.summary,
            meta: recipe.time,
            ...(withPictures ? { thumb: recipe.photo } : {}),
          }))}
        />
      </div>
    );
  }
  return body;
}

// ---- Voyager ----

/** The Voyager Golden Record on the wall: what it is, what is on it, why it hangs there. */
export function VoyagerApp() {
  const content = useContent<{ title: string; summary: string }>('voyager', 'voyager');
  const data = content.state === 'ready' ? content.entry.data : null;
  return (
    <article className="os-reader">
      <header className="os-reader-head">
        <h2 className="os-reader-title">{data?.title ?? 'The Voyager Golden Record'}</h2>
        {data && <p className="os-reader-lead">{data.summary}</p>}
      </header>
      <Body content={content} what="the Golden Record" />
    </article>
  );
}

