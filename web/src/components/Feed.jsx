import Panel from './Panel.jsx';
import { baseIdOf, fmtTime } from '../format.js';

function describe(e, slotName) {
  const item = () => e.itemName ?? `#${baseIdOf(e.itemId)}`;
  switch (e.kind) {
    case 'login':
      return `${e.name} logged in (level ${e.level}), ${e.items} items captured with full details`;
    case 'equip':
      return e.movedFrom
        ? `${slotName(e.slot)}: ${item(e.itemId)} moved over from ${slotName(e.movedFrom)}`
        : `${slotName(e.slot)}: equipped ${item(e.itemId)}`;
    case 'unequip':
      return `${slotName(e.slot)}: unequipped ${item(e.itemId)}`;
    case 'dump':
      return `Data dump${e.name ? ` ${e.name}` : ''}: ${e.items} items captured`;
    default:
      return e.kind;
  }
}

export default function Feed({ feed, equipment }) {
  const slotName = (slot) => equipment.find((e) => e.slot === slot)?.label ?? `Slot ${slot}`;
  const entries = feed.slice().reverse();
  return (
    <Panel title="Live log events" right={`${feed.length}`}>
      {entries.length ? (
        <ul className="feed">
          {entries.map((e, i) => (
            <li key={`${e.at}-${e.kind}-${e.slot ?? ''}-${i}`} className={`feed-${e.kind}`}>
              <time>{fmtTime(e.at)}</time>
              <span>{describe(e, slotName)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Equip or unequip something in game and it shows up here.</p>
      )}
    </Panel>
  );
}
