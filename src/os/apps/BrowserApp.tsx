import { FRAMEABLE_HOSTS } from '../routes';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * Another site inside SaahilOS, for the few that allow framing (routes.ts FRAMEABLE_HOSTS). The sandbox leaves out
 * top navigation, so nothing in the page can take the visitor out of the room; its own new-tab links still work.
 */
export function BrowserApp({ url }: { url?: string }) {
  const host = url ? hostOf(url) : '';
  if (!url || !FRAMEABLE_HOSTS.includes(host)) {
    return <p className="os-note">This window shows a page from another site. Open one from a link.</p>;
  }
  return (
    <div className="os-browser">
      <div className="os-browser-bar">
        <label className="visually-hidden" htmlFor="os-browser-address">
          Address
        </label>
        <input id="os-browser-address" className="os-browser-address" value={url} readOnly />
        <a className="os-tool" href={url} target="_blank" rel="noopener">
          Open in a new tab ↗
        </a>
      </div>
      <iframe
        className="os-browser-frame"
        src={url}
        title={`${host}, inside SaahilOS`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
