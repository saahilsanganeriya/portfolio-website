import type { CSSProperties } from 'react';
import { PixelIcon } from '../assets/PixelIcon';
import { iconMaskUrl } from '../assets/icons';
import { APPS } from '../apps/registry';
import { DESKTOP_APPS, type AppId } from '../types';

interface DesktopIconsProps {
  phone: boolean;
  selected: AppId | null;
  onSelect: (id: AppId | null) => void;
  onOpen: (id: AppId) => void;
}

/** Win98 rules on a desktop (click selects, double-click or Enter opens); one tap opens on a phone. */
export function DesktopIcons({ phone, selected, onSelect, onOpen }: DesktopIconsProps) {
  return (
    <nav className="os-icons-nav" aria-label="Apps">
      <ul className="os-icons">
        {DESKTOP_APPS.map((id) => (
          <li key={id}>
            <button
              type="button"
              className="os-icon"
              data-selected={selected === id || undefined}
              style={{ '--icon-mask': iconMaskUrl(APPS[id].icon) } as CSSProperties}
              onClick={(event) => {
                // detail 0 is a keyboard activation (Enter or Space).
                if (phone || event.detail === 0) onOpen(id);
                else onSelect(id);
              }}
              onDoubleClick={() => onOpen(id)}
            >
              <span className="os-icon-art">
                <PixelIcon name={APPS[id].icon} size={32} />
              </span>
              <span className="os-icon-label">{APPS[id].label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
