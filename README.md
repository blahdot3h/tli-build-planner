# TLI Build Planner

Reads Torchlight Infinite's `UE_game.log` while you play and shows your character in a local web
app: gear with every affix and roll, skills and supports, talent trees, slates, hero memories, a
stat sheet (life, energy shield, resistances, attributes) and DPS for your main skill.

## Run it

Needs Node 22.13+ (24 recommended). History goes in a SQLite file (`data/planner.sqlite`) out of
the box; MongoDB is used instead when `MONGODB` is set in `.env`.

```
npm install
npm run import:tlidb   # once per season: builds data/gamedata from tlidb.com (~10 min first run, cached after)
node scripts/import-hero-traits.js && node scripts/build-engine.js --force   # after it: hero trait ids and the engine's hero table from the cached hero pages
npm run dev            # http://127.0.0.1:4317 (Express + Vite with hot reload)
npm test               # parser and game state tests
npm run cli            # print what the planner reads from the log, without the web UI or a database
npm run app            # the desktop app: planner window + in-game overlay
npm run dist           # a downloadable Windows build of the desktop app (dist/*.exe, electron-builder)
npm run site:dev       # the public website (site/), http://localhost:5173
```

`npm run build` then `npm start` serves the built UI without Vite. Both `dev` and `start` bundle
the DPS engine first (`npm run build:engine` forces a rebuild).

In game, logging has to be on (`GameLuaNetLogEnable=True` in `GameUserSettings.ini`). Use
**Test log connection** in the top bar to confirm the server is caught up with the log.

## Configuration (`.env`)

| Variable | Default | |
| --- | --- | --- |
| `TLI_DATA_DIR` | `data/` | Where the planner writes: its SQLite database, screenshots, price caches. The packaged app uses its app-data folder. |
| `TLI_DB` | `<TLI_DATA_DIR>/planner.sqlite` | The SQLite file (`:memory:` keeps nothing) |
| `MONGODB` | none | MongoDB connection string; set, it's used instead of SQLite (`server/db`) |
| `MONGODB_DB` | `tli_build_planner_test` | MongoDB database name |
| `TLI_CLOUD_URL` | none | The public market's URL (`cloud/`); without one the Market panel is off |
| `TLI_LOG_PATH` | found via Steam libraries | Full path to `UE_game.log` |
| `PORT` / `HOST` | `4317` / `127.0.0.1` | Where the web app listens |

## The public market and the website

`cloud/` is a Cloudflare Worker over D1 (free tier) that keeps prices by item **and roll**: a
legendary signs as its id plus each rolled line's fifth of its range, a crafted rare as its base
plus its Ultimate / T0 lines (`server/cloud/signature.js`), anything else by base id. Planner users
who turn on **Share what I see** in the Market panel send, under a random id, the Exchange price
checks the log shows and prices they type for an item; builds go up only with **Share this build**
(gear by signature, hero, main skill, DPS; no name or id). The planner downloads the season's folded
prices once in a while (`data/prices/cloud-<season>.json`), so legendaries finally have prices in
the sample build's upgrade ranking and price cap, and the farm tracker's FE count shows what you can
spend. `cloud/README.md` has the deploy steps and the API (public, rate-limited per IP).

`site/` is the public website (GitHub Pages, `.github/workflows/pages.yml`): the overlay download,
a price search and the shared builds, all read from that API. Tagging `v*` builds the Windows app
and attaches it to a GitHub Release (`.github/workflows/release.yml`); pushes to `cloud/` redeploy
the Worker (`worker.yml`, needs the Cloudflare secrets).

## Where the data comes from

