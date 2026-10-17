import { tokenize } from "./ranking.mjs";

export const MAX_MAP_3D_NODES = 200;

// These weights describe available metadata similarity, never scientific quality.
const WEIGHTS = Object.freeze({ shared_references: .42, topic_overlap: .22, text_similarity: .28, citation: .08 });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const round = (value) => Math.round(value * 1e6) / 1e6;
const strings = (value, limit = 1500) => [...new Set((Array.isArray(value) ? value : []).filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))].sort(compare).slice(0, limit);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const referenceId = (value) => {
  const text = String(value || "").trim();
  const oa = text.match(/^(?:https?:\/\/openalex\.org\/)?(W\d+)$/i);
  if (oa) return `https://openalex.org/${oa[1].toUpperCase()}`;
  const doi = text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? `https://doi.org/${doi.toLowerCase()}` : text;
};
const references = (work) => strings(strings(work?.references ?? work?.referenced_works ?? work?.reference_ids).map(referenceId));
const topicIds = (work) => strings(work?.topic_ids, 100);
const metadataAvailable = (work, key, values) => values.length > 0 && work?.evidence?.[key] !== "missing";
const normalizedScore = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const edgeScore = (edge) => normalizedScore(edge?.evidence?.score) ?? normalizedScore(edge?.score) ?? normalizedScore(edge?.weight);

function textVectors(works) {
  const counts = works.map((work) => {
    const map = new Map();
    // Bound text work per paper and align tokenization with discovery ranking.
    for (const [text, boost] of [[String(work?.title || "").slice(0, 2000), 2.5], [String(work?.abstract || "").slice(0, 5000), 1], [strings(work?.topics, 100).join(" ").slice(0, 2000), 1]]) {
      for (const token of tokenize(text)) map.set(token, (map.get(token) || 0) + boost);
    }
    return map;
  });
  const frequency = new Map();
  for (const map of counts) for (const token of map.keys()) frequency.set(token, (frequency.get(token) || 0) + 1);
  return counts.map((map) => {
    const vector = new Map(); let norm = 0;
    for (const [token, tf] of [...map].sort(([a], [b]) => compare(a, b))) {
      const value = (1 + Math.log(tf)) * (1 + Math.log((1 + works.length) / (1 + frequency.get(token))));
      vector.set(token, value); norm += value * value;
    }
    norm = Math.sqrt(norm);
    if (norm) for (const [token, value] of vector) vector.set(token, value / norm);
    return vector;
  });
}

function cosine(a, b) {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let score = 0;
  for (const [token, value] of smaller) score += value * (larger.get(token) || 0);
  return clamp(score);
}

function prepare(work, vector) {
  const refs = references(work), topics = topicIds(work);
  const aliases = new Set([work?.id, work?.openalex_id, work?.doi].map(referenceId).filter(Boolean));
  return { work, refs, topics, refSet: new Set(refs), topicSet: new Set(topics), aliases, vector };
}

