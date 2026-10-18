import { useEffect } from 'react';
import { NOW_PLAYING } from '../../scene/audio/crate';
import { linkAttributes } from './content';

/**
 * The crate's one record the site does not host: Spotify's own player for it, loaded only once this window opens. While
 * the window is open it tells the room, which holds its own music until the window closes.
 */
export function NowPlayingApp() {
  useEffect(() => {
    if (window.parent === window) return;
    const tell = (open: boolean) => window.parent.postMessage({ type: 'now-playing', open }, window.location.origin);
    tell(true);
    return () => tell(false);
  }, []);
  return (
    <article className="os-reader os-now-playing">
      <iframe
        className="os-now-playing-player"
        title={`Spotify player: ${NOW_PLAYING.title}, ${NOW_PLAYING.artist}`}
        src={NOW_PLAYING.embedUrl}
        height={152}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
      <p className="os-now-playing-note">
        {NOW_PLAYING.line} Streamed from{' '}
        <a href={NOW_PLAYING.sourceUrl} {...linkAttributes(NOW_PLAYING.sourceUrl)}>
          Spotify<span className="visually-hidden">, the track’s page</span>
        </a>
        .
      </p>
    </article>
  );
}
