export const MAX_MAP_NODES = 100;

const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function relationshipCategory(kind) {
  return kind === "cites" ? "citation" : ["shares_references", "shares_topics", "text_similarity"].includes(kind) ? "similarity" : "other";
}

/** A bounded, repeatable layout. Positions express graph structure, not evidence strength. */
export function layoutResearchMap(works, edges, options = {}) {
  const limit = Math.min(MAX_MAP_NODES, Math.max(1, Math.floor(finite(options.maxNodes, MAX_MAP_NODES))));
  const width = Math.max(200, finite(options.width, 1000));
  const height = Math.max(200, finite(options.height, 640));
  const ids = [...new Set(works.map((work) => work?.id).filter((id) => typeof id === "string" && id.trim()))].sort(compareIds);
  const known = new Set(ids);
  const seenEdges = new Set();
  const allLinks = edges.filter((edge) => edge && known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target)
    .map((edge) => ({ source: edge.source, target: edge.target, kind: typeof edge.kind === "string" ? edge.kind : "unknown", directed: edge.directed === true }))
    .sort((a, b) => compareIds(JSON.stringify([a.source, a.target, a.kind, a.directed]), JSON.stringify([b.source, b.target, b.kind, b.directed])))
    .filter((edge) => {
      const key = JSON.stringify([edge.source, edge.target, edge.kind, edge.directed]);
      if (seenEdges.has(key)) return false;
      seenEdges.add(key);
      return true;
    });
  const globalDegree = new Map(ids.map((id) => [id, 0]));
  const selectedId = known.has(options.selectedId) ? options.selectedId : null;
  const neighbors = new Set();
  for (const edge of allLinks) {
    globalDegree.set(edge.source, globalDegree.get(edge.source) + 1);
    globalDegree.set(edge.target, globalDegree.get(edge.target) + 1);
    if (edge.source === selectedId) neighbors.add(edge.target);
    if (edge.target === selectedId) neighbors.add(edge.source);
  }
  const ranked = [...ids].sort((a, b) => globalDegree.get(b) - globalDegree.get(a) || compareIds(a, b));
  const priorities = selectedId ? [selectedId, ...ranked.filter((id) => neighbors.has(id)), ...ranked.filter((id) => id !== selectedId && !neighbors.has(id))] : ranked;
  const shown = priorities.slice(0, limit).sort(compareIds);
  const allowed = new Set(shown);
  const links = allLinks.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
    .map((edge) => ({ ...edge, id: JSON.stringify([edge.source, edge.target, edge.kind, edge.directed]) }));
  const degree = new Map(shown.map((id) => [id, 0]));
  for (const edge of links) {
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }
  const nodes = shown.map((id, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const distance = shown.length === 1 ? 0 : Math.sqrt((index + 0.5) / shown.length) * Math.min(width, height) * 0.39;
    return { id, x: width / 2 + Math.cos(angle) * distance, y: height / 2 + Math.sin(angle) * distance, radius: 7 + Math.min(5, Math.sqrt(degree.get(id))), degree: degree.get(id) };
  });
  const byId = new Map(nodes.map((node, index) => [node.id, index]));
  const iterations = Math.min(240, Math.max(0, Math.floor(finite(options.iterations, 160))));
  for (let step = 0; step < iterations; step++) {
    const force = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        if (Math.abs(dx) + Math.abs(dy) < 0.001) { dx = 0.01 * (i + 1); dy = 0.01 * (j + 1); }
        const distance = Math.max(12, Math.hypot(dx, dy));
        const repulsion = Math.min(12, 1900 / (distance * distance));
        const fx = dx / distance * repulsion;
        const fy = dy / distance * repulsion;
        force[i].x += fx; force[i].y += fy;
        force[j].x -= fx; force[j].y -= fy;
      }
    }
    for (const edge of links) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const dx = nodes[target].x - nodes[source].x;
      const dy = nodes[target].y - nodes[source].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = (distance - 105) * 0.012;
      const fx = dx / distance * strength;
      const fy = dy / distance * strength;
      force[source].x += fx; force[source].y += fy;
      force[target].x -= fx; force[target].y -= fy;
    }
    const cooling = 1 - step / Math.max(1, iterations) * 0.75;
    nodes.forEach((node, index) => {
      const fx = force[index].x + (width / 2 - node.x) * 0.003;
      const fy = force[index].y + (height / 2 - node.y) * 0.003;
      node.x = Math.max(30, Math.min(width - 30, node.x + Math.max(-8, Math.min(8, fx)) * cooling));
      node.y = Math.max(30, Math.min(height - 30, node.y + Math.max(-8, Math.min(8, fy)) * cooling));
    });
  }
  nodes.forEach((node) => { node.x = Math.round(node.x * 100) / 100; node.y = Math.round(node.y * 100) / 100; });
  const bounds = nodes.length ? {
    x: Math.min(...nodes.map((node) => node.x - node.radius)),
    y: Math.min(...nodes.map((node) => node.y - node.radius)),
    width: Math.max(...nodes.map((node) => node.x + node.radius)) - Math.min(...nodes.map((node) => node.x - node.radius)),
    height: Math.max(...nodes.map((node) => node.y + node.radius)) - Math.min(...nodes.map((node) => node.y - node.radius)),
  } : { x: width / 2, y: height / 2, width: 1, height: 1 };
  return { nodes, edges: links, bounds, omittedCount: Math.max(0, ids.length - nodes.length) };
}