function pairSimilarity(a, b, edges) {
  const measured = new Map();
  if (metadataAvailable(a.work, "references", a.refs) && metadataAvailable(b.work, "references", b.refs)) {
    const shared = a.refs.reduce((count, id) => count + Number(b.refSet.has(id)), 0);
    measured.set("shared_references", shared / Math.sqrt(a.refs.length * b.refs.length));
  }
  if (metadataAvailable(a.work, "topic_ids", a.topics) && metadataAvailable(b.work, "topic_ids", b.topics)) {
    const shared = a.topics.reduce((count, id) => count + Number(b.topicSet.has(id)), 0);
    measured.set("topic_overlap", shared / (a.topics.length + b.topics.length - shared));
  }
  if (a.vector.size && b.vector.size) measured.set("text_similarity", cosine(a.vector, b.vector));
  let citation = (metadataAvailable(a.work, "references", a.refs) && a.refs.some((id) => b.aliases.has(id))) || (metadataAvailable(b.work, "references", b.refs) && b.refs.some((id) => a.aliases.has(id)));
  const scoredEdges = new Map();
  for (const edge of edges) {
    if (edge.kind === "cites" && edge.directed === true) { citation = true; continue; }
    const kind = { shares_references: "shared_references", shares_topics: "topic_overlap", text_similarity: "text_similarity" }[edge.kind];
    const score = edgeScore(edge);
    if (kind && score !== null) scoredEdges.set(kind, Math.max(scoredEdges.get(kind) ?? 0, score));
  }
  // Stored evidence fills missing components; it never overrides currently available metadata.
  for (const [kind, score] of scoredEdges) if (!measured.has(kind)) measured.set(kind, score);
  const denominator = [...measured.keys()].reduce((sum, kind) => sum + WEIGHTS[kind], 0);
  const components = [];
  let score = 0;
  for (const kind of ["shared_references", "topic_overlap", "text_similarity"]) if (measured.has(kind)) {
    const weight = (1 - WEIGHTS.citation) * WEIGHTS[kind] / denominator;
    const value = measured.get(kind);
    components.push({ kind, score: round(value), weight: round(weight) });
    score += value * weight;
  }
  if (citation) { components.push({ kind: "citation", score: 1, weight: WEIGHTS.citation }); score += WEIGHTS.citation; }
  if (!components.length) return { score: null, components, known: false };
  return { score: round(clamp(score)), components, known: true };
}

/** Available indexed-metadata similarity. Missing evidence returns null, not zero correlation.
 * TF-IDF for this helper uses the two supplied papers; the layout uses its entire visible corpus.
 */
export function scorePaperSimilarity(a, b, edges = []) {
  const papers = [a || {}, b || {}], vectors = textVectors(papers);
  const matching = (Array.isArray(edges) ? edges : []).filter((edge) => edge && ((edge.source === a?.id && edge.target === b?.id) || (edge.source === b?.id && edge.target === a?.id)));
  return pairSimilarity(prepare(papers[0], vectors[0]), prepare(papers[1], vectors[1]), matching);
}

/** Desired world-space distance; null/invalid scores have no evidence-based distance. */
export function similarityToDistance(score) {
  const value = normalizedScore(score);
  return value === null ? null : round(36 + 174 * (1 - value));
}

function normalizedWorks(works) {
  const byId = new Map();
  for (const work of Array.isArray(works) ? works : []) {
    if (!work || typeof work.id !== "string" || !work.id.trim()) continue;
    const previous = byId.get(work.id);
    const richness = (row) => String(row.title || "").length + String(row.abstract || "").length + references(row).length * 20 + topicIds(row).length * 20;
    if (!previous || richness(work) > richness(previous) || (richness(work) === richness(previous) && compare(canonical(work), canonical(previous)) < 0)) byId.set(work.id, work);
  }
  return [...byId.values()].sort((a, b) => compare(a.id, b.id));
}

function normalizedEdges(edges, known) {
  const byKey = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || !known.has(edge.source) || !known.has(edge.target) || edge.source === edge.target) continue;
    const directed = edge.directed === true;
    const [source, target] = directed || compare(edge.source, edge.target) <= 0 ? [edge.source, edge.target] : [edge.target, edge.source];
    const kind = typeof edge.kind === "string" ? edge.kind : "unknown";
    const id = JSON.stringify([source, target, kind, directed]);
    const value = { ...edge, id, source, target, kind, directed };
    const old = byKey.get(id);
    if (!old || compare(canonical(value), canonical(old)) < 0) byKey.set(id, value);
  }
  return [...byKey.values()].sort((a, b) => compare(a.id, b.id));
}

function hash(text) {
  let result = 2166136261;
  for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
  return result >>> 0;
}