- **The game log.** At login the game dumps the whole character (`GetPlayerData`): equipped items
  with affix ids and rolls, talents, slates, memories, skills, and the game's recorded peak DPS
  (`HistoryMaxDps`). Equip/unequip shows up live as `ItemChange@` lines with item ids only; details
  come from the login dump and from MongoDB, which remembers every item seen. The game cuts every
  list in a dump at 30 entries (`+31+...`), which can clip big bags, talent trees and the Pact
  board. What's past a cut comes from screenshots read into the character's choices (the "Missing
  character data" panel asks for them): a tree the log cut off keeps its logged nodes and takes the
  screenshot-read tree's nodes past the cut (the log lists nodes in id order and drops the tail),
  Pact board Fates from screenshots count only on spots the log doesn't list itself, and every
  such entry auto-saves a build ("★ Auto: … from screenshots" in the snapshot list) so nothing
  read by hand is lost. A copy of the character in the sample builds takes the Destinies and
  stat lines as the live view uses them, so it computes the same.
- **tlidb.com** maps the log's numeric ids to names and text: its pages carry the game's own ids
  (`data-modifier-id` on every stat line, `id:` on skill / item / legendary pages, `data-id` on
  talent nodes). `scripts/import-tlidb.js` crawls it into `data/gamedata/*.json`; each talent tree
  page also gives `talentTrees.json`: the current layout (node ids encode column and row), icons,
  max points, the points each column needs and each core talent's unlock points, plus the tree's
  portrait. Every page's picture comes along too: a legendary's own art, a base item's generic art
  (what crafted gear shows), skill, memory, slate shape, Destiny and prism icons, pactspirit art and
  hero pages' portraits and trait icons (matched by name). Pictures tlidb hasn't uploaded yet (a card
  with only the game's asset path) show the name's first letter. Icons are shown straight from
  tlidb's CDN. Ids the import
  can't get go in hand-maintained `data/gamedata/<kind>.local.json` files, merged on load: newer
  heroes' trait tree nodes (tlidb hero pages' `data-node-id`) and prism core talents such as
  Escalating Affliction. Pactspirits have no ids on tlidb.
- **The game's own help manual.** The client caches an English affix manual next to the log
  (`UE_game/Local/CommonCache/HelpManualV2AffixData`). It names affixes tlidb doesn't, such as hero
  memory random affixes (`4021<NNN>00`, shown with the top roll; the log's roll replaces it). The
  cache can be a season or more old, so it's only a fallback for names.
- **DPS and stats** come from [Torchlight of Building](https://github.com/aclinia/torchlight-of-building)
  (MIT), vendored in `vendor/torchlight-of-building` with a few additions listed in its
  `VENDORED.md`. `server/engine/bridge.js` turns the logged character into that engine's save
  format. **Formula DPS** is the engine's steady-state number (tooltip-style) with the combat
  toggles in the DPS panel (enemy Frostbitten, Afflicted, Cursed, blessings...), which the log
  can't tell us; **sheet DPS** leaves the toggles off.
- **In-game DPS** comes from `server/sim`: it plays out a 30 s fight against a dummy in 0.05 s
  steps — cast timing, Terra Charges consumed per cast, Gash stacks, Frostbite / Affliction /
  Torment / Focus Blessing ramping up, reaping on its cooldown — asking the engine for damage in
  each state. It tries several recast timings and keeps the best. Base values the game data
  doesn't state (1 base Terra Charge, 1 per second) are listed in the panel. For Tide Whisper
  Selena - Dance of the Deep it adds her traits (`server/sim/selena.js`): additional Terra damage,
  Crimson Tide, the Paradise curse, and The Cycle I Resist's reap on every recast. With Ominous on
  the target it adds Ill Omen's True Damage, taking the dummy as an Elite: 20% of Max Life per 10
  stacks, a stack per 5% of Max Life in DoT and Reaping damage. The Terra applies a 2 s DoT instance
  every second and the instances stack (about 2 at once); Terra Charges come back every 0.5 s.
  A reap takes at most the DoT's own 2 s. Combat toggles try the alternatives: reaps that take
  the whole Terra, and Ill Omen bursts that count toward the next stacks. Frost Terra casts instantly, so the
  recast rate is its cooldown (0.5 s less Cooldown Recovery Speed), or the interval typed into the
  combat toggles. Recasts vary ±10% like a player's, and each timing strategy averages five
  fights; a metronome beat would let Gash lapse or hold by luck. Attack skills get their own fight
  (`server/sim/attack.js`): for Berserker Rehan - Seething Silhouette it builds Rage, enters
  Berserk and adds the Seething Spirit's casts (`server/sim/rehan.js`); other heroes attack at a
  steady rate.
- **Attack crits are rolled per hit** (Double Thrusts hits twice), averaged over five fights. That
  gives the attack simulation the spread a real parse has, so its best 5 s can be compared with
  the dummy's. TLI Builder's steady parses show best 5 s 13-17% over the average.
- **Hero trait levels** come from each trait's memory (`ReminiscenceLevel` in the log): 1, +1 at
  memory level 30, +1 at 50, plus "+N to Hero Trait Level", up to 5; the base trait is 1 (TLI
  Builder, confirmed in game).
- **Low Life** follows from sealed Life: the engine's sealed-Life share sets "Current Life %" in
  the combat toggles, so a build that seals most of its Life counts as at Low Life.
- **The game's own figures.** Hovering an item makes the game log its sheet DPS and DEF for your
  current gear and for the hovered item (`AttributeMgr:Log ... DPS: now -> with item`). The
  planner shows the latest figure and the item compares. It's a reference only: it leaves out
  much of what a build does in a fight.
- **Dummy tests.** The hideout training dummy's window ("WoodenMan") is logged with your DEF while
  it's open, and combat sounds show when you're attacking, so each session is listed with its
  attacking time. The dummy's DPS isn't logged: type in its best 5 s figure and it's saved to
  MongoDB (`dummyTests`) with the build you used, then compared with the simulation's best 5 s.
- **The attribute panel.** Opening the attribute tab of a character screen makes the game log
  every row (`RoleAttrMgr@Attri.Id  Spell DPS  10103` then its value), after an
  `AttrUtils:SetPlayerId` line saying whose it is. Your own panel is kept with the character
  (`gameStats.panel`, flagged stale once your gear changes) and shown in the Stat breakdown; another
  player's is kept apart (`viewedPanel`), and their level line is ignored so it doesn't overwrite
  yours.
- **Core talents** come from each tree's `bonusGeniusInfo` in the login dump (they aren't nodes).
- **Calibration so far** (CoffeeDeadProb, Seething Silhouette Rehan, golem at 60% resistance and
  no armor): Double Thrusts alone simulates at 83-93% of three golem runs (with/without Haunt,
  Ritual of Offering). Those runs show the Seething Spirit adds almost no damage the golem counts,
  so the simulation gives it none (it still feeds Rage). Spiral Strike's own hits aren't simulated,
  so a full rotation reads low (about 58% of the golem's best 5 s).
- **Frost Terra so far** (CoffeeTerra, Selena - Dance of the Deep): the engine's bonuses match the
  in-combat Damage tab within about 1%: Damage Bonus, additional damage, Affliction Effect,
  Reaping Duration and Penetration. Its unexplained gap is +43% vs +19% additional elemental
  damage. Against the golem test (6.62B average over 34 s, 11.28B best 5 s), the simulation gives
  7.1B average and 8.3B best 5 s on the Lv85 dummy at the player's 375 ms recast. Of the open
  mechanics, only this combination fits: no extra DoT instance per recast, reaps limited to the
  DoT's 2 s, no Ill Omen self-feeding. Turning any of them on overshoots 1.5-10x.
- **TLI Builder** ([github.com/Tyrayla/TLIBuilder](https://github.com/Tyrayla/TLIBuilder), MIT code) has
  in-game verification notes (`docs/verification/`) that this planner uses as a source of rules. They
  cover the training dummy (Lv40/60/75/85 armor and the "Training dummy level" toggle; its
  resistances are the planner's own fit, 0/10/20/40%, from a cold spell build's runs on each level),
  Terra Charge restore 0.5 s and max 1, Frost Terra's stacking DoT instances, armor not affecting DoT,
  and Ill Omen. Its compiled data files are not used; their data notice asks people not to.
- **Hero and traits** are inferred from the log's ids: the hero from its id (310 Rehan, 600 Carino,
  700 Erika, 810 Bing, 900 Gemma, 1100 Thea, 1300 Youga, 1400 Moto, 1500 Rosa, 1600 Iris, 1700
  Selena, 1800 Sage) and the purchase id's version, the traits by name through
  `data/gamedata/heroTraits.local.json`, which `node scripts/import-hero-traits.js` builds from
  tlidb's hero pages (their `data-id`s are the log's ids). Trait levels come from each trait's
  memory slot. Everything can be changed in the UI.
- **Every hero's traits have a model** (`vendor/.../tli/hero/hero-trait-mods.ts`, values from
  tlidb's SS14 pages; the same script regenerates the engine's hero table so the names match the
  game's, including Youga's The Ultimate One). Stat-like effects go in as mods; resources the log
  can't show are combat toggles at their full values (Rage, Heat Up stacks, Special Ammo share,
  Purgatory seconds, Murderous Intent, Command, Nourishment, the Divine Realm and Loud Song
  forms); traits that scale each other resolve together (Moto's Overload Effect, Thea's Prophecy
  of Purity on God's Boon, Selena #1's Tide Effect); Youga #1's illusions add their casts to yours.
  What a trait's numbers leave out (Burst, reloads, bombs, kills, Clockwork Core...) is listed per
  picked trait in the "not counted" list (`server/sim/heroNotes.js`).
- **Scent Weaver Sage (Licorice Note)**: her traits are in the engine with tlidb's SS14 values
  (`vendor/.../hero/hero-trait-mods.ts`). Elixir skills (Dews, Tonics, Distillates) are buff skills
  built from their tlidb cards (`server/engine/elixirs.js`, a straight line from the level-1 to the
  level-20 text) and scaled by Skill Effect plus Elixir Skill Effect; Everlasting Nectar adds a
  share of the larger of the Max Life and Max Mana bonuses, Scent of Ambition and Artificial Moon
  (Licorice Note level 5) are additional Elixir Skill Effect, Pungent Stimulant Salt hands a share
  of the elixirs' bonus to every slotted Empower and Curse skill (all taken as prepared), and
  Elixir of Immortality counts Temporary Life at its cap unless the "Temporary Life %" toggle says
  less. The Scent Bottle ingredients never reach the log, so they're picked under "Hero &
  pactspirits" (`server/sim/sage.js` turns them into stat lines: Razor Leaf, both Scattered Spore
  stacks, Pixie Tear per 400 Max Energy Shield, Thunder Dragon Scale's bonus, Spectral Stamen;
  Twinspine Flower's double Reap and the defence-only ones are listed as not counted). Elixirs are
  taken as always up, like every buff. Pungent Stimulant Salt prepares one random equipped
  Empower or Curse at a time, so its share is split across them. The game data has no card for
  Barrier Burst (the skill Necklace of Firebird grants): it's modelled as a share of your Barrier
  (20% of Max Life + Max Energy Shield, with Barrier Shield bonuses) dealt as Spell Fire damage
  once per hit taken while shielded, both from combat toggles ("Barrier Burst: % of Barrier",
  default 75% from an SS10 guide until the tooltip is read; "triggers per second", default 1).
- **Talent advisor** (`server/calc/talents.js`) scores talent points with the in-game simulation at
  full buff uptime (one engine run per allocation, ~700 per run, 15-20 s). It shows what one more
  point is worth in every node you could take now, and the next 5 points in order. It then moves
  points from damage nodes to damage nodes, one at a time, while that adds DPS; a node counts as
  a damage node when one point there changes DPS. The rules come from the game's help and tlidb:
  column gates, full prerequisites (the engine's, else the node to the left), no points on the
  prism's spot (read from the log), and enough points left for the picked core talents. The
  Talents panel draws each tree like the game with tlidb's icons and marks the advice on it.
- **Best pactspirit trio** scores every legendary pactspirit alone, compares every trio of the
  strongest 20 by formula, then re-ranks the top 15 by the simulation. The log stores pets as
  numeric ids that tlidb doesn't publish; the ones matched to names from the in-game Pact page
  (`LOG_PACTSPIRITS` in `server/engine/bridge.js`) are applied automatically.
- **Characters and snapshots.** The character picker lists every character in MongoDB, not just
  the ones in the current log. One that isn't in the log loads from its newest snapshot (taken at
  login and after each gear change), and the snapshot picker steps back through older ones, each
  labelled with what changed ("Necklace: Law of Greed off"). Snapshots are recalculated with
  today's code, game data and the character's toggles. Snapshots taken from now on keep the
  login dump (`logins` collection) and rebuild exactly; older ones only stored the built
  character, so its names and stat text are looked up again from the ids. **Save build…** stores
  what's shown under a name, with its combat toggles and picks, and loading it brings those back.
  Toggles and picks changed on any character are saved for it straight away. The planner reopens
  on what it showed last; logging in follows the new character, and while nobody is logged in it
  shows the newest snapshot. **What-if on skills:** every skill in the Skills panel has a switch;
  switched off (`choices.disabledSkills`) it leaves its slot empty for the engine and the
  simulation, the DPS panel says what the figures are with everything on, and "What each skill
  adds" computes the DPS without each skill in turn (`POST /api/skills/contributions`). Gear
  lines show their **tier** in the game's colours (T0 red, T1 gold, T2 purple, T3 blue, T4
  green): a crafted line's tier is the last two digits of its affix id, cross-checked against the
  craft tier table's ranges (`server/game/tiers.js`); legendary lines have none. **Divinity
  slates** get their own panel under the skills: the board as a grid with each slate on its spot
  (the login dump's `Index`, row then column), each slate's lines in the game's slot colours with
  their Effect bonus and the lines copied off neighbours, a what-if switch per slate
  (`choices.disabledSlates`) and "What each slate adds" (`POST /api/slates/contributions`, with an
  "every slate together" row). The board is the game's 24-cell diamond (rows of 2, 4, 6, 6, 4
  and 2 cells); the dump's `Index` is column then row. Shapes aren't in the log or on tlidb:
  `data/gamedata/slateShapes.local.json` maps a `ShapeId` to the cells it covers at direction 0,
  and `server/game/slates.js` turns them (each Direction is a quarter turn clockwise about the
  spot), read off a screenshot of the board (the Statue of The New God screen is captured as it
  opens); until a shape is known its slate is drawn on its spot alone. Slates can be dragged to
  another spot and turned (R / Shift+R, arrow keys): a what-if kept as `choices.slateLayout`
  (`PUT /api/slates/layout`, refused when it would leave the board or overlap), after which the
  engine recomputes what each copying slate (When Sparks Set the Prairie Ablaze: the last line of
  every slate it shares an edge with, never a core talent) takes off its neighbours, and the DPS
  panel shows the figures with the board as in game. Slates are drawn with their own pictures cut
  out of screenshots of the board (`web/public/slate-sprites/`, listed in
  `data/gamedata/slateSprites.local.json` by `<unique or base id>_<ShapeId>_<Direction>`; the
  board's cells and gaps keep the game's proportions so a picture lands on its cells); a slate
  without one shows tlidb's art over a coloured fill. **Supports:** click any support in the
  Skills panel (or "+ support" in an empty slot) to pick another one from every support that fits
  the skill (`choices.supportSwaps`, `POST /api/skills/supports/compare` with `listOnly`), or
  "Compare every support here" for a table of the DPS with each one against the gem logged there,
  gains green and losses red; the Skills and DPS panels show the build's total against the
  as-logged figure the same way. Two engine rules verified against the game on 2026-11-02 live
  in the vendored source (`vendor/torchlight-of-building/src/tli/calcs/`): the same support
  socketed and granted by gear counts once, at the higher level (offense.ts), and a spell's base
  crit rating is its weapons' rating, both when dual wielding (damage-calc.ts); keep both when
  updating the vendored engine. **Gear what-if:** every slot in the Equipped gear panel has a
  "what-if" button: keep the logged item, leave the slot empty, put a legendary there (tlidb's
  lines at a roll, its random options, corroded) or build a rare from a base type line by line
  (`choices.gearSwaps`, the sample builds' gear spec per slot); the panel and the DPS panel show
  the total against the as-logged figure. **Character data panel:** lists what comes from the
  log (reloads by itself; "Rescan the log" re-reads the file) and what is read off screenshots
  (`calc.sources`), each with when it was read, a Capture button and "changed in game" to forget
  it so it is asked for again; screenshot-read choices carry a `<key>At` timestamp. Combat toggle
  "Empower/Defensive effects on you from allies or auras" (default 0): what Bing's Multi-Coupling
  Equation counts beyond the build's own Activation Medium skills. Dummy calibration 2026-11-02/03
  (CoffeeBingBong, Psionic Missile, Lv40-85 dummies, runs of 3-6 minutes; shorter runs scatter
  about 14% with Ingenuity Overload timing): the dummy's armor doesn't cut non-physical hits
  (toggle "Enemy armor also cuts non-physical hits" brings TLI Builder's 60% back) and its
  resistances are 0/10/20/40% at Lv40/60/75/85; the Spell Burst bar takes 2 s at +0% charge speed
  whatever Max Spell Burst is (a bigger bar fires more casts; sim `stacksPerBar` null); an
  Activation-Medium-cast Ice Bond counts as an Empower skill for Multi-Coupling and gets its
  Euphoria at its level (tlidb's table) plus one Mass Effect charge and no Well-Fought Battle
  stacking (toggles "Empower skill casts in a row" 0, "Charges an Empower skill is used with" 2);
  Genius Idea Generator's "+100% Whimsy Effect" doubles Mind Domain's Whimsy stacks (+10% a
  stack, engine `WhimsyEffPct`) and the Ingenuity a Whimsy Explosion restores (toggle "Ingenuity
  Essence a Whimsy Explosion restores", 50); Frozen is a crowd control state, not an ailment type
  (Ailment Termination and Dirty Tricks count five on his dummy); Illusory Chimera's "buffs by
  turns" count as the average of the turns the main skill's damage takes, each up (1 + Skill
  Effect Duration) / 3 of the time (the engine's line), and the simulation plays the turns out so
  the overlap spikes the best 5 s; a prism's "All <type> Talent within the area" lines count per
  point. After these: within 3% on average DPS across every state measured (gear off one piece
  at a time, supports off, Ice Bond off, four dummy levels); the best 5 s reads 13% low with
  three supports (the game's Overloads bunch more than the simulation's).
- **Sample builds** (the "Sample build" tab, `server/sample/`): a character you plan rather than one
  read from the log, computed by the same engine and simulation. Start from a preset (Bing #2
  Splitting Lightning Bolt plans for SS14) or a copy of the logged character, then gear each slot:
  legendaries use tlidb's current-season lines at the rolls you pick (Treasure Trove ones, drop
  level 54 or less, listed first), and crafted rares take lines from each item type's tier table
  (tlidb's Craft tabs: T2 is the best item level 82-85 rolls). Skills, supports (SS14 numbers),
  talent trees ("Recommended Bing 2 trees", "Fit to N points"), hero traits and pactspirits are
  editable. **Rank upgrades** tries every single change (legendaries per slot, each slot's best
  craft, gems, supports, pactspirits, trait levels) and **Cheapest path** applies the best change
  for its rough cost until a DPS target. Gem prices come from TITrack Economy
  (`node scripts/import-titrack.js`, per season); no site tracks legendary gear prices.
- **Farming tracker** (the "Farming" tab, the overlay's Farm view, `server/farm/`): what the YiHuo
  ETor overlay shows, from the planner's own log reading. Pickups are the `ItemChange@` blocks
  inside `ProtoName=PickItems`: each line gives a bag stack's new total, so loot is the change from
  the last known total (which is only trusted once the game has re-sent the bag pages, at login or
  when the bag opens). What the map device consumed (`ProtoName=Spv3Open`) is the map's cost. A run
  starts on entering an area that isn't the hideout/town (the dump after
  `SwitchBattleAreaUtil:_JoinFightSuccess()`: `+maptype [Mystic]` vs `+checkType [MainCity]`),
  pauses in town, and ends when the next map starts; finished runs go to MongoDB (`farmRuns`).
  Prices are ETor's public market (`etor-beta.710421059.xyz/etor-api`, per season, cached in
  `data/prices/etor-<season>.json`, refreshed every 15 minutes, nothing about you is sent), your
  own Exchange price checks when newer, or a price you type on a drop; organs are never priced and
  the Exchange's 12.5% cut comes off loot (toggle). Item names and pictures for everything that
  drops: `node scripts/import-loot-items.js` → `data/gamedata/lootItems.json`. Gear is logged by
  its base only, so an unidentified legendary looks like any rare of that base: such drops show as
  "?" with a yes/no question, "was it <the legendary on this base that sells>?" (ETor's prices show
  nearly every base has one legendary worth money and the rest fetch almost nothing); yes marks
  it, no moves to the next one worth over 10 FE or makes it a rare. Once the game sends the
  identified item's details (a relog), the planner's item catalog settles it by itself. In the desktop app
  (`npm run app`) the overlay has a **Farm** view and a **mini box** (▣, or Ctrl+Shift+M): ETor's
  six rows in a small translucent box sized to its content; its 📌 (or Ctrl+Alt+P) pins it so
  every click reaches the game, and unpins it. The pin key can be changed from the box's ⚙ (press
  the new keys; it is kept in `%APPDATA%\Electron\overlay.json` under `hotkeys`). Hotkeys are
  global, so one a browser or the game already uses (Ctrl+Shift+T reopens a browser tab) is a bad
  choice.
- **tlidb's SS14 pages carry no modifier ids** on their listing pages any more, so the affix table
  the log needs (21,758 texts) can't be rebuilt from tlidb: the importer merges every table with
  the previous one instead of replacing it. Don't delete `data/gamedata/*.json`.

## Layout

```
server/log/      locate, tail and parse UE_game.log (tree dumps + game events)
server/farm/     drops, map runs and FE/hour from the log, valued with ETor's market
server/game/     live game state and the character view model
server/gamedata/ id -> name/text lookup tables
server/engine/   engine bundle entry + bridge from log character to engine save
server/calc/     formula DPS, stat sheet, coverage, pactspirit trio search
server/sim/      in-game DPS simulation
server/sample/   sample builds: presets, catalog, upgrade ranking, cheapest path, prices
server/db.js     MongoDB: characters, items, snapshots, logins, events, dummy tests, settings
scripts/         tlidb importer, TITrack price import, engine bundler
vendor/          Torchlight of Building engine (MIT)
web/             React UI (Vite)
```
