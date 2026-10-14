import assert from "node:assert/strict";
import test from "node:test";
import { fitMapBounds, layoutResearchMap, mapDisplayBounds, mapLabelIds, nearestMapNode, relationshipCategory, zoomMapView } from "../app/lib/exploration/map-layout.mjs";

const works = ["a", "b", "c", "d"].map((id) => ({ id, title: id }));
const edges = [{ source: "a", target: "b", kind: "cites", directed: true }, { source: "b", target: "c", kind: "shares_topics", directed: false }];

test("map positions and edge order are independent of input order and never change input records", () => {
  const before = JSON.stringify({ works, edges });
  const layout = layoutResearchMap(works, edges);
  assert.deepEqual(layoutResearchMap([...works].reverse(), [...edges].reverse()), layout);
  assert.equal(JSON.stringify({ works, edges }), before);
  assert.deepEqual(layout.nodes.map((node) => node.degree), [1, 2, 1, 0]);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});

test("only real cites edges are classified as citations", () => {
  assert.equal(relationshipCategory("cites"), "citation");
  for (const kind of ["shares_references", "shares_topics", "text_similarity"]) assert.equal(relationshipCategory(kind), "similarity");
  for (const kind of ["citation", "reference", "future_kind"]) assert.equal(relationshipCategory(kind), "other");
});

test("invalid, duplicate and dangling relationships do not affect the visible graph", () => {
  const layout = layoutResearchMap([...works, works[0], { id: "" }], [...edges, edges[0], { source: "a", target: "a", kind: "cites" }, { source: "a", target: "missing", kind: "cites" }]);
  assert.deepEqual(layout, layoutResearchMap(works, edges));
});

test("a large graph is bounded while retaining a selected paper outside the first hundred", () => {
  const many = Array.from({ length: 180 }, (_, index) => ({ id: `paper-${String(index).padStart(3, "0")}` }));
  const layout = layoutResearchMap(many, [], { selectedId: "paper-179" });
  assert.equal(layout.nodes.length, 100);
  assert.equal(layout.omittedCount, 80);
  assert.ok(layout.nodes.some((node) => node.id === "paper-179"));
  assert.deepEqual(layoutResearchMap([], []).nodes, []);
  assert.ok(layoutResearchMap([{ id: "only" }], []).bounds.width > 0);
});

test("the visible slice prioritizes the selected paper's neighbors before other highly connected papers", () => {
  const many = Array.from({ length: 500 }, (_, index) => ({ id: `paper-${String(index).padStart(3, "0")}` }));
  const graph = [
    { source: "paper-499", target: "paper-498", kind: "cites", directed: true },
    { source: "paper-497", target: "paper-499", kind: "shares_topics", directed: false },
    ...many.slice(1, 120).map((work) => ({ source: "paper-000", target: work.id, kind: "cites", directed: true })),
  ];
  const layout = layoutResearchMap(many, graph, { selectedId: "paper-499", maxNodes: 4 });
  assert.deepEqual(layout.nodes.map((node) => node.id), ["paper-000", "paper-497", "paper-498", "paper-499"]);
  assert.equal(layout.omittedCount, 496);
  assert.equal(layout.edges.length, 2);
  assert.deepEqual(layoutResearchMap([...many].reverse(), [...graph].reverse(), { selectedId: "paper-499", maxNodes: 4 }), layout);
  const unfocused = layoutResearchMap(many, graph, { maxNodes: 2 });
  assert.deepEqual(unfocused.nodes.map((node) => node.id), ["paper-000", "paper-499"]);
});

test("a selected hub with more neighbors than the drawing budget retains its strongest connected neighborhood", () => {
  const many = Array.from({ length: 150 }, (_, index) => ({ id: `paper-${String(index).padStart(3, "0")}` }));
  const graph = [
    ...many.slice(0, 120).map((work) => ({ source: "paper-149", target: work.id, kind: "cites", directed: true })),
    { source: "paper-119", target: "paper-120", kind: "shares_topics", directed: false },
  ];
  const layout = layoutResearchMap(many, graph, { selectedId: "paper-149" });
  assert.equal(layout.nodes.length, 100);
  assert.ok(layout.nodes.some((node) => node.id === "paper-149"));
  assert.ok(layout.nodes.some((node) => node.id === "paper-119"));
  assert.ok(!layout.nodes.some((node) => node.id === "paper-120"), "a non-neighbor cannot displace a direct neighbor");
  assert.ok(layout.nodes.every((node) => node.id === "paper-149" || graph.some((edge) => edge.source === "paper-149" && edge.target === node.id)));
});