function seedNodes(works, degree) {
  return works.map((work, index) => {
    const h = hash(work.id), fraction = (index + .5) / Math.max(1, works.length);
    const height = 1 - fraction * 2, phi = index * Math.PI * (3 - Math.sqrt(5)) + (h % 1000) / 700;
    const cross = Math.sqrt(Math.max(0, 1 - height * height));
    const r = works.length <= 1 ? 0 : 80 + (h % 3000) / 100;
    return { id: work.id, x: Math.cos(phi) * cross * r, y: height * r, z: Math.sin(phi) * cross * r, radius: 4 + Math.min(4, Math.sqrt(degree.get(work.id) || 0)), degree: degree.get(work.id) || 0, cluster: 0 };
  });
}

function centerAndBound(nodes) {
  if (!nodes.length) return;
  const center = nodes.reduce((sum, node) => [sum[0] + node.x, sum[1] + node.y, sum[2] + node.z], [0, 0, 0]).map((sum) => sum / nodes.length);
  for (const node of nodes) { node.x -= center[0]; node.y -= center[1]; node.z -= center[2]; }
  const extent = Math.max(...nodes.map((node) => Math.hypot(node.x, node.y, node.z) + node.radius));
  const scale = extent > 230 ? 222 / extent : 1;
  for (const node of nodes) { node.x = round(node.x * scale); node.y = round(node.y * scale); node.z = round(node.z * scale); }
}

function optimize(nodes, pairs, iterations) {
  const n = nodes.length;
  const mass = new Float64Array(n);
  for (const pair of pairs) { mass[pair.i] += pair.weight; mass[pair.j] += pair.weight; }
  for (let step = 0; step < iterations && n > 1; step++) {
    const movement = new Float64Array(n * 3);
    for (const pair of pairs) {
      const a = nodes[pair.i], b = nodes[pair.j];
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      let distance = Math.hypot(dx, dy, dz);
      if (distance < .0001) { dx = .01 * (pair.i + 1); dy = .01 * (pair.j + 1); dz = .007; distance = Math.hypot(dx, dy, dz); }
      const force = pair.weight * (distance - pair.target) / distance;
      const aOffset = pair.i * 3, bOffset = pair.j * 3;
      movement[aOffset] += force * dx; movement[bOffset] -= force * dx;
      movement[aOffset + 1] += force * dy; movement[bOffset + 1] -= force * dy;
      movement[aOffset + 2] += force * dz; movement[bOffset + 2] -= force * dz;
    }
    const rate = .72 - .32 * step / Math.max(1, iterations);
    for (let i = 0; i < n; i++) {
      const norm = Math.max(.01, mass[i]);
      nodes[i].x += clamp(movement[i * 3] / norm, -15, 15) * rate;
      nodes[i].y += clamp(movement[i * 3 + 1] / norm, -15, 15) * rate;
      nodes[i].z += clamp(movement[i * 3 + 2] / norm, -15, 15) * rate;
    }
  }
}

/** Deterministic bounded 3D weighted stress embedding. All layout state is derived;
 * it never mutates the saved research trail or invents papers/citation evidence.
 */