export function fitMapBounds(bounds, viewportWidth, viewportHeight, padding = 60) {
  const aspect = Math.max(1, viewportWidth) / Math.max(1, viewportHeight);
  const paddedWidth = Math.max(180, bounds.width + padding * 2);
  const paddedHeight = Math.max(180, bounds.height + padding * 2);
  const width = Math.max(paddedWidth, paddedHeight * aspect);
  const height = width / aspect;
  return { x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y + bounds.height / 2 - height / 2, width, height };
}

/** Conservative text extents keep Fit/export readable without browser font measurement. */
export function mapDisplayBounds(nodes, works) {
  if (!nodes.length) return { x: 500, y: 320, width: 1, height: 1 };
  const byId = new Map(works.map((work) => [work.id, work]));
  const left = Math.min(...nodes.map((node) => node.x - node.radius));
  const right = Math.max(...nodes.map((node) => node.x + node.radius));
  const middle = (left + right) / 2;
  let x1 = left; let x2 = right;
  for (const node of nodes) {
    const work = byId.get(node.id);
    const title = Array.from(work?.title || "Untitled work");
    const displayed = title.length > 42 ? `${title.slice(0, 41).join("")}…` : title.join("");
    const label = `${displayed}${work?.year ? ` · ${work.year}` : ""}`;
    const textWidth = Array.from(label).length * 13;
    const onLeft = node.x > middle;
    const anchor = node.x + (node.radius + 6) * (onLeft ? -1 : 1);
    x1 = Math.min(x1, anchor - (onLeft ? textWidth : 0));
    x2 = Math.max(x2, anchor + (onLeft ? 0 : textWidth));
  }
  const y1 = Math.min(...nodes.map((node) => node.y - Math.max(16, node.radius)));
  const y2 = Math.max(...nodes.map((node) => node.y + Math.max(16, node.radius)));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function zoomMapView(view, factor, anchor, minWidth = 100, maxWidth = 4000) {
  if (!(factor > 0) || !Number.isFinite(factor)) return { ...view };
  const width = Math.max(minWidth, Math.min(maxWidth, view.width / factor));
  const ratio = width / view.width;
  const point = anchor || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  return { x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio, width, height: view.height * ratio };
}

export function nearestMapNode(nodes, currentId, direction) {
  const current = nodes.find((node) => node.id === currentId);
  if (!current) return nodes[0]?.id ?? null;
  const vector = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[direction];
  if (!vector) return null;
  return nodes.filter((node) => node.id !== currentId).map((node) => {
    const dx = node.x - current.x;
    const dy = node.y - current.y;
    const forward = dx * vector[0] + dy * vector[1];
    return { id: node.id, forward, cost: Math.hypot(dx, dy) + Math.abs(dx * vector[1] - dy * vector[0]) * 1.5 };
  }).filter((node) => node.forward > 0.01).sort((a, b) => a.cost - b.cost || compareIds(a.id, b.id))[0]?.id ?? null;
}

export function mapLabelIds(nodes, edges, selectedId, focusedId, zoom = 1) {
  const available = new Set(nodes.map((node) => node.id));
  const important = new Set([selectedId, focusedId].filter((id) => available.has(id)));
  const neighbors = new Set();
  for (const edge of edges) {
    if (edge.source === selectedId) neighbors.add(edge.target);
    if (edge.target === selectedId) neighbors.add(edge.source);
  }
  const budget = zoom < 0.8 ? 5 : zoom < 1.6 ? 10 : 24;
  const ranked = [...nodes].sort((a, b) => b.degree - a.degree || compareIds(a.id, b.id));
  for (const node of ranked.filter((node) => neighbors.has(node.id)).slice(0, zoom < 1.6 ? 12 : 24)) important.add(node.id);
  for (const node of ranked.slice(0, budget)) important.add(node.id);
  return important;
}
