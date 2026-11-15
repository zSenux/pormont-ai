"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Shape } from "@/lib/vorlagen/model";

// 3D-Vorschau für Angebotsvorlagen (three.js, nur im Browser geladen). Drehen mit der Maus/dem Finger, Zoomen per Rad/Pinch.
// capture() liefert ein JPEG der aktuellen Ansicht fürs Angebots-PDF.

export type ViewerHandle = { capture: () => string | null };

type Ctx = {
  T: typeof THREE;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
  render: () => void;
  dispose: () => void;
};

export function ModelViewer({ shapes, color, fitKey, className, ref, onReady }: { shapes: Shape[]; color: string; fitKey: string; className?: string; ref?: Ref<ViewerHandle>; onReady?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const fitted = useRef<string | null>(null);
  const fitR = useRef<number | null>(null);
  const [state, setState] = useState<"laden" | "ok" | "fehler">("laden");

  useImperativeHandle(ref, () => ({
    capture() {
      const c = ctx.current;
      if (!c) return null;
      const { renderer, camera } = c;
      const size = renderer.getSize(new c.T.Vector2());
      const ratio = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(1500, 1000, false);
      // Bild im Querformat 3:2 – ist die Ansicht schmaler, Kamera so weit zurück, dass die Breite gleich bleibt
      const before = camera.position.clone();
      const aspect = size.x / Math.max(1, size.y);
      const off = before.clone().sub(c.controls.target);
      if (fitR.current) {
        // Abstand fürs Bild neu bestimmen (Blickrichtung bleibt), damit das ganze Bauteil drauf ist
        const tv = Math.tan((camera.fov * Math.PI) / 360);
        const dist = Math.max(fitR.current / (tv * 1.5), (fitR.current * 0.75) / tv) * 1.08;
        off.normalize().multiplyScalar(dist);
      } else if (aspect > 1.5) off.multiplyScalar(aspect / 1.5);
      camera.position.copy(c.controls.target).add(off);
      camera.aspect = 1.5;
      camera.updateProjectionMatrix();
      renderer.render(c.scene, camera);
      camera.position.copy(before);
      const url = renderer.domElement.toDataURL("image/jpeg", 0.86);
      renderer.setPixelRatio(ratio);
      renderer.setSize(size.x, size.y, false);
      camera.aspect = size.x / Math.max(1, size.y);
      camera.updateProjectionMatrix();
      c.render();
      return url;
    },
  }));

  // Szene einmal aufbauen
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [T, { OrbitControls: Orbit }, { RoomEnvironment }] = await Promise.all([import("three"), import("three/addons/controls/OrbitControls.js"), import("three/addons/environments/RoomEnvironment.js")]);
        if (dead || !box.current) return;
        const el = box.current;
        const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        el.appendChild(renderer.domElement);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        renderer.domElement.style.touchAction = "none";
        const scene = new T.Scene();
        scene.background = new T.Color("#eef2f5");
        const pmrem = new T.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.add(new T.HemisphereLight("#ffffff", "#c9d2da", 0.6));
        const sun = new T.DirectionalLight("#ffffff", 1.6);
        sun.position.set(4, 8, 6);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0005;
        scene.add(sun);
        scene.add(sun.target);
        const camera = new T.PerspectiveCamera(35, 1, 0.05, 200);
        const controls = new Orbit(camera, renderer.domElement);
        controls.enableDamping = false;
        controls.maxPolarAngle = Math.PI * 0.495;
        const group = new T.Group();
        scene.add(group);
        const render = () => renderer.render(scene, camera);
        controls.addEventListener("change", render);
        const resize = () => {
          const w = el.clientWidth || 600;
          const h = el.clientHeight || 400;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          render();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();
        ctx.current = {
          T, renderer, scene, camera, controls, group, render,
          dispose() {
            ro.disconnect();
            controls.dispose();
            pmrem.dispose();
            renderer.dispose();
            renderer.domElement.remove();
          },
        };
        setState("ok");
      } catch (e) {
        console.error("[3d]", e);
        setState("fehler");
      }
    })();
    return () => {
      dead = true;
      ctx.current?.dispose();
      ctx.current = null;
    };
  }, []);

  // Modell (neu) aufbauen
  useEffect(() => {
    const c = ctx.current;
    if (!c || state !== "ok") return;
    const { T, group } = c;
    for (const m of [...group.children]) {
      group.remove(m);
      const mesh = m as THREE.Mesh;
      mesh.geometry?.dispose();
    }
    const metal = new T.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.9 });
    const glass = new T.MeshStandardMaterial({ color: "#9fd0e6", metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.42, envMapIntensity: 1.2, depthWrite: false });
    const grate = new T.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.5, map: grateTexture(T) });
    const wall = new T.MeshStandardMaterial({ color: "#d9d2c7", roughness: 0.95, envMapIntensity: 0.4 });
    const floor = new T.MeshStandardMaterial({ color: "#b9c2ca", roughness: 0.95, envMapIntensity: 0.4 });
    const Y = new T.Vector3(0, 1, 0);
    for (const s of shapes) {
      let mesh: THREE.Mesh;
      if (s.kind === "bar") {
        const a = new T.Vector3(...s.a);
        const b = new T.Vector3(...s.b);
        const dir = b.clone().sub(a);
        const len = dir.length();
        dir.normalize();
        const geo = s.section.type === "round" ? new T.CylinderGeometry(s.section.d / 2, s.section.d / 2, len, 20) : new T.BoxGeometry(s.section.w, len, s.section.h);
        mesh = new T.Mesh(geo, metal);
        let side = new T.Vector3(...(s.side ?? [0, 0, 1]));
        if (Math.abs(side.dot(dir)) > 0.95) side = Math.abs(dir.dot(new T.Vector3(1, 0, 0))) > 0.95 ? new T.Vector3(0, 0, 1) : new T.Vector3(1, 0, 0);
        side.sub(dir.clone().multiplyScalar(side.dot(dir))).normalize();
        const third = side.clone().cross(dir).normalize();
        const m = new T.Matrix4().makeBasis(side, dir, third);
        mesh.quaternion.setFromRotationMatrix(m);
        if (s.section.type === "round") mesh.quaternion.setFromUnitVectors(Y, dir);
        mesh.position.copy(a.add(b).multiplyScalar(0.5));
      } else {
        const geo = new T.BoxGeometry(...s.size);
        mesh = new T.Mesh(geo, s.tone === "glass" ? glass : s.tone === "grate" ? grate : s.tone === "wall" ? wall : s.tone === "floor" ? floor : metal);
        mesh.position.set(...s.center);
      }
      const scenery = s.kind === "box" && (s.tone === "wall" || s.tone === "floor");
      mesh.castShadow = !scenery && !(s.kind === "box" && s.tone === "glass");
      mesh.receiveShadow = true;
      mesh.userData.scenery = scenery;
      group.add(mesh);
    }
    // Kamera auf das Bauteil (ohne Boden/Wand) ausrichten – nur beim Produktwechsel
    const bb = new T.Box3();
    group.children.forEach((m) => {
      if (!m.userData.scenery) bb.expandByObject(m);
    });
    if (!bb.isEmpty()) {
      const center = bb.getCenter(new T.Vector3());
      const size = bb.getSize(new T.Vector3());
      const r = Math.max(size.x, size.y, size.z, 0.5);
      const sun = c.scene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
      if (sun) {
        sun.position.set(center.x + r * 1.2, center.y + r * 2.2, center.z + r * 1.8);
        sun.target.position.copy(center);
        const cam = sun.shadow.camera as THREE.OrthographicCamera;
        cam.left = -r * 1.5;
        cam.right = r * 1.5;
        cam.top = r * 1.5;
        cam.bottom = -r * 1.5;
        cam.near = 0.1;
        cam.far = r * 8;
        cam.updateProjectionMatrix();
      }
      // Neu ausrichten bei anderem Produkt oder geänderten Maßen – die Blickrichtung des Nutzers bleibt dabei erhalten
      const key = `${fitKey}|${size.x.toFixed(2)}|${size.y.toFixed(2)}|${size.z.toFixed(2)}`;
      if (fitted.current !== key) {
        const sameProduct = fitted.current?.split("|")[0] === fitKey;
        fitted.current = key;
        // Abstand so, dass das Bauteil (Hüllkugel) in Breite und Höhe ins Bild passt
        const R = Math.max(size.length() / 2, 0.4);
        fitR.current = R;
        const tv = Math.tan((c.camera.fov * Math.PI) / 360);
        const th = tv * Math.max(c.camera.aspect, 0.5);
        const dist = Math.max(R / th, (R * 0.75) / tv) * 1.08;
        const dir = sameProduct ? c.camera.position.clone().sub(c.controls.target).normalize() : new T.Vector3(0.45, 0.55, 0.8).normalize();
        c.camera.position.copy(center).add(dir.multiplyScalar(dist * 1.08));
        c.controls.target.copy(center);
        c.camera.near = dist / 100;
        c.camera.far = dist * 20;
        c.camera.updateProjectionMatrix();
        c.controls.update();
      }
    }
    c.render();
    onReady?.();
  }, [shapes, color, fitKey, state, onReady]);

  return (
    <div ref={box} className={className ?? "relative h-80 w-full overflow-hidden rounded-xl bg-[#eef2f5]"}>
      {state !== "ok" && <p className="absolute inset-0 grid place-items-center text-sm text-steel">{state === "laden" ? "3D-Ansicht wird geladen …" : "3D-Ansicht wird von diesem Gerät nicht unterstützt."}</p>}
    </div>
  );
}

let grateCache: THREE.Texture | null = null;
/** Gitterrost-Muster (Maschen 30 x 10 mm) als Textur */
function grateTexture(T: typeof THREE) {
  if (grateCache) return grateCache;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3f44";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#ffffff";
  for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 3, 64);
  for (let y = 0; y < 64; y += 21) g.fillRect(0, y, 64, 3);
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(4, 2);
  t.colorSpace = T.SRGBColorSpace;
  grateCache = t;
  return t;
}
