import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface WorldLabelEntry {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export class WorldLabelRegistry {
  private entries = new Map<string, WorldLabelEntry>();
  private domNodes = new Map<string, HTMLDivElement>();
  private listeners = new Set<() => void>();
  private snapshot: WorldLabelEntry[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WorldLabelEntry[] => this.snapshot;

  private emit(): void {
    this.snapshot = Array.from(this.entries.values());
    this.listeners.forEach((fn) => fn());
  }

  upsert(id: string, children: React.ReactNode, style?: React.CSSProperties): void {
    this.entries.set(id, { id, children, style });
    this.emit();
  }

  remove(id: string): void {
    if (this.entries.delete(id)) {
      this.domNodes.delete(id);
      this.emit();
    }
  }

  setDomNode(id: string, node: HTMLDivElement | null): void {
    if (node) {
      this.domNodes.set(id, node);
    } else {
      this.domNodes.delete(id);
    }
  }

  getDomNode(id: string): HTMLDivElement | undefined {
    return this.domNodes.get(id);
  }
}

export const WorldLabelContext = createContext<WorldLabelRegistry | null>(null);

export function WorldLabelOverlay({ registry }: { registry: WorldLabelRegistry }) {
  const entries = useSyncExternalStore(registry.subscribe, registry.getSnapshot);

  if (entries.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden z-10"
      aria-hidden="true"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          ref={(el) => registry.setDomNode(entry.id, el)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'none',
            transformOrigin: '0 0',
            willChange: 'transform',
            ...entry.style,
          }}
        >
          {entry.children}
        </div>
      ))}
    </div>
  );
}

const TMP_POS = new THREE.Vector3();
const TMP_CAM_POS = new THREE.Vector3();
const TMP_CAM_DIR = new THREE.Vector3();
const TMP_DIFF = new THREE.Vector3();
const TMP_PROJ = new THREE.Vector3();

interface ProjectedHtmlProps {
  position?: [number, number, number];
  center?: boolean;
  distanceFactor?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * React 19-safe 3D-to-2D projected HTML label replacement for Drei's <Html>.
 * Renders labels inside the parent WorldCanvas ReactDOM tree via a single shared overlay,
 * avoiding nested ReactDOM.createRoot() synchronous unmount race conditions.
 */
export function ProjectedHtml({
  position = [0, 0, 0],
  center = true,
  distanceFactor,
  style,
  children,
}: ProjectedHtmlProps) {
  const registry = useContext(WorldLabelContext);
  const id = useId();
  const groupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!registry) return;
    registry.upsert(id, children, style);
  }, [registry, id, children, style]);

  useEffect(() => {
    if (!registry) return;
    return () => {
      registry.remove(id);
    };
  }, [registry, id]);

  useFrame(({ camera, size }) => {
    if (!registry || !groupRef.current) return;
    const el = registry.getDomNode(id);
    if (!el) return;

    groupRef.current.updateWorldMatrix(true, false);
    TMP_POS.setFromMatrixPosition(groupRef.current.matrixWorld);
    TMP_CAM_POS.setFromMatrixPosition(camera.matrixWorld);
    TMP_DIFF.copy(TMP_POS).sub(TMP_CAM_POS);
    const dist = TMP_DIFF.length();

    camera.getWorldDirection(TMP_CAM_DIR);
    const inFront = TMP_DIFF.dot(TMP_CAM_DIR) > 0;

    TMP_PROJ.copy(TMP_POS).project(camera);
    const visible =
      inFront &&
      TMP_PROJ.z >= -1 &&
      TMP_PROJ.z <= 1 &&
      TMP_PROJ.x >= -1.25 &&
      TMP_PROJ.x <= 1.25 &&
      TMP_PROJ.y >= -1.25 &&
      TMP_PROJ.y <= 1.25;

    if (!visible) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }

    if (el.style.display !== 'block') el.style.display = 'block';

    const x = (TMP_PROJ.x * 0.5 + 0.5) * size.width;
    const y = (-TMP_PROJ.y * 0.5 + 0.5) * size.height;

    let scale = 1;
    if (distanceFactor !== undefined && 'fov' in camera) {
      const persp = camera as THREE.PerspectiveCamera;
      const vFov = (persp.fov * Math.PI) / 180;
      const denom = 2 * Math.tan(vFov / 2) * Math.max(0.1, dist);
      scale = distanceFactor / denom;
    }

    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})${
      center ? ' translate(-50%, -50%)' : ''
    }`;
    el.style.zIndex = String(Math.max(1, Math.round(10000 - dist * 10)));
  });

  return <group ref={groupRef} position={position} />;
}