export function layoutResearchMap3D(works, edges, options = {}) {
  const allWorks = normalizedWorks(works), known = new Set(allWorks.map((work) => work.id));
  const allEdges = normalizedEdges(edges, known);
  const maxNodes = Math.min(MAX_MAP_3D_NODES, Math.max(1, Math.floor(finite(options.maxNodes, MAX_MAP_3D_NODES))));
  const iterations = Math.min(420, Math.max(0, Math.floor(finite(options.iterations, 220))));
  const globalDegree = new Map(allWorks.map((work) => [work.id, 0]));
  for (const edge of allEdges) { globalDegree.set(edge.source, globalDegree.get(edge.source) + 1); globalDegree.set(edge.target, globalDegree.get(edge.target) + 1); }
  let visibleWorks = allWorks;
  if (allWorks.length > maxNodes) {
    const selected = known.has(options.selectedId) ? options.selectedId : null;
    const neighbors = new Set(allEdges.filter((edge) => edge.source === selected || edge.target === selected).flatMap((edge) => [edge.source, edge.target]));
    visibleWorks = [...allWorks].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(neighbors.has(b.id)) - Number(neighbors.has(a.id)) || globalDegree.get(b.id) - globalDegree.get(a.id) || compare(a.id, b.id)).slice(0, maxNodes).sort((a, b) => compare(a.id, b.id));
  }
  const allowed = new Set(visibleWorks.map((work) => work.id));
  const links = allEdges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
  const degree = new Map(visibleWorks.map((work) => [work.id, 0]));
  const edgeByPair = new Map();
  const pairKey = (a, b) => JSON.stringify(compare(a, b) <= 0 ? [a, b] : [b, a]);
  for (const edge of links) {
    degree.set(edge.source, degree.get(edge.source) + 1); degree.set(edge.target, degree.get(edge.target) + 1);
    const key = pairKey(edge.source, edge.target);
    if (!edgeByPair.has(key)) edgeByPair.set(key, []);
    edgeByPair.get(key).push(edge);
  }
  const vectors = textVectors(visibleWorks), prepared = visibleWorks.map((work, i) => prepare(work, vectors[i]));
  const nodes = seedNodes(visibleWorks, degree), pairs = [], similarityByPair = new Map();
  let knownPairCount = 0, unknownPairCount = 0;
  const parent = nodes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const key = pairKey(nodes[i].id, nodes[j].id), matching = edgeByPair.get(key) || [];
    const similarity = pairSimilarity(prepared[i], prepared[j], matching);
    similarityByPair.set(key, similarity.score);
    if (similarity.known) knownPairCount++; else unknownPairCount++;
    // Unknown pairs use only weak neutral separation, never an asserted zero similarity.
    pairs.push({ i, j, target: similarityToDistance(similarity.score) ?? 200, weight: similarity.known ? 1 : .035, known: similarity.known });
    const metadataSimilarity = similarity.components.filter((component) => component.kind !== "citation").reduce((sum, component) => sum + component.score * component.weight, 0) / (1 - WEIGHTS.citation);
    // Citation networks often form one giant component. Colors instead group only
    // strong metadata-similarity neighborhoods, not citation paths or disciplines.
    if (metadataSimilarity >= .58) {
      const a = find(i), b = find(j); parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  optimize(nodes, pairs, iterations);
  centerAndBound(nodes);
  const roots = [...new Set(nodes.map((_, i) => find(i)))].sort((a, b) => compare(nodes[a].id, nodes[b].id));
  nodes.forEach((node, i) => { node.cluster = roots.indexOf(find(i)); });
  let residual = 0, total = 0;
  for (const pair of pairs) if (pair.known) {
    const a = nodes[pair.i], b = nodes[pair.j], actual = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    residual += pair.weight * (actual - pair.target) ** 2; total += pair.weight * pair.target ** 2;
  }
  return {
    nodes,
    edges: links.map((edge) => { const similarity = similarityByPair.get(pairKey(edge.source, edge.target)) ?? null; return { ...edge, similarity, targetDistance: similarityToDistance(similarity) }; }),
    omittedCount: allWorks.length - visibleWorks.length,
    method: {
      label: "TF-IDF + indexed reference/topic similarity · 3D weighted stress embedding",
      weights: { ...WEIGHTS }, knownPairCount, unknownPairCount, iterations, maxNodes,
      stress: total ? round(Math.sqrt(residual / total)) : null,
      clusterCount: roots.length,
      clusterMethod: "Connected components of metadata similarity >= 0.58; citation-only links do not join groups.",
      unknownDistance: "Weak neutral separation only; missing metadata is unknown.",
      disclaimer: "Distances approximate available metadata similarity, not Pearson correlation, scientific agreement, causation or paper quality. A three-dimensional embedding cannot preserve every pair distance exactly.",
    },
  };
}
