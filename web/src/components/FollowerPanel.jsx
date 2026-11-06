import Panel from './Panel.jsx';

// The follower (read from screenshots of its page: the log never lists it), each skill and support
// with what it does on hover, and what the planner counts on the enemy from it and the build
export default function FollowerPanel({ calc }) {
  const follower = calc?.choices?.follower;
  const ailments = calc?.enemyAilments ?? [];
  const cc = calc?.enemyCrowdControl ?? [];
  if (!follower && !ailments.length && !cc.length) return null;
  return (
    <Panel title="Follower & enemy debuffs" right={follower ? `${follower.name}${follower.level ? ` · Lv ${follower.level}` : ''}` : null}>
      {follower && (
        <div className="skills">
          {follower.skills.map((s) => (
            <div className="skill-row" key={s.name}>
              <span className="chip main" title={s.text ?? `${s.name}: what it does isn't modelled yet`}>
                {s.name}
              </span>
              <div className="supports">
                {s.supports.map((p) => (
                  <span key={p.name} className={`chip ${p.text ? '' : 'empty-chip'}`} title={p.text ?? `${p.name}: what it does isn't modelled yet`}>
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {follower?.lines?.length > 0 && (
        <p className="muted small">On you: {follower.lines.map((l) => l.text).join(' · ')}</p>
      )}
      <p className="small">
        <strong>Ailments on the enemy ({ailments.length}):</strong> {ailments.join(', ') || 'none'}
      </p>
      <p className="small">
        <strong>Crowd control on the enemy ({cc.length}):</strong> {cc.join(', ') || 'none'}
        {cc.length > 0 && !cc.includes('Intimidated') && <span className="muted"> (Wings of Light counts them only while it's Intimidated)</span>}
      </p>
    </Panel>
  );
}
