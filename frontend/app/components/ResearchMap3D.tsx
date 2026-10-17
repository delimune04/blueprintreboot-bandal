"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mapClusterColor, type ResearchMapWork } from "./ResearchMap";

interface Node3D { id: string; x: number; y: number; z: number; radius: number; degree: number; cluster: number }
interface Edge3D { id: string; source: string; target: string; kind: string; directed?: boolean; similarity: number | null }
interface Projection { id: string; x: number; y: number; depth: number; radius: number; visible: boolean }
interface ProjectedView { nodes: Projection[]; width: number; height: number }
interface MapScene { zoomBy: (factor: number) => void; reset: () => void; focus: (id: string) => void; rotate: (x: number, y: number) => void; pan: (x: number, y: number) => void; updateSelection: () => void; snapshotSvg: () => string }

export interface ResearchMap3DControls { zoomBy: (factor: number) => void; reset: () => void; focus: (id: string) => void; snapshotSvg: () => string | undefined }
interface Props {
  layout: { nodes: readonly Node3D[]; edges: readonly Edge3D[] };
  works: ReadonlyMap<string, ResearchMapWork>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: "ko" | "en";
  height: number;
  descriptionId: string;
  onZoomChange: (percent: number) => void;
}

const BACKGROUND = "#0c0d16";
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);

