"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const BRAND = "#ee4444";
const ACCENT = "#c9cacd";

function fibonacciSphere(n: number, radius: number) {
  const pts: THREE.Vector3[] = [];
  const offset = 2 / n;
  const inc = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = i * offset - 1 + offset / 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * inc;
    pts.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(radius));
  }
  return pts;
}

function circleTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function Network() {
  const group = useRef<THREE.Group>(null);

  const { basePos, accentPos, linePos, tex } = useMemo(() => {
    const N = 90;
    const R = 2.6;
    const nodes = fibonacciSphere(N, R);

    // accent (gris) nodes = a handful, base (rojo) = the rest
    const accentIdx = new Set<number>();
    for (let i = 0; i < 10; i++) accentIdx.add(Math.floor((i / 10) * N));

    const base: number[] = [];
    const accent: number[] = [];
    nodes.forEach((p, i) => {
      if (accentIdx.has(i)) accent.push(p.x, p.y, p.z);
      else base.push(p.x, p.y, p.z);
    });

    // connect nearby nodes
    const lines: number[] = [];
    const threshold = 1.35;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].distanceTo(nodes[j]) < threshold) {
          lines.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z);
        }
      }
    }

    return {
      basePos: new Float32Array(base),
      accentPos: new Float32Array(accent),
      linePos: new Float32Array(lines),
      tex: circleTexture(),
    };
  }, []);

  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useFrame((state, delta) => {
    if (!group.current) return;
    if (!reduce) group.current.rotation.y += delta * 0.08;
    group.current.rotation.x = THREE.MathUtils.lerp(
      group.current.rotation.x,
      -state.pointer.y * 0.3,
      0.04,
    );
    group.current.position.x = THREE.MathUtils.lerp(
      group.current.position.x,
      state.pointer.x * 0.35,
      0.04,
    );
  });

  return (
    <group ref={group}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={BRAND} transparent opacity={0.16} depthWrite={false} />
      </lineSegments>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[basePos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={tex}
          color={BRAND}
          size={0.19}
          transparent
          opacity={0.95}
          depthWrite={false}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
        />
      </points>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[accentPos, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={tex}
          color={ACCENT}
          size={0.3}
          transparent
          opacity={1}
          depthWrite={false}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export default function HeroCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 48 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ pointerEvents: "none" }}
    >
      <Network />
    </Canvas>
  );
}