test("fitting includes bounds at either viewport aspect ratio and a lone node has usable padding", () => {
  const bounds = { x: 20, y: 40, width: 400, height: 100 };
  for (const [width, height] of [[1200, 300], [300, 1200]]) {
    const view = fitMapBounds(bounds, width, height);
    assert.equal(view.width / view.height, width / height);
    assert.ok(view.x <= bounds.x && view.y <= bounds.y);
    assert.ok(view.x + view.width >= bounds.x + bounds.width);
    assert.ok(view.y + view.height >= bounds.y + bounds.height);
  }
  assert.ok(fitMapBounds({ x: 50, y: 50, width: 0, height: 0 }, 800, 500).width >= 180);
});

test("zoom keeps its pointer anchor fixed, preserves aspect and enforces limits", () => {
  const view = { x: 10, y: 20, width: 800, height: 400 };
  const anchor = { x: 210, y: 120 };
  const zoomed = zoomMapView(view, 2, anchor, 100, 1600);
  assert.deepEqual(zoomed, { x: 110, y: 70, width: 400, height: 200 });
  assert.equal((anchor.x - zoomed.x) / zoomed.width, (anchor.x - view.x) / view.width);
  assert.equal(zoomMapView(view, 1000, anchor, 100, 1600).width, 100);
  assert.equal(zoomMapView(view, 0.0001, anchor, 100, 1600).width, 1600);
  assert.deepEqual(zoomMapView(view, 0), view);
});

test("fit includes a long selected label even for a lone paper and right-edge labels face inward", () => {
  const nodes = [{ id: "a", x: 500, y: 320, radius: 7, degree: 0 }];
  const display = mapDisplayBounds(nodes, [{ id: "a", title: "연구".repeat(40), year: "2024" }]);
  assert.ok(display.width > 500, "forty-two Korean characters need room beyond the node circle");
  const fit = fitMapBounds(display, 1000, 520);
  assert.ok(fit.x <= display.x && fit.x + fit.width >= display.x + display.width);
  const paired = mapDisplayBounds([...nodes, { id: "b", x: 800, y: 320, radius: 7, degree: 0 }], [{ id: "a", title: "Paper" }, { id: "b", title: "Long title ".repeat(6) }]);
  assert.ok(paired.x + paired.width <= 807, "right-most paper label points into the graph");
});

test("arrow navigation chooses a nearby paper in the requested spatial direction", () => {
  const nodes = [{ id: "middle", x: 0, y: 0 }, { id: "left", x: -30, y: 1 }, { id: "right", x: 30, y: 1 }, { id: "up", x: 0, y: -30 }, { id: "down", x: 0, y: 30 }, { id: "far", x: 100, y: 100 }];
  for (const [direction, id] of [["ArrowLeft", "left"], ["ArrowRight", "right"], ["ArrowUp", "up"], ["ArrowDown", "down"]]) assert.equal(nearestMapNode(nodes, "middle", direction), id);
  assert.equal(nearestMapNode(nodes, "left", "ArrowLeft"), null);
  assert.equal(nearestMapNode([], null, "ArrowRight"), null);
});

test("labels always retain selected, focused and related papers while density rises with zoom", () => {
  const nodes = Array.from({ length: 35 }, (_, index) => ({ id: `p-${index}`, degree: 35 - index }));
  const graph = [{ source: "p-30", target: "p-29", kind: "shares_references" }];
  const low = mapLabelIds(nodes, graph, "p-30", "p-34", 0.5);
  assert.ok(low.has("p-30") && low.has("p-29") && low.has("p-34"));
  assert.ok(low.size < 12);
  assert.ok(mapLabelIds(nodes, graph, "p-30", "p-34", 3).size > low.size);
  const hub = nodes.slice(1).map((node) => ({ source: "p-0", target: node.id, kind: "cites" }));
  assert.ok(mapLabelIds(nodes, hub, "p-0", null, 0.5).size < 20, "a hub must not force labels onto every node");
});
