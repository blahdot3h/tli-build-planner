// The public site: what the planner is, where to download the overlay, and the market the
// planner's users feed (cloud/): legendary prices by roll, Ultimate-affix rares, shared builds.
// Everything here is read straight from the market API (public, cached at Cloudflare's edge).
import { useEffect, useState } from 'react';

const API = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const REPO = import.meta.env.VITE_REPO_URL || 'https://github.com/YOUR-GITHUB/tli-build-planner';
const CONFIGURED = API && !/YOUR-SUBDOMAIN/.test(API);

const fe = (n) => (n == null ? '—' : n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const ago = (ms) => {
  if (!ms) return '';
  const h = (Date.now() - ms) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
};
const compact = (n) => (n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n));

async function get(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, '') || 'home';
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const [page, ...rest] = route.split('/');
  return (
    <div className="site">
      <header className="top">
        <a className="brand" href="#/">
          TLI Build Planner
        </a>
        <nav>
          <a className={page === 'home' ? 'on' : ''} href="#/">
            Overlay
          </a>
          <a className={page === 'prices' ? 'on' : ''} href="#/prices">
            Prices
          </a>
          <a className={page === 'builds' ? 'on' : ''} href="#/builds">
            Builds
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>
      <main>
        {page === 'prices' ? <Prices family={rest[0] ? decodeURIComponent(rest[0]) : null} /> : page === 'builds' ? <Builds id={rest[0] ?? null} /> : <Home />}
      </main>
      <footer className="muted small">
        Prices are what planner users saw on the Exchange or typed in, folded per item and roll; nothing about any player is kept. Torchlight Infinite is XD's; this is a fan project.
      </footer>
    </div>
  );
}

function Home() {
  return (
    <div className="home">
      <h1>Your build, your gold, your next upgrade.</h1>
      <p className="lead">
        An overlay for Torchlight Infinite that reads the game's own log: your gear with every roll, skills, talents, simulated in-game DPS, drops and FE per hour. With the market it also knows
        what gear costs, so it can rank upgrades by what you can afford right now.
      </p>
      <div className="cta">
        <a className="button" href={`${REPO}/releases/latest`}>
          Download for Windows
        </a>
        <a className="button secondary" href={`${REPO}#readme`}>
          Run from source
        </a>
      </div>
      <section className="cols">
        <div>
          <h3>Nothing to install besides the app</h3>
          <p>The planner keeps its history in a SQLite file in your app-data folder. No database server, no account.</p>
        </div>
        <div>
          <h3>Prices by roll</h3>
          <p>A legendary with a top-rolled line prices apart from a floor roll; a rare prices by its Ultimate lines. Sharing what you see is opt-in and anonymous.</p>
        </div>
        <div>
          <h3>Builds that work</h3>
          <p>Share a build from the planner and others can see its gear, hero, main skill and simulated DPS, and what each piece goes for.</p>
        </div>
      </section>
      {!CONFIGURED && <p className="note">This copy of the site has no market API configured yet (set VITE_API_BASE when building it).</p>}
    </div>
  );
}