/** WebGL paper spheres with a fully operable SVG projection when WebGL is unavailable. */
export const ResearchMap3D = forwardRef<ResearchMap3DControls, Props>(function ResearchMap3D({ layout, works, selectedId, onSelect, locale, height, descriptionId, onZoomChange }, ref) {
  const ko = locale === "ko";
  const sphereGradientId = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fallbackRef = useRef<SVGSVGElement | null>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const selectedRef = useRef(selectedId);
  const callbacksRef = useRef({ onSelect, onZoomChange });
  const worksRef = useRef(works);
  const [mode, setMode] = useState<"loading" | "webgl" | "svg">("loading");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [projection, setProjection] = useState<ProjectedView>({ nodes: [], width: 1000, height });
  selectedRef.current = selectedId;
  callbacksRef.current = { onSelect, onZoomChange };
  worksRef.current = works;

  useImperativeHandle(ref, () => ({ zoomBy: (factor) => sceneRef.current?.zoomBy(factor), reset: () => sceneRef.current?.reset(), focus: (id) => sceneRef.current?.focus(id), snapshotSvg: () => sceneRef.current?.snapshotSvg() }), []);
  useEffect(() => { sceneRef.current?.updateSelection(); }, [selectedId]);

  useEffect(() => {
    const host = hostRef.current;
    const svg = fallbackRef.current;
    if (!host || !svg) return;
    let disposed = false;
    let frame = 0;
    let wasHidden = host.clientWidth <= 0;
    let width = Math.max(1, host.clientWidth || 1000);
    let stageHeight = Math.max(1, host.clientHeight || height);
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let activeElement: HTMLCanvasElement | SVGSVGElement = svg;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    const camera = new THREE.PerspectiveCamera(42, width / stageHeight, 0.5, 6000);
    const target = new THREE.Vector3();
    const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
    const neighborIds = new Set<string>();
    const sphereGeometry = new THREE.SphereGeometry(1, 20, 14);
    const nodeMeshes = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
    const halos = new Map<string, THREE.Sprite>();
    const lines: { edge: Edge3D; line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> }[] = [];
    const disposables: { dispose: () => void }[] = [sphereGeometry];
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 64;
    const context = haloCanvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.18, "rgba(255,255,255,.55)");
      gradient.addColorStop(0.5, "rgba(255,255,255,.12)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    }
    const haloTexture = new THREE.CanvasTexture(haloCanvas);
    disposables.push(haloTexture);
    scene.add(new THREE.AmbientLight("#aacbee", 1.7));
    const keyLight = new THREE.DirectionalLight("#f1f6ff", 3.4); keyLight.position.set(-250, 400, 550); scene.add(keyLight);
    const fillLight = new THREE.PointLight("#32a9ec", 170000, 1600, 2); fillLight.position.set(240, 150, -120); scene.add(fillLight);
    for (const node of layout.nodes) {
      const color = mapClusterColor(node.cluster);
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.42, metalness: 0.12, transparent: true });
      const mesh = new THREE.Mesh(sphereGeometry, material);
      mesh.position.set(node.x, node.y, node.z); mesh.scale.setScalar(node.radius); mesh.userData.paperId = node.id;
      scene.add(mesh); nodeMeshes.set(node.id, mesh); disposables.push(material);
      const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending });
      const halo = new THREE.Sprite(haloMaterial); halo.position.copy(mesh.position); halo.scale.setScalar(node.radius * 5);
      scene.add(halo); halos.set(node.id, halo); disposables.push(haloMaterial);
    }
    for (const edge of layout.edges) {
      const source = nodesById.get(edge.source); const destination = nodesById.get(edge.target);
      if (!source || !destination) continue;
      const color = mapClusterColor(source.cluster);
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(source.x, source.y, source.z), new THREE.Vector3(destination.x, destination.y, destination.z)]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.23, depthWrite: false });
      const line = new THREE.Line(geometry, material); scene.add(line); lines.push({ edge, line }); disposables.push(geometry, material);
    }
    const radius = Math.max(35, ...layout.nodes.map((node) => Math.hypot(node.x, node.y, node.z) + node.radius));
    let fittedDistance = radius * 3.1;
    let latestProjection: ProjectedView = { nodes: [], width, height: stageHeight };
    const cameraDirection = new THREE.Vector3(0.54, 0.3, 1).normalize();

    function syncCamera() {
      if (controls) { controls.target.copy(target); controls.update(); }
      camera.lookAt(target); camera.updateMatrixWorld();
    }
    function project() {
      camera.updateMatrixWorld();
      latestProjection = { width, height: stageHeight, nodes: layout.nodes.map((node) => {
        const point = new THREE.Vector3(node.x, node.y, node.z).project(camera);
        const distance = Math.max(1, new THREE.Vector3(node.x, node.y, node.z).distanceTo(camera.position));
        return { id: node.id, x: (point.x + 1) * width / 2, y: (1 - point.y) * stageHeight / 2, depth: point.z, radius: Math.max(2, node.radius * stageHeight / (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))), visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.2 && Math.abs(point.y) < 1.2 };
      }) };
      setProjection(latestProjection);
      callbacksRef.current.onZoomChange(Math.max(1, Math.round(100 * fittedDistance / camera.position.distanceTo(target))));
    }
    function draw() {
      frame = 0; if (disposed) return;
      renderer?.render(scene, camera); project();
    }
    function invalidate() { if (!disposed && !frame) frame = window.requestAnimationFrame(draw); }
    function reset() {
      const aspect = width / stageHeight;
      fittedDistance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, 1 / aspect) * 1.12;
      target.set(0, 0, 0); camera.position.copy(cameraDirection).multiplyScalar(fittedDistance);
      if (controls) { controls.minDistance = Math.max(12, radius * 0.16); controls.maxDistance = fittedDistance * 5; }
      syncCamera(); invalidate();
    }
    function zoomBy(factor: number) {
      if (!Number.isFinite(factor) || factor <= 0) return;
      const offset = camera.position.clone().sub(target);
      const distance = Math.max(Math.max(12, radius * 0.16), Math.min(fittedDistance * 5, offset.length() / factor));
      camera.position.copy(target).add(offset.setLength(distance)); syncCamera(); invalidate();
    }
    function rotate(x: number, y: number) {
      const offset = camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= x; spherical.phi = Math.max(0.025, Math.min(Math.PI - 0.025, spherical.phi - y));
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical)); syncCamera(); invalidate();
    }
    function pan(x: number, y: number) {
      const distance = camera.position.distanceTo(target);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-x * distance);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(y * distance);
      const delta = right.add(up); target.add(delta); camera.position.add(delta); syncCamera(); invalidate();
    }
    function focus(id: string) {
      const node = nodesById.get(id); if (!node) return;
      const offset = camera.position.clone().sub(target).setLength(Math.max(radius * 0.65, node.radius * 18, 65));
      target.set(node.x, node.y, node.z); camera.position.copy(target).add(offset); syncCamera(); invalidate();
    }
    function updateSelection() {
      neighborIds.clear();
      const selection = selectedRef.current;
      if (selection) neighborIds.add(selection);
      for (const { edge } of lines) {
        if (edge.source === selection) neighborIds.add(edge.target);
        if (edge.target === selection) neighborIds.add(edge.source);
      }
      for (const node of layout.nodes) {
        const mesh = nodeMeshes.get(node.id)!; const halo = halos.get(node.id)!;
        const selected = node.id === selection; const dimmed = !!selection && !neighborIds.has(node.id);
        mesh.material.opacity = dimmed ? 0.26 : 1;
        mesh.material.emissiveIntensity = selected ? 0.85 : dimmed ? 0.04 : 0.22;
        mesh.scale.setScalar(node.radius * (selected ? 1.28 : 1));
        (halo.material as THREE.SpriteMaterial).opacity = selected ? 0.85 : dimmed ? 0.035 : 0.24;
        halo.scale.setScalar(node.radius * (selected ? 9 : 5));
      }
      for (const { edge, line } of lines) line.material.opacity = selection ? (edge.source === selection || edge.target === selection ? 0.85 : 0.065) : 0.23;
      invalidate();
    }
    function paperAt(event: PointerEvent | MouseEvent) {
      const rect = activeElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      if (renderer) {
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects([...nodeMeshes.values()], false)[0]?.object.userData.paperId as string | undefined ?? null;
      }
      const x = (event.clientX - rect.left) / rect.width * width; const y = (event.clientY - rect.top) / rect.height * stageHeight;
      return latestProjection.nodes.filter((node) => node.visible && Math.hypot(node.x - x, node.y - y) <= Math.max(12, node.radius + 4)).sort((a, b) => a.depth - b.depth)[0]?.id ?? null;
    }
    function snapshotSvg() {
      project();
      const positions = new Map(latestProjection.nodes.map((node) => [node.id, node]));
      const lineMarkup = lines.map(({ edge }) => {
        const a = positions.get(edge.source)!; const b = positions.get(edge.target)!;
        if (!a.visible || !b.visible) return "";
        const source = nodesById.get(edge.source)!;
        const active = edge.source === selectedRef.current || edge.target === selectedRef.current;
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${mapClusterColor(source.cluster)}" stroke-opacity="${selectedRef.current ? (active ? 0.8 : 0.08) : 0.3}"/>`;
      }).join("");
      const dotMarkup = [...latestProjection.nodes].filter((node) => node.visible).sort((a, b) => b.depth - a.depth).map((node) => {
        const work = worksRef.current.get(node.id); const original = nodesById.get(node.id)!;
        const selected = node.id === selectedRef.current;
        const title = `${work?.title ?? node.id}${work?.year ? ` · ${work.year}` : ""}`;
        return `<g><title>${escapeXml(title)}</title>${selected ? `<circle cx="${node.x}" cy="${node.y}" r="${node.radius + 5}" fill="none" stroke="#fff" stroke-opacity=".8"/>` : ""}<circle cx="${node.x}" cy="${node.y}" r="${node.radius}" fill="${mapClusterColor(original.cluster)}"/>${selected ? `<text x="${Math.min(width - 250, Math.max(12, node.x + node.radius + 8))}" y="${Math.max(22, node.y - 8)}" fill="#f3f7ff" font-family="sans-serif" font-size="12">${escapeXml(title.length > 65 ? `${title.slice(0, 64)}…` : title)}</text>` : ""}</g>`;
      }).join("");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${stageHeight}" viewBox="0 0 ${width} ${stageHeight}"><title>LabVium 3D paper relationship map</title><desc>Perspective projection of the current three-dimensional paper map. Distance approximates scholarly relatedness.</desc><rect width="100%" height="100%" fill="${BACKGROUND}"/>${lineMarkup}${dotMarkup}</svg>`;
    }
    const pointers = new Map<number, { x: number; y: number }>();
    let press: { x: number; y: number; id: number; button: number; moved: boolean; multi: boolean } | null = null;
    let lastPinch = 0;
    function pointerDown(event: PointerEvent) {
      host!.focus({ preventScroll: true });
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) press = { x: event.clientX, y: event.clientY, id: event.pointerId, button: event.button, moved: false, multi: false };
      else if (press) { press.multi = true; press.moved = true; }
      if (!renderer) {
        event.preventDefault(); activeElement.setPointerCapture(event.pointerId);
        const points = [...pointers.values()]; lastPinch = points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
      }
    }
    function pointerMove(event: PointerEvent) {
      const previous = pointers.get(event.pointerId);
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true;
      if (previous) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (!renderer) {
          const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
          if (pointers.size > 1) {
            const points = [...pointers.values()]; const pinch = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            if (lastPinch > 0) zoomBy(pinch / lastPinch); lastPinch = pinch;
            pan(dx / width * 0.5, dy / stageHeight * 0.5);
          } else if (press?.button === 2 || event.shiftKey) pan(dx / width, dy / stageHeight);
          else rotate(dx / width * Math.PI * 2, dy / stageHeight * Math.PI);
        }
      } else setHoveredId(paperAt(event));
    }
    function pointerUp(event: PointerEvent) {
      if (press?.id === event.pointerId && !press.moved && !press.multi && event.button === 0) {
        const id = paperAt(event); if (id) callbacksRef.current.onSelect(id);
      }
      pointers.delete(event.pointerId);
      if (!pointers.size) press = null;
      if (!renderer && activeElement.hasPointerCapture(event.pointerId)) activeElement.releasePointerCapture(event.pointerId);
    }
    function pointerCancel(event: PointerEvent) { pointers.delete(event.pointerId); press = null; }
    function pointerLeave() { setHoveredId(null); }
    function doubleClick(event: MouseEvent) { const id = paperAt(event); if (id) { callbacksRef.current.onSelect(id); focus(id); } }
    function fallbackWheel(event: WheelEvent) { event.preventDefault(); zoomBy(Math.exp(-event.deltaY * 0.0015)); }
    function preventContext(event: Event) { event.preventDefault(); }
    function contextLost(event: Event) {
      event.preventDefault(); controls?.dispose(); controls = null;
      pointers.clear(); press = null; lastPinch = 0;
      renderer?.domElement.remove(); renderer = null; setMode("svg"); attachInteraction(svg!); invalidate();
    }
    function attachInteraction(element: HTMLCanvasElement | SVGSVGElement) {
      detachInteraction(); activeElement = element;
      element.addEventListener("pointerdown", pointerDown as EventListener);
      element.addEventListener("pointermove", pointerMove as EventListener);
      element.addEventListener("pointerup", pointerUp as EventListener);
      element.addEventListener("pointercancel", pointerCancel as EventListener);
      element.addEventListener("pointerleave", pointerLeave);
      element.addEventListener("dblclick", doubleClick as EventListener);
      element.addEventListener("contextmenu", preventContext);
      if (element === svg) element.addEventListener("wheel", fallbackWheel as EventListener, { passive: false });
    }
    function detachInteraction() {
      activeElement.removeEventListener("pointerdown", pointerDown as EventListener);
      activeElement.removeEventListener("pointermove", pointerMove as EventListener);
      activeElement.removeEventListener("pointerup", pointerUp as EventListener);
      activeElement.removeEventListener("pointercancel", pointerCancel as EventListener);
      activeElement.removeEventListener("pointerleave", pointerLeave);
      activeElement.removeEventListener("dblclick", doubleClick as EventListener);
      activeElement.removeEventListener("contextmenu", preventContext);
      activeElement.removeEventListener("wheel", fallbackWheel as EventListener);
    }
    let createdRenderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
      createdRenderer = renderer;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, stageHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "research-map__webgl";
      host.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false; controls.autoRotate = false;
      controls.enablePan = true; controls.enableZoom = true; controls.rotateSpeed = 0.72; controls.zoomSpeed = 0.85;
      controls.touches.ONE = THREE.TOUCH.ROTATE; controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
      controls.addEventListener("change", () => { if (controls) target.copy(controls.target); invalidate(); });
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      attachInteraction(renderer.domElement); setMode("webgl");
    } catch {
      createdRenderer?.dispose(); createdRenderer?.domElement.remove(); renderer = null; controls?.dispose(); controls = null;
      attachInteraction(svg); setMode("svg");
    }
    sceneRef.current = { zoomBy, reset, focus, rotate, pan, updateSelection, snapshotSvg };
    reset(); updateSelection();
    function resize() {
      const isHidden = host!.clientWidth <= 0;
      const becameVisible = wasHidden && !isHidden;
      wasHidden = isHidden;
      const nextWidth = Math.max(1, host!.clientWidth || 1000); const nextHeight = Math.max(1, host!.clientHeight || height);
      if (width === nextWidth && stageHeight === nextHeight) return;
      width = nextWidth; stageHeight = nextHeight;
      camera.aspect = width / stageHeight; camera.updateProjectionMatrix();
      renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer?.setSize(width, stageHeight);
      if (becameVisible) reset(); else invalidate();
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(host); window.addEventListener("resize", resize);
    return () => {
      disposed = true; if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect(); window.removeEventListener("resize", resize); detachInteraction();
      controls?.dispose();
      createdRenderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      createdRenderer?.dispose(); createdRenderer?.domElement.remove();
      for (const resource of disposables) resource.dispose();
      scene.clear(); sceneRef.current = null;
    };
  }, [layout, height]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const scene = sceneRef.current; if (!scene) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); scene.zoomBy(1.25); }
    else if (event.key === "-" || event.key === "−") { event.preventDefault(); scene.zoomBy(0.8); }
    else if (event.key === "0" || event.key === "Home") { event.preventDefault(); scene.reset(); }
    else if (event.key === "Enter" && selectedId) { event.preventDefault(); scene.focus(selectedId); }
    else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const x = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const y = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (event.shiftKey) scene.pan(x * 0.055, y * 0.055); else scene.rotate(x * 0.15, y * 0.15);
    }
  }
  const projected = new Map(projection.nodes.map((node) => [node.id, node]));
  const originals = new Map(layout.nodes.map((node) => [node.id, node]));
  const labelIds = [...new Set([hoveredId, selectedId].filter((id): id is string => !!id))];
  return <div ref={hostRef} className="research-map__stage research-map__stage--3d" style={{ height, minHeight: height }} tabIndex={0} role="group" aria-label={ko ? "3D 지도 회전·확대·이동 영역" : "3D map rotate, zoom and pan area"} aria-describedby={descriptionId} onKeyDown={onKeyDown}>
    <svg ref={fallbackRef} className="research-map__fallback" style={{ visibility: mode === "webgl" ? "hidden" : "visible" }} width="100%" height="100%" viewBox={`0 0 ${projection.width} ${projection.height}`} aria-hidden="true">
      <defs><radialGradient id={sphereGradientId}><stop offset="0" stopColor="#effbff" /><stop offset="0.28" stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".65" /></radialGradient></defs>
      {layout.edges.map((edge) => { const a = projected.get(edge.source); const b = projected.get(edge.target); if (!a?.visible || !b?.visible) return null; const active = edge.source === selectedId || edge.target === selectedId; return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={mapClusterColor(originals.get(edge.source)!.cluster)} opacity={selectedId ? active ? 0.85 : 0.08 : 0.3} />; })}
      {[...projection.nodes].filter((node) => node.visible).sort((a, b) => b.depth - a.depth).map((node) => <g key={node.id} color={mapClusterColor(originals.get(node.id)!.cluster)}>{node.id === selectedId ? <circle cx={node.x} cy={node.y} r={node.radius + 6} fill="none" stroke="#e4f8ff" opacity=".85" /> : null}<circle cx={node.x} cy={node.y} r={node.radius} fill={`url(#${sphereGradientId})`} /></g>)}
    </svg>
    <span className="research-map__stage-status">{mode === "svg" ? (ko ? "3D 투영 보기 · WebGL 미지원" : "3D projection · WebGL unavailable") : (ko ? "논문 연관 지도" : "Paper relationship map")}</span>
    {!layout.nodes.length ? <p className="research-map__stage-empty">{ko ? "논문을 검색해 3D 연관 지도를 시작하세요." : "Search papers to start your 3D relationship map."}</p> : null}
    {labelIds.map((id) => { const node = projected.get(id); const work = works.get(id); if (!node?.visible || !work) return null; return <div key={id} className={`research-map__floating-label${id === selectedId ? " research-map__floating-label--selected" : ""}`} style={{ left: Math.max(12, Math.min(projection.width - Math.min(300, projection.width - 24), node.x + node.radius + 10)), top: Math.max(42, Math.min(projection.height - 74, node.y - 22)) }}><strong>{work.title || (ko ? "제목 없음" : "Untitled")}</strong><span>{work.year ?? (ko ? "연도 미상" : "Year unavailable")}{id === selectedId ? ` · ${ko ? "선택한 논문" : "Selected paper"}` : ""}</span></div>; })}
    <span className="research-map__stage-hint" aria-hidden="true">{ko ? "드래그하여 회전" : "Drag to rotate"}<span>↔ ↕</span></span>
  </div>;
});
