import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problems, treeLayout } from '../server/calc/talents.js';
import { talentPosition } from '../server/game/character.js';

// A tiny tree: column 1 has a micro node, column 2 a medium node that needs it full (3 points in
// the columns before), column 3 a node the prism sits on; picked cores need 6 points
const node = (x, y, type, maxPoints, prereq = null) => ({ x, y, type, maxPoints, requiredPoints: (y - 1) * 3, prereq });
const layout = {
  nodes: [node(1, 1, 'micro', 3), node(1, 2, 'medium', 3, { x: 1, y: 1 }), node(2, 2, 'micro', 3), node(1, 3, 'micro', 3)],
  prism: { x: 1, y: 3 },
  minPoints: 6,
};
const pts = (entries) => new Map(Object.entries(entries));

test('talent ids give column and row like the log', () => {
  assert.deepEqual(talentPosition(52010300), { x: 3, y: 1 });
  assert.deepEqual(talentPosition(52050100), { x: 1, y: 5 });
});

test('a valid tree has no problems', () => {
  assert.deepEqual([...problems(layout, pts({ '1:1': 3, '1:2': 3 }))], []);
});

test('tree rules: column points, full prerequisite, prism spot, max points, core minimum', () => {
  // medium node before its micro is full; column 2 also lacks 3 points before it
  assert.deepEqual([...problems(layout, pts({ '1:1': 2, '1:2': 1, '2:2': 3 }))].sort(), ['1:2:column', '1:2:prereq', '2:2:column']);
  assert.ok(problems(layout, pts({ '1:1': 3, '1:2': 3, '1:3': 1 })).has('1:3:prism'));
  assert.ok(problems(layout, pts({ '1:1': 4, '1:2': 2 })).has('1:1:max'));
  assert.ok(problems(layout, pts({ '1:1': 3, '1:2': 2 })).has('tree:cores'));
});

test("tlidb's tree drawing gives each node the one it's joined to, diagonals included", async () => {
  const { treeLinks } = await import('../scripts/import-tlidb.js');
  // Tree 52: r1c1 -> r1c2 (straight), r1c2 -> r2c3 (one row down); r1c3 has no line
  const nodes = { 52010100: {}, 52020100: {}, 52030200: {}, 52030100: {} };
  const html = `<g class="connections" fill="none">
<line x1="192" y1="82" x2="128" y2="82"/>
<line x1="320" y1="178" x2="256" y2="82"/>
</g>`;
  assert.deepEqual(treeLinks(html, nodes), [
    [52010100, 52020100],
    [52020100, 52030200],
  ]);
});

test('tree layouts take prerequisites from the links, micro nodes included', () => {
  const nodes = { 52010100: { name: 'Micro Talent', maxPoints: 3 }, 52020100: { name: 'Micro Talent', maxPoints: 3 }, 52030200: { name: 'Legendary Medium Talent', maxPoints: 1 }, 52030100: { name: 'Medium Talent', maxPoints: 3 } };
  const gd = { get: (kind, id) => (kind === 'talentTrees' && id === 'Test_Tree' ? { nodes, links: [[52010100, 52020100], [52020100, 52030200]] } : null) };
  const layout = treeLayout({ name: 'Test Tree' }, gd);
  const at = (x, y) => layout.nodes.find((n) => n.x === x && n.y === y);
  assert.deepEqual(at(1, 2).prereq, { x: 1, y: 1 });
  assert.deepEqual(at(2, 3).prereq, { x: 1, y: 2 });
  // Not joined: no prerequisite, even for a medium node with a node to its left
  assert.equal(at(1, 3).prereq, null);
  assert.ok(problems(layout, pts({ '1:1': 2, '1:2': 1 })).has('1:2:prereq'));
});