function Prices({ family }) {
  const [seasons, setSeasons] = useState([]);
  const [season, setSeason] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CONFIGURED) return;
    get('/v1/seasons')
      .then((b) => {
        setSeasons(b.seasons);
        if (b.seasons[0] && !season) setSeason(b.seasons[0].season);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!CONFIGURED) return;
    setBusy(true);
    const url = family ? `/v1/prices/family/${encodeURIComponent(family)}${season ? `?season=${season}` : ''}` : `/v1/prices?limit=100${season ? `&season=${season}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    get(url)
      .then((b) => {
        setError(null);
        if (family) setDetail(b);
        else setRows(b.prices);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [q, season, family]);

  if (!CONFIGURED) return <p className="note">No market API configured.</p>;
  return (
    <div>
      <div className="toolbar">
        <h1>Prices</h1>
        <select value={season} onChange={(e) => setSeason(e.target.value)}>
          {seasons.map((s) => (
            <option key={s.season} value={s.season}>
              Season {s.season} · {s.items} items
            </option>
          ))}
        </select>
        {!family && <input placeholder="Search an item (Law of Greed, Solid River…)" value={q} onChange={(e) => setQ(e.target.value)} />}
        {family && <a href="#/prices">← all items</a>}
      </div>
      {error && <p className="note">{error}</p>}
      {family ? (
        <FamilyDetail detail={detail} family={family} />
      ) : (
        <table className={busy ? 'busy' : ''}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Rolls</th>
              <th className="num">Low</th>
              <th className="num">Typical</th>
              <th className="num">High</th>
              <th className="num">Seen</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.signature}>
                <td>
                  <a href={`#/prices/${encodeURIComponent(r.family)}`}>{r.name ?? r.signature}</a>
                  <div className="muted small">{r.kind === 'rare' ? `${r.type ?? 'rare'}, Ultimate lines` : r.kind}</div>
                </td>
                <td className="small">
                  <Mods mods={r.mods} kind={r.kind} />
                </td>
                <td className="num">{fe(r.p25)}</td>
                <td className="num strong">{fe(r.median)}</td>
                <td className="num">{fe(r.p75)}</td>
                <td className="num">
                  {r.n} <span className="muted">/ {r.reporters}</span>
                </td>
                <td className="muted small">{ago(r.lastSeen)}</td>
              </tr>
            ))}
            {!rows.length && !busy && (
              <tr>
                <td colSpan={7} className="muted">
                  Nothing seen yet{q ? ` for "${q}"` : ''}. Prices arrive as planner users turn on sharing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Mods({ mods, kind }) {
  if (!mods?.length) return <span className="muted">any</span>;
  if (kind === 'rare') return mods.map((m) => `${m.part} T${m.tier ?? '?'}`).join(', ');
  const stars = (b) => '●'.repeat(b + 1) + '○'.repeat(4 - b);
  return (
    <span className="rolls" title="Each rolled line's position in its range, bottom fifth to top fifth">
      {mods.map((m) => (
        <span key={m.id}>{stars(m.roll ?? 0)} </span>
      ))}
    </span>
  );
}

function FamilyDetail({ detail, family }) {
  if (!detail) return <p className="muted">Loading…</p>;
  const f = detail.family;
  return (
    <div>
      <h2>{f?.name ?? family}</h2>
      {f ? (
        <p>
          Any roll: <strong>{fe(f.median)} FE</strong> typical, {fe(f.p25)}–{fe(f.p75)} FE for most, from {f.n} sightings by {f.reporters} people, last {ago(f.lastSeen)}.
        </p>
      ) : (
        <p className="muted">No sightings in this season.</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Rolls</th>
            <th className="num">Low</th>
            <th className="num">Typical</th>
            <th className="num">High</th>
            <th className="num">Seen</th>
          </tr>
        </thead>
        <tbody>
          {detail.signatures.map((s) => (
            <tr key={s.signature}>
              <td>
                <Mods mods={s.mods} kind={s.kind} />
                <div className="muted small">
                  {s.mods?.map((m) => (m.rollPct != null ? `${m.id}: ${m.rollPct}% of range` : `${m.family ?? m.id} T${m.tier}`)).join(' · ')}
                </div>
              </td>
              <td className="num">{fe(s.p25)}</td>
              <td className="num strong">{fe(s.median)}</td>
              <td className="num">{fe(s.p75)}</td>
              <td className="num">
                {s.n} <span className="muted">/ {s.reporters}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <a href={`#/builds?family=${encodeURIComponent(family)}`}>Builds using this item</a>
      </p>
    </div>
  );
}

function Builds({ id }) {
  const [rows, setRows] = useState([]);
  const [one, setOne] = useState(null);
  const [error, setError] = useState(null);
  const [hero, setHero] = useState('');
  const [skill, setSkill] = useState('');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const family = params.get('family');

  useEffect(() => {
    if (!CONFIGURED) return;
    if (id && !id.includes('?')) {
      get(`/v1/builds/${encodeURIComponent(id)}`)
        .then((b) => setOne(b.build))
        .catch((e) => setError(e.message));
      return;
    }
    const qs = new URLSearchParams();
    if (hero) qs.set('hero', hero);
    if (skill) qs.set('skill', skill);
    if (family) qs.set('family', family);
    get(`/v1/builds?${qs}`)
      .then((b) => setRows(b.builds))
      .catch((e) => setError(e.message));
  }, [id, hero, skill, family]);

  if (!CONFIGURED) return <p className="note">No market API configured.</p>;
  if (id && !id.includes('?')) return one ? <BuildDetail build={one} /> : <p className="muted">{error ?? 'Loading…'}</p>;
  return (
    <div>
      <div className="toolbar">
        <h1>Builds</h1>
        <input placeholder="Hero (exact name)" value={hero} onChange={(e) => setHero(e.target.value)} />
        <input placeholder="Main skill (exact name)" value={skill} onChange={(e) => setSkill(e.target.value)} />
        {family && <a href="#/builds">× item filter</a>}
      </div>
      {error && <p className="note">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Hero</th>
            <th>Main skill</th>
            <th className="num">Level</th>
            <th className="num">DPS</th>
            <th>Shared</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>
                <a href={`#/builds/${b.id}`}>{b.hero ?? '—'}</a>
              </td>
              <td>{b.mainSkill ?? '—'}</td>
              <td className="num">{b.level ?? '—'}</td>
              <td className="num strong" title={b.dpsKind}>
                {compact(b.dps)}
              </td>
              <td className="muted small">{ago(b.createdAt)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="muted">
                No builds shared yet. In the planner, open your character and press "Share this build".
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BuildDetail({ build }) {
  const b = build.build;
  return (
    <div>
      <p>
        <a href="#/builds">← all builds</a>
      </p>
      <h1>
        {b.hero ?? 'Unknown hero'} · {b.mainSkill ?? '—'}
      </h1>
      <p>
        Level {b.level ?? '—'} · {compact(b.dps)} DPS ({b.dpsKind}) · season {b.seasonId ?? '—'} · shared {ago(build.createdAt)}
      </p>
      {b.notes && <p className="notes">{b.notes}</p>}
      <div className="cols">
        <div>
          <h3>Gear</h3>
          <ul>
            {b.gear.map((g) => (
              <li key={g.slot}>
                <span className="muted">{g.slot}: </span>
                <a href={`#/prices/${encodeURIComponent(g.family)}`}>{g.name ?? g.signature}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Skills</h3>
          <ul>
            {b.skills.map((s, i) => (
              <li key={i}>
                <strong>{s.skill}</strong>
                {s.supports.length ? <span className="muted"> · {s.supports.join(', ')}</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Hero traits</h3>
          <ul>{b.heroTraits.map((t) => <li key={t}>{t}</li>)}</ul>
          <h3>Pactspirits</h3>
          <ul>{b.pactspirits.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
