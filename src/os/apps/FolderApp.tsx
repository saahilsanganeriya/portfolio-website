import { PixelIcon } from '../assets/PixelIcon';
import type { AppId } from '../types';
import { APPS } from './registry';

/** A Win98 folder window: its apps as large icons, each one click away. */
export function FolderApp({ apps, label }: { apps: readonly AppId[]; label: string }) {
  return (
    <nav className="os-folder" aria-label={label}>
      <ul>
        {apps.map((id) => (
          <li key={id}>
            <a className="os-folder-item" href={`#${id}`}>
              <PixelIcon name={APPS[id].icon} size={32} />
              <span>{APPS[id].label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
