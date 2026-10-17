import assert from "node:assert/strict";
import test from "node:test";
import { MAX_MAP_3D_NODES, layoutResearchMap3D, scorePaperSimilarity, similarityToDistance } from "./map-3d.mjs";

const paper = (id, extra = {}) => ({ id, ...extra });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const trio = [
  paper("a", { title: "Carbon sequestration caprock fracture transport", abstract: "Carbon caprock experiments on porous reservoir sandstone and pressure", references: ["W90", "W91", "W92"], topic_ids: ["T1", "T2"] }),
  paper("b", { title: "Carbon sequestration caprock fracture transport", abstract: "Carbon caprock experiments on porous reservoir sandstone and pressure", references: ["https://openalex.org/W90", "W91", "W92"], topic_ids: ["T1", "T2"] }),
  paper("c", { title: "Stellar luminosity hydrogen fusion evolution", abstract: "Spectroscopic telescopes investigate nuclear stellar atmospheres", references: ["W99"], topic_ids: ["T9"] }),
];

test("strong shared metadata yields a closer 3D pair than a distinct scientific topic", () => {
  const layout = layoutResearchMap3D(trio, []), [a, b, c] = layout.nodes;
  assert.ok(scorePaperSimilarity(trio[0], trio[1]).score > scorePaperSimilarity(trio[0], trio[2]).score);
  assert.ok(distance(a, b) < distance(a, c) * .45);
  assert.ok(distance(a, b) < distance(b, c) * .45);
  assert.ok(layout.method.stress < .03);
});

test("desired distance decreases strictly with metadata similarity and unknown stays unknown", () => {
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) { const current = similarityToDistance(i / 100); assert.ok(current < previous); previous = current; }
  assert.equal(similarityToDistance(0), 210); assert.equal(similarityToDistance(1), 36);
  for (const value of [null, undefined, NaN, Infinity, -1, 2]) assert.equal(similarityToDistance(value), null);
});

test("node, metadata and edge permutations are deterministic without mutating research records", () => {
  const works = [...trio, paper("d", { title: "Geological caprock pressure", references: ["W91", "W90"], topic_ids: ["T2", "T1"] })];
  const evidence = { provider: "OpenAlex", method: "indexed shared topics", topic_ids: ["T1", "T2"], score: .5 };
  const edges = [{ source: "d", target: "a", kind: "shares_topics", directed: false, evidence }, { source: "b", target: "c", kind: "cites", directed: true, evidence: { provider: "OpenAlex" } }];
  const before = structuredClone({ works, edges });
  const first = layoutResearchMap3D(works, edges);
  assert.deepEqual(layoutResearchMap3D([...works].reverse(), [...edges].reverse()), first);
  assert.deepEqual(layoutResearchMap3D(works.map((work) => ({ ...work, references: [...(work.references || [])].reverse(), topic_ids: [...(work.topic_ids || [])].reverse() })), edges), first);
  assert.deepEqual({ works, edges }, before);
  assert.equal(first.edges.find((edge) => edge.kind === "shares_topics").evidence, evidence);
});

test("selection never repositions a graph that is within the drawing budget", () => {
  const first = layoutResearchMap3D(trio, [], { selectedId: "a" });
  assert.deepEqual(layoutResearchMap3D(trio, [], { selectedId: "c" }), first);
});

test("incomplete metadata is unknown and a citation has only limited similarity weight", () => {
  assert.deepEqual(scorePaperSimilarity(paper("a"), paper("b")), { score: null, components: [], known: false });
  assert.equal(scorePaperSimilarity(paper("a", { references: [] }), paper("b", { references: [] })).score, null);
  const cite = [{ source: "a", target: "b", kind: "cites", directed: true }];
  const score = scorePaperSimilarity(paper("a"), paper("b"), cite);
  assert.equal(score.score, .08); assert.deepEqual(score.components, [{ kind: "citation", score: 1, weight: .08 }]);
  const unknown = layoutResearchMap3D([paper("a"), paper("b")], [{ source: "a", target: "b", kind: "future_relationship" }]);
  assert.equal(unknown.method.unknownPairCount, 1); assert.equal(unknown.method.knownPairCount, 0);
  assert.equal(unknown.edges[0].similarity, null); assert.equal(unknown.edges[0].targetDistance, null);
  assert.equal(unknown.method.stress, null);
});

