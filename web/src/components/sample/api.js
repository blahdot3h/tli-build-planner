// Calls to the sample build API (server/sample); each returns the page (build, character, DPS)
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server said ${res.status}`);
  return data;
}

export const getPage = () => call('GET', '/api/sample');
export const getCatalog = () => call('GET', '/api/sample/catalog');
// Merge a patch ({ level: 85 }, { scenario: {...} }); null deletes a key
export const patchSample = (patch) => call('PUT', '/api/sample', patch);
// Replace one part of the build wholesale (gear, skills, talents, pactspirits, hero, extraLines)
export const replaceSample = (key, value) => call('PUT', `/api/sample/${key}`, { value });
export const loadPreset = (preset) => call('POST', '/api/sample/preset', { preset });
export const fitTalents = (points) => call('POST', '/api/sample/fit', points ? { points } : {});
// craft: the tiers crafted rares may use (['T2'], ['T2', 'any']); left out, the server decides
export const rankUpgrades = (troveOnly, craft) => call('POST', '/api/sample/upgrades', { troveOnly, craft });
export const applyUpgrade = (label) => call('POST', '/api/sample/upgrades/apply', { label });
export const findPath = (target, troveOnly, craft) => call('POST', '/api/sample/path', { target, troveOnly, craft });
// Kept builds: open one, keep the open one as a named copy (and open it), delete one
export const openBuild = (id) => call('POST', '/api/sample/open', { id });
export const saveBuildAs = (name) => call('POST', '/api/sample/save', { name });
export const deleteBuild = (id) => call('DELETE', `/api/sample/saves/${encodeURIComponent(id)}`);
export const copyLiveSlates = () => call('POST', '/api/sample/slates/copy-live');
// A price you know (fe null forgets it), and the price cap per item the ranking and path keep to
export const setPrice = (name, fe) => call('PUT', '/api/sample/prices', { name, fe });
export const setMaxFe = (maxFe) => call('PUT', '/api/sample/maxfe', { maxFe });
export const applyPath = () => call('POST', '/api/sample/path/apply');
