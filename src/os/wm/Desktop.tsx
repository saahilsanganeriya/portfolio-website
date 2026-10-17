import type { CSSProperties } from 'react';
import { PixelIcon } from '../assets/PixelIcon';
import { iconMaskUrl } from '../assets/icons';
import { APPS } from '../apps/registry';
import { PERSONAL_APPS, WORK_APPS, type AppId } from '../types';

// The work on the left, the person on the right; the DOM order is the reading order, so Tab walks left then right.
const SIDES = [
  { side: 'work', caption: 'Work', apps: WORK_APPS },
  { side: 'personal', caption: 'Off the clock', apps: PERSONAL_APPS },
] as const;

interface DesktopIconsProps {
  phone: boolean;
  selected: AppId | null;
  onSelect: (id: AppId | null) => void;
  onOpen: (id: AppId, from: Element) => void;
}

/** Win98 rules on a desktop (click selects, double-click or Enter opens); one tap opens on a phone. */
export function DesktopIcons({ phone, selected, onSelect, onOpen }: DesktopIconsProps) {
  return (
    <nav className="os-icons-nav" aria-label="Apps">
      {SIDES.map(({ side, caption, apps }) => (
        <div key={side} className="os-icon-group" data-side={side}>
          <h2 id={`os-icons-${side}`} className="os-icon-caption">
            <span>{caption}</span>
          </h2>
          <ul className="os-icons" aria-labelledby={`os-icons-${side}`}>
            {apps.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="os-icon"
                  data-selected={selected === id || undefined}
                  style={{ '--icon-mask': iconMaskUrl(APPS[id].icon) } as CSSProperties}
                  onClick={(event) => {
                    // detail 0 is a keyboard activation (Enter or Space).
                    if (phone || event.detail === 0) onOpen(id, event.currentTarget);
                    else onSelect(id);
                  }}
                  onDoubleClick={(event) => onOpen(id, event.currentTarget)}
                >
                  <span className="os-icon-art">
                    <PixelIcon name={APPS[id].icon} size={32} />
                  </span>
                  <span className="os-icon-label">{APPS[id].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