test("stored scored edge evidence fills missing metadata and invalid metrics do not become truth", () => {
  for (const field of ["evidence", "score", "weight"]) {
    const edge = { source: "a", target: "b", kind: "shares_topics", [field]: field === "evidence" ? { score: .6 } : .6 };
    const score = scorePaperSimilarity(paper("a"), paper("b"), [edge]);
    assert.equal(score.score, .552);
    assert.deepEqual(score.components, [{ kind: "topic_overlap", score: .6, weight: .92 }]);
  }
  assert.equal(scorePaperSimilarity(paper("a"), paper("b"), [{ source: "a", target: "b", kind: "shares_topics", score: 700 }]).score, null);
  assert.equal(scorePaperSimilarity(paper("a"), paper("b"), [{ source: "a", target: "b", kind: "unvalidated", score: .8 }]).score, null);
  const missing = paper("a", { references: ["W1"], evidence: { references: "missing" } });
  assert.equal(scorePaperSimilarity(missing, paper("b", { references: ["W1"] })).score, null);
  assert.equal(scorePaperSimilarity(paper("a", { references: ["b"], evidence: { references: "missing" } }), paper("b")).score, null);
  assert.equal(scorePaperSimilarity(paper("a"), paper("b"), [{ source: "a", target: "b", kind: "cites", directed: false }]).score, null);
});

test("duplicates, reversed undirected links, dangling links and empty collections preserve identity", () => {
  const edges = [{ source: "a", target: "b", kind: "shares_topics", directed: false, evidence: { score: .5 } }];
  const duplicate = [...edges, { ...edges[0], source: "b", target: "a" }, { source: "a", target: "a", kind: "cites" }, { source: "a", target: "missing", kind: "cites" }];
  assert.deepEqual(layoutResearchMap3D([...trio, trio[0], { id: "" }], duplicate), layoutResearchMap3D(trio, edges));
  assert.deepEqual(layoutResearchMap3D([], []).nodes, []);
  assert.deepEqual(layoutResearchMap3D([paper("single")], []).nodes[0], { id: "single", x: 0, y: 0, z: 0, radius: 4, degree: 0, cluster: 0 });
});

test("every node has finite bounded world coordinates and the result has genuine 3D depth", () => {
  const works = Array.from({ length: 45 }, (_, i) => paper(`p-${i}`, { title: `${i % 3 === 0 ? "Carbon geological caprock" : "Luminosity stellar telescope"} ${i}` }));
  const layout = layoutResearchMap3D(works, []);
  for (const node of layout.nodes) {
    for (const key of ["x", "y", "z", "radius", "degree", "cluster"]) assert.ok(Number.isFinite(node[key]));
    assert.ok(Math.hypot(node.x, node.y, node.z) + node.radius <= 230.0001);
  }
  const [a, b, c, d] = layout.nodes;
  const u = [b.x-a.x, b.y-a.y, b.z-a.z], v = [c.x-a.x, c.y-a.y, c.z-a.z], w = [d.x-a.x, d.y-a.y, d.z-a.z];
  const volume = u[0]*(v[1]*w[2]-v[2]*w[1]) - u[1]*(v[0]*w[2]-v[2]*w[0]) + u[2]*(v[0]*w[1]-v[1]*w[0]);
  assert.ok(Math.abs(volume) > 1, "positions must not be a flat 2D layout with a z label");
});

test("the bounded slice retains selected identity and its neighborhood before unrelated nodes", () => {
  const works = Array.from({ length: 260 }, (_, index) => paper(`p-${String(index).padStart(3, "0")}`));
  const edges = [{ source: "p-259", target: "p-258", kind: "cites", directed: true }];
  const layout = layoutResearchMap3D(works, edges, { selectedId: "p-259", maxNodes: 4 });
  assert.deepEqual(layout.nodes.map((node) => node.id), ["p-000", "p-001", "p-258", "p-259"]);
  assert.equal(layout.omittedCount, 256);
  assert.deepEqual(layoutResearchMap3D([...works].reverse(), [...edges].reverse(), { selectedId: "p-259", maxNodes: 4 }), layout);
  const capped = layoutResearchMap3D(works, [], { maxNodes: 99999, iterations: 0 });
  assert.equal(capped.nodes.length, MAX_MAP_3D_NODES); assert.equal(capped.omittedCount, 60);
});

test("graph colors group actual metadata similarity without merging every citation path", () => {
  const layout = layoutResearchMap3D(trio, []);
  assert.equal(layout.nodes[0].cluster, layout.nodes[1].cluster);
  assert.notEqual(layout.nodes[0].cluster, layout.nodes[2].cluster);
  assert.deepEqual(layout.nodes.map((node) => node.id), trio.map((work) => work.id));
  const cited = layoutResearchMap3D([paper("a"), paper("b"), paper("c")], [{ source: "a", target: "b", kind: "cites", directed: true }]);
  assert.notEqual(cited.nodes[0].cluster, cited.nodes[1].cluster);
  assert.notEqual(cited.nodes[0].cluster, cited.nodes[2].cluster);
});
