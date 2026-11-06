import { useState } from 'react';

// A picture from tlidb's CDN, fitted into a width x height box. Where tlidb has none yet (or the
// CDN refuses it) the box shows the name's first letter instead; with no name either, nothing.
export default function Icon({ src, name, width = 24, height = width, className = '' }) {
  const [failed, setFailed] = useState(null);
  const style = { width, height };
  if (!src && !name) return null;
  if (!src || failed === src) {
    return (
      <span className={`icon icon-none ${className}`} style={style} aria-hidden="true">
        {name?.trim()[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return <img className={`icon ${className}`} style={style} src={src} alt="" loading="lazy" onError={() => setFailed(src)} />;
}

// Gear and slate art is 112 x 160
export function ItemIcon({ item, width = 56 }) {
  const title = item.uniqueName ?? item.name;
  return (
    <span className={`item-icon ${item.rarity === 100 ? 'legendary' : ''}`}>
      <Icon src={item.icon} name={title} width={width} height={Math.round((width * 160) / 112)} />
    </span>
  );
}
