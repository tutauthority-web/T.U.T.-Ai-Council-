import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import gsap from 'gsap';
import { useWorldTheme } from '../../contexts/WorldThemeContext';
import { PROVIDER_IDS, PROVIDER_REGISTRY, type ProviderId } from '../../shared/providers';
import {
  CharacterActor,
  type CharacterOperationalStatus,
} from '../characters/CharacterActor';
import {
  createPlazaTileTexture,
  createTerrainDetailTexture,
} from '../core/environmentUtils';

export interface PlaygroundProviderPresence {
  providerId: ProviderId;
  name: string;
  shortName: string;
  status: CharacterOperationalStatus;
  modelsCount: number;
  statusDetail: string;
}

export interface PlaygroundWorldProps {
  providers: PlaygroundProviderPresence[];
  gatheringPhase: 'idle' | 'charging' | 'gathering' | 'entered';
  holdProgress: number;
  selectedCharacterId: string | null;
  showLabels?: boolean;
  onSelectCharacter: (id: string) => void;
  onPortalPointerDown: () => void;
  onPortalPointerUpOrLeave: () => void;
  onAllCharactersEntered?: () => void;
}

function getTerrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  // Flat central council plaza within r <= 7.8
  if (dist < 7.8) return 0;
  // Gentle moat/lagoon basin between r = 10.2 and r = 14.8
  if (dist >= 10.2 && dist <= 15.2) {
    const t = Math.sin(((dist - 10.2) / 5.0) * Math.PI);
    return -1.35 * t + Math.sin(x * 0.45) * 0.08;
  }
  // Rising wooded ridges further out & gentle coastal drop beyond r = 21
  const outerHill =
    Math.sin(x * 0.24) * Math.cos(z * 0.24) * 1.15 +
    Math.cos((x + z) * 0.16) * 0.65;
  const coastDrop = dist > 20 ? -Math.pow((dist - 20) * 0.28, 1.6) : 0;
  const ridgeBlend = THREE.MathUtils.smoothstep(dist, 14.5, 18.0);
  const innerRim = THREE.MathUtils.smoothstep(dist, 7.8, 10.2) * -0.45;
  return innerRim + ridgeBlend * (1.2 + outerHill) + coastDrop;
}

/**
 * Custom animated water lagoon surrounding the Council Sanctuary Plaza.
 */
function SanctuaryWater({ isDay, reducedMotion }: { isDay: boolean; reducedMotion: boolean }) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color('#0c3b66') },
      uShallowColor: { value: new THREE.Color('#32a6d8') },
      uSkyTint: { value: new THREE.Color('#b4e4ff') },
      uSunGlow: { value: new THREE.Color('#fff1c7') },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
    if (isDay) {
      uniforms.uDeepColor.value.set('#0e5a8a');
      uniforms.uShallowColor.value.set('#38bdf8');
      uniforms.uSkyTint.value.set('#bae6fd');
      uniforms.uSunGlow.value.set('#fff7d6');
    } else {
      uniforms.uDeepColor.value.set('#061229');
      uniforms.uShallowColor.value.set('#133368');
      uniforms.uSkyTint.value.set('#3b4c92');
      uniforms.uSunGlow.value.set('#93c5fd');
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
      <circleGeometry args={[36, 72]} />
      <shaderMaterial
        transparent
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          varying vec3 vWorldPos;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 pos = position;
            float wave = sin(pos.x * 0.75 + uTime * 1.4) * 0.035 + cos(pos.y * 0.65 - uTime * 1.1) * 0.035;
            pos.z += wave;
            vec4 world = modelMatrix * vec4(pos, 1.0);
            vWorldPos = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform vec3 uDeepColor;
          uniform vec3 uShallowColor;
          uniform vec3 uSkyTint;
          uniform vec3 uSunGlow;
          varying vec3 vWorldPos;
          varying vec2 vUv;

          void main() {
            float r = length(vWorldPos.xz);
            float ripple = sin(r * 2.4 - uTime * 1.6 + sin(vWorldPos.x * 1.2) * 1.4) * 0.5 + 0.5;
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);

            float shoreFactor = 1.0 - smoothstep(9.0, 16.0, r);
            vec3 waterCol = mix(uDeepColor, uShallowColor, clamp(shoreFactor * 0.65 + ripple * 0.25, 0.0, 1.0));
            waterCol = mix(waterCol, uSkyTint, fresnel * 0.62);

            float glint = pow(max(0.0001, sin(vWorldPos.x * 1.9 + uTime * 1.3) * cos(vWorldPos.z * 2.1 - uTime * 0.9)), 12.0);
            waterCol += uSunGlow * glint * 0.35;

            gl_FragColor = vec4(waterCol, 0.88);
          }
        `}
      />
    </mesh>
  );
}

/**
 * Instanced trees + swaying fern/grass clusters for lush organic depth at low draw calls.
 */
function SanctuaryVegetation({ isDay, reducedMotion }: { isDay: boolean; reducedMotion: boolean }) {
  const { qualityTier } = useWorldTheme();
  const trunkRef = useRef<THREE.InstancedMesh | null>(null);
  const crownLowRef = useRef<THREE.InstancedMesh | null>(null);
  const crownHighRef = useRef<THREE.InstancedMesh | null>(null);
  const tuftRef = useRef<THREE.InstancedMesh | null>(null);

  const treeCount = qualityTier === 'lite' ? 16 : 26;
  const tuftCount = qualityTier === 'lite' ? 36 : 78;

  const treeTransforms = useMemo(() => {
    const list: Array<{ x: number; y: number; z: number; scale: number; rot: number }> = [];
    for (let i = 0; i < treeCount; i += 1) {
      const angle = (i / treeCount) * Math.PI * 2 + (i % 3) * 0.09;
      // Leave southern camera sightline slightly clearer
      if (Math.sin(angle) > 0.86 && Math.abs(Math.cos(angle)) < 0.45) continue;
      const radius = 16.0 + ((i * 37) % 10) * 0.45;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = getTerrainHeight(x, z) - 0.15;
      const scale = 0.82 + ((i * 19) % 7) * 0.11;
      list.push({ x, y, z, scale, rot: angle });
    }
    return list;
  }, [treeCount]);

  const tuftTransforms = useMemo(() => {
    const list: Array<{ x: number; y: number; z: number; scale: number; rot: number }> = [];
    for (let i = 0; i < tuftCount; i += 1) {
      const angle = (i * 2.39996); // golden angle
      const radius = 8.1 + ((i * 17) % 20) * 0.08 + (i % 3) * 2.7;
      if (radius > 9.9 && radius < 15.3) continue; // skip water basin
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = getTerrainHeight(x, z);
      list.push({
        x,
        y,
        z,
        scale: 0.65 + (i % 5) * 0.16,
        rot: (i * 1.1) % (Math.PI * 2),
      });
    }
    return list;
  }, [tuftCount]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    treeTransforms.forEach((t, idx) => {
      dummy.position.set(t.x, t.y + 0.85 * t.scale, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.setScalar(t.scale);
      dummy.updateMatrix();
      trunkRef.current?.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(t.x, t.y + 2.05 * t.scale, t.z);
      dummy.scale.set(t.scale, t.scale * 1.05, t.scale);
      dummy.updateMatrix();
      crownLowRef.current?.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(t.x, t.y + 3.15 * t.scale, t.z);
      dummy.scale.set(t.scale * 0.72, t.scale * 0.9, t.scale * 0.72);
      dummy.updateMatrix();
      crownHighRef.current?.setMatrixAt(idx, dummy.matrix);
    });
    if (trunkRef.current) trunkRef.current.instanceMatrix.needsUpdate = true;
    if (crownLowRef.current) crownLowRef.current.instanceMatrix.needsUpdate = true;
    if (crownHighRef.current) crownHighRef.current.instanceMatrix.needsUpdate = true;

    tuftTransforms.forEach((f, idx) => {
      dummy.position.set(f.x, f.y + 0.18 * f.scale, f.z);
      dummy.rotation.set(0, f.rot, 0);
      dummy.scale.setScalar(f.scale);
      dummy.updateMatrix();
      tuftRef.current?.setMatrixAt(idx, dummy.matrix);
    });
    if (tuftRef.current) tuftRef.current.instanceMatrix.needsUpdate = true;
  }, [treeTransforms, tuftTransforms]);

  const swayObj = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (reducedMotion || !crownHighRef.current) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < treeTransforms.length; i += 1) {
      const tr = treeTransforms[i];
      const sway = Math.sin(t * 1.3 + i * 0.7) * 0.045;
      swayObj.position.set(tr.x, tr.y + 3.15 * tr.scale, tr.z);
      swayObj.rotation.set(sway, tr.rot, sway * 0.7);
      swayObj.scale.set(tr.scale * 0.72, tr.scale * 0.9, tr.scale * 0.72);
      swayObj.updateMatrix();
      crownHighRef.current.setMatrixAt(i, swayObj.matrix);
    }
    crownHighRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="SanctuaryVegetation">
      <instancedMesh
        ref={trunkRef}
        args={[undefined, undefined, treeTransforms.length]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.16, 0.25, 1.8, 8]} />
        <meshStandardMaterial color={isDay ? '#5b4232' : '#2b2429'} roughness={0.9} />
      </instancedMesh>

      <instancedMesh
        ref={crownLowRef}
        args={[undefined, undefined, treeTransforms.length]}
        castShadow
        receiveShadow
      >
        <coneGeometry args={[1.25, 2.2, 8]} />
        <meshStandardMaterial color={isDay ? '#2e7d52' : '#13313d'} roughness={0.82} />
      </instancedMesh>

      <instancedMesh
        ref={crownHighRef}
        args={[undefined, undefined, treeTransforms.length]}
        castShadow
        receiveShadow
      >
        <coneGeometry args={[1.05, 1.9, 8]} />
        <meshStandardMaterial color={isDay ? '#3d9964' : '#1a424d'} roughness={0.78} />
      </instancedMesh>

      <instancedMesh
        ref={tuftRef}
        args={[undefined, undefined, tuftTransforms.length]}
      >
        <dodecahedronGeometry args={[0.28, 0]} />
        <meshStandardMaterial color={isDay ? '#4fb36c' : '#1c4f57'} roughness={0.85} />
      </instancedMesh>
    </group>
  );
}

/**
 * Floating luminous fireflies (Night) or golden sunlit pollen motes (Day).
 */
function AtmosphericMotes({
  isDay,
  reducedMotion,
  holdProgress,
}: {
  isDay: boolean;
  reducedMotion: boolean;
  holdProgress: number;
}) {
  const { qualityTier } = useWorldTheme();
  const pointsRef = useRef<THREE.Points | null>(null);
  const count = qualityTier === 'lite' ? 75 : 160;

  const { geometry, basePositions } = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const ang = (i * 2.39996);
      const rad = 1.5 + ((i * 19) % 15);
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const y = 0.6 + ((i * 11) % 38) * 0.12;
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return { geometry: geo, basePositions: base };
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!pointsRef.current || reducedMotion) return;
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    const pull = holdProgress * 0.35;
    for (let i = 0; i < count; i += 1) {
      const bx = basePositions[i * 3];
      const by = basePositions[i * 3 + 1];
      const bz = basePositions[i * 3 + 2];
      // Spiral slightly toward portal when charging!
      const tx = THREE.MathUtils.lerp(bx, 0, pull);
      const tz = THREE.MathUtils.lerp(bz, -5.2, pull);
      posAttr.setXYZ(
        i,
        tx + Math.sin(t * 0.6 + i) * 0.25,
        by + Math.cos(t * 0.8 + i * 0.5) * 0.22 + holdProgress * 0.8,
        tz + Math.cos(t * 0.55 + i) * 0.25,
      );
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color={isDay ? '#fde68a' : '#7dd3fc'}
        size={isDay ? 0.11 : 0.15}
        transparent
        opacity={isDay ? 0.65 : 0.88}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/**
 * Monumental New Council Entrance Portal with progressive activation rings,
 * levitating crystal keystone, and swirling vortex shader.
 */
function CouncilEntrancePortal({
  isDay,
  holdProgress,
  gatheringPhase,
  onPointerDown,
  onPointerUpOrLeave,
}: {
  isDay: boolean;
  holdProgress: number;
  gatheringPhase: 'idle' | 'charging' | 'gathering' | 'entered';
  onPointerDown: () => void;
  onPointerUpOrLeave: () => void;
}) {
  const outerRingRef = useRef<THREE.Mesh | null>(null);
  const innerRingRef = useRef<THREE.Mesh | null>(null);
  const crownHaloRef = useRef<THREE.Mesh | null>(null);
  const keystoneRef = useRef<THREE.Mesh | null>(null);
  const portalLightRef = useRef<THREE.PointLight | null>(null);

  const portalUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCharge: { value: 0 },
      uPrimary: { value: new THREE.Color('#38bdf8') },
      uSecondary: { value: new THREE.Color('#8b5cf6') },
    }),
    [],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const isGathering = gatheringPhase === 'gathering' || gatheringPhase === 'entered';
    const targetCharge = isGathering ? 1.0 : holdProgress;
    portalUniforms.uCharge.value = THREE.MathUtils.lerp(
      portalUniforms.uCharge.value,
      targetCharge,
      Math.min(1, delta * 8),
    );
    portalUniforms.uTime.value = t;

    const spinBoost = 1 + targetCharge * 5.2;
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += delta * 0.45 * spinBoost;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z -= delta * 0.72 * spinBoost;
    }
    if (crownHaloRef.current) {
      crownHaloRef.current.rotation.z -= delta * (0.55 + targetCharge * 2.2);
      crownHaloRef.current.position.y = 4.35 + Math.sin(t * 2.1) * 0.1 + targetCharge * 0.28;
    }
    if (keystoneRef.current) {
      keystoneRef.current.rotation.y += delta * (0.9 + targetCharge * 3.0);
      keystoneRef.current.position.y =
        4.35 + Math.sin(t * 2.1) * 0.1 + targetCharge * 0.28;
    }
    if (portalLightRef.current) {
      portalLightRef.current.intensity =
        (isDay ? 1.6 : 3.2) + targetCharge * 7.5;
    }
  });

  const stoneMatColor = isDay ? '#cbd5e1' : '#1e293b';
  const trimMatColor = isDay ? '#64748b' : '#475569';

  return (
    <group
      name="CouncilEntrancePortal"
      position={[0, 0, -5.4]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        onPointerUpOrLeave();
      }}
      onPointerLeave={onPointerUpOrLeave}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
      }}
    >
      {/* Stepped Circular Dais */}
      <mesh position={[0, 0.12, 0.4]} receiveShadow castShadow>
        <cylinderGeometry args={[2.9, 3.25, 0.24, 32]} />
        <meshStandardMaterial color={stoneMatColor} roughness={0.62} metalness={0.22} />
      </mesh>
      <mesh position={[0, 0.28, 0.2]} receiveShadow castShadow>
        <cylinderGeometry args={[2.1, 2.4, 0.16, 32]} />
        <meshStandardMaterial color={trimMatColor} roughness={0.5} metalness={0.35} />
      </mesh>

      {/* Left & Right Sculpted Monolith Pillars */}
      {[-1.78, 1.78].map((xPos, idx) => (
        <group key={idx} position={[xPos, 1.8, 0]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.28, 0.42, 3.0, 8]} />
            <meshStandardMaterial color={stoneMatColor} roughness={0.48} metalness={0.38} />
          </mesh>
          <mesh position={[0, 0.4, 0.28]}>
            <boxGeometry args={[0.12, 2.1, 0.08]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive="#38bdf8"
              emissiveIntensity={0.8 + holdProgress * 2.2}
            />
          </mesh>
        </group>
      ))}

      {/* Sculpted Overhead Portal Arch */}
      <mesh position={[0, 2.2, 0]} castShadow receiveShadow>
        <torusGeometry args={[1.82, 0.28, 14, 40, Math.PI]} />
        <meshPhysicalMaterial
          color={isDay ? '#e2e8f0' : '#334155'}
          metalness={0.55}
          roughness={0.28}
          clearcoat={0.4}
        />
      </mesh>

      {/* Spinning Outer & Inner Energy Rings */}
      <mesh ref={outerRingRef} position={[0, 2.15, 0.08]}>
        <torusGeometry args={[1.64, 0.045, 10, 48]} />
        <meshStandardMaterial
          color="#7c3aed"
          emissive="#8b5cf6"
          emissiveIntensity={1.2 + holdProgress * 2.6}
        />
      </mesh>

      <mesh ref={innerRingRef} position={[0, 2.15, 0.12]}>
        <torusGeometry args={[1.38, 0.035, 10, 6]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={1.4 + holdProgress * 2.8}
        />
      </mesh>

      {/* Levitating Faceted Keystone Crystal + Crown Halo */}
      <mesh ref={keystoneRef} position={[0, 4.35, 0]} castShadow>
        <octahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial
          color="#a78bfa"
          emissive="#38bdf8"
          emissiveIntensity={1.5 + holdProgress * 2.5}
          roughness={0.15}
          metalness={0.3}
        />
      </mesh>
      <mesh ref={crownHaloRef} rotation={[Math.PI / 2.2, 0, 0]} position={[0, 4.35, 0]}>
        <torusGeometry args={[0.62, 0.024, 8, 32]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#818cf8"
          emissiveIntensity={1.3 + holdProgress * 2.2}
        />
      </mesh>

      {/* Portal Aperture Vortex Shader */}
      <mesh position={[0, 2.15, 0]}>
        <circleGeometry args={[1.52, 48]} />
        <shaderMaterial
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={portalUniforms}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform float uTime;
            uniform float uCharge;
            uniform vec3 uPrimary;
            uniform vec3 uSecondary;
            varying vec2 vUv;

            void main() {
              vec2 p = vUv * 2.0 - 1.0;
              float r = length(p);
              if (r > 1.0) discard;
              float a = atan(p.y, p.x);

              float swirl = sin(a * 5.0 - r * 9.0 + uTime * (2.5 + uCharge * 4.5));
              float rings = cos(r * 14.0 - uTime * (2.0 + uCharge * 3.0)) * 0.5 + 0.5;
              float coreGlow = exp(-r * r * mix(3.2, 1.3, uCharge));
              float edge = smoothstep(0.68, 0.98, r) * (1.0 - smoothstep(0.96, 1.0, r));

              vec3 col = mix(uSecondary, uPrimary, rings * 0.65 + swirl * 0.2 + uCharge * 0.35);
              float alpha = (coreGlow * (0.48 + uCharge * 0.52) + edge * 0.72 + rings * 0.16) * (1.0 - smoothstep(0.95, 1.0, r));
              gl_FragColor = vec4(col * (1.1 + uCharge * 1.1), clamp(alpha, 0.0, 0.96));
            }
          `}
        />
      </mesh>

      <pointLight
        ref={portalLightRef}
        position={[0, 2.2, 0.9]}
        color="#60a5fa"
        intensity={isDay ? 1.6 : 3.2}
        distance={14}
        decay={2}
      />
    </group>
  );
}

export function PlaygroundWorld({
  providers,
  gatheringPhase,
  holdProgress,
  showLabels = true,
  onSelectCharacter,
  onPortalPointerDown,
  onPortalPointerUpOrLeave,
  onAllCharactersEntered,
}: PlaygroundWorldProps) {
  const { isDay, reducedMotion } = useWorldTheme();
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const enteredCountRef = useRef(0);
  const completionFiredRef = useRef(false);

  // Build sculpted island terrain geometry
  const terrainGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(52, 52, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);

    const grassColor = new THREE.Color();
    const shoreColor = new THREE.Color('#c2b280');
    const hillColor = new THREE.Color();

    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getTerrainHeight(x, z);
      pos.setY(i, h);

      const dist = Math.hypot(x, z);
      if (isDay) {
        grassColor.set('#5fa862');
        hillColor.set('#3d7f4f');
      } else {
        grassColor.set('#14263b');
        hillColor.set('#0e1b2f');
      }

      const c = grassColor.clone();
      if (h < -0.25) {
        c.lerp(shoreColor, isDay ? 0.55 : 0.25);
      } else if (dist > 14.5) {
        c.lerp(hillColor, 0.65);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [isDay]);

  const plazaTex = useMemo(() => createPlazaTileTexture(isDay), [isDay]);
  const terrainTex = useMemo(() => createTerrainDetailTexture(isDay), [isDay]);

  useEffect(() => {
    return () => {
      terrainGeo.dispose();
      plazaTex.dispose();
      terrainTex.dispose();
    };
  }, [terrainGeo, plazaTex, terrainTex]);

  // Reset portal entry counters whenever returning to idle
  useEffect(() => {
    if (gatheringPhase === 'idle') {
      enteredCountRef.current = 0;
      completionFiredRef.current = false;
    }
  }, [gatheringPhase]);

  // Camera GSAP transitions for gathering vs charging vs idle
  useEffect(() => {
    if (reducedMotion) return;
    if (gatheringPhase === 'gathering') {
      gsap.to(camera.position, {
        x: 0.4,
        y: 3.4,
        z: 5.4,
        duration: 1.4,
        ease: 'power2.inOut',
      });
      if (controlsRef.current) {
        gsap.to(controlsRef.current.target, {
          x: 0,
          y: 1.85,
          z: -5.0,
          duration: 1.4,
          ease: 'power2.inOut',
        });
      }
    } else if (gatheringPhase === 'idle') {
      gsap.to(camera.position, {
        x: 0,
        y: 8.6,
        z: 15.8,
        duration: 1.1,
        ease: 'power2.out',
      });
      if (controlsRef.current) {
        gsap.to(controlsRef.current.target, {
          x: 0,
          y: 1.0,
          z: -1.4,
          duration: 1.1,
          ease: 'power2.out',
        });
      }
    }
  }, [gatheringPhase, camera, reducedMotion]);

  // Determine how many AI actors will enter portal (Nova + operational/warning providers)
  const visibleProviders = useMemo(() => {
    // Always feature top 4 hero providers + any extra connected providers so world stays vibrant & uncrowded
    const heroSet = new Set<ProviderId>(['google', 'openai', 'anthropic', 'groq']);
    return providers.filter((p) => heroSet.has(p.providerId) || p.status !== 'disconnected');
  }, [providers]);

  const expectedPortalEntrants = useMemo(() => {
    const readyProviders = visibleProviders.filter(
      (p) => p.status === 'operational' || p.status === 'connecting' || p.status === 'warning',
    );
    return 1 + readyProviders.length; // Nova + ready providers
  }, [visibleProviders]);

  const handleCharacterEntered = () => {
    enteredCountRef.current += 1;
    if (!completionFiredRef.current && enteredCountRef.current >= expectedPortalEntrants) {
      completionFiredRef.current = true;
      onAllCharactersEntered?.();
    }
  };

  // Fallback timer safety if user clicks Gather while 0 extra providers connected
  useEffect(() => {
    if (gatheringPhase !== 'gathering') return;
    const maxWaitMs = Math.max(2200, expectedPortalEntrants * 550 + 1800);
    const timer = window.setTimeout(() => {
      if (!completionFiredRef.current) {
        completionFiredRef.current = true;
        onAllCharactersEntered?.();
      }
    }, maxWaitMs);
    return () => window.clearTimeout(timer);
  }, [gatheringPhase, expectedPortalEntrants, onAllCharactersEntered]);

  // Lantern pillar positions along plaza border
  const lanternAngles = useMemo(
    () => [0.55, 1.25, 2.05, 2.75, 3.55, 4.25, 5.05, 5.75],
    [],
  );

  // Home & patrol positions arranged cleanly around plaza
  const providerSlotMap = useMemo(() => {
    const map = new Map<
      ProviderId,
      { home: [number, number, number]; waypoints: Array<[number, number, number]> }
    >();
    const activeList = PROVIDER_IDS;
    activeList.forEach((pid, idx) => {
      const baseAngle = -Math.PI * 0.8 + (idx / Math.max(1, activeList.length - 1)) * Math.PI * 1.6;
      const radius = idx < 4 ? 4.3 : 6.1;
      const hx = Math.sin(baseAngle) * radius;
      const hz = Math.cos(baseAngle) * radius * 0.72 + 0.8;
      map.set(pid, {
        home: [hx, 0.08, hz],
        waypoints: [
          [hx, 0.08, hz],
          [hx * 0.72 + (idx % 2 === 0 ? 1.1 : -1.1), 0.08, hz - 1.2],
          [hx * 0.88, 0.08, hz + 0.65],
        ],
      });
    });
    return map;
  }, []);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.055}
        enablePan={false}
        minPolarAngle={0.28}
        maxPolarAngle={Math.PI * 0.44}
        minDistance={7.5}
        maxDistance={25}
        target={[0, 1.0, -1.4]}
      />

      {/* Sculpted Sanctuary Terrain */}
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial
          vertexColors
          map={terrainTex}
          roughness={0.88}
          metalness={0.05}
        />
      </mesh>

      {/* Central Council Sanctuary Plaza Floor */}
      <group name="CouncilPlaza">
        <mesh position={[0, 0.04, 0]} receiveShadow>
          <cylinderGeometry args={[7.8, 8.2, 0.16, 48]} />
          <meshStandardMaterial map={plazaTex} roughness={0.68} metalness={0.14} />
        </mesh>

        {/* Concentric Inlaid Energy / Brass Rings */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.125, 0]}>
          <ringGeometry args={[3.4, 3.56, 48]} />
          <meshStandardMaterial
            color={isDay ? '#94a3b8' : '#38bdf8'}
            emissive={isDay ? '#38bdf8' : '#38bdf8'}
            emissiveIntensity={isDay ? 0.25 : 0.95 + holdProgress * 1.4}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.125, 0]}>
          <ringGeometry args={[6.2, 6.34, 64]} />
          <meshStandardMaterial
            color={isDay ? '#a78bfa' : '#8b5cf6'}
            emissive="#7c3aed"
            emissiveIntensity={isDay ? 0.2 : 0.75 + holdProgress * 1.4}
          />
        </mesh>

        {/* Southern Wooden & Stone Bridge across the Moat */}
        <group position={[0, 0.05, 11.8]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[2.8, 0.22, 7.6]} />
            <meshStandardMaterial color={isDay ? '#9a7b56' : '#26324d'} roughness={0.78} />
          </mesh>
          {[-1.25, 1.25].map((rx, idx) => (
            <mesh key={idx} position={[rx, 0.45, 0]} castShadow>
              <boxGeometry args={[0.14, 0.68, 7.5]} />
              <meshStandardMaterial color={isDay ? '#64748b' : '#334155'} roughness={0.6} />
            </mesh>
          ))}
        </group>

        {/* Sanctuary Lantern Pillars */}
        {lanternAngles.map((ang, idx) => {
          const lx = Math.cos(ang) * 7.35;
          const lz = Math.sin(ang) * 7.35;
          return (
            <group key={idx} position={[lx, 0.12, lz]}>
              <mesh position={[0, 0.45, 0]} castShadow>
                <cylinderGeometry args={[0.1, 0.14, 0.9, 8]} />
                <meshStandardMaterial color={isDay ? '#94a3b8' : '#1e293b'} roughness={0.6} />
              </mesh>
              <mesh position={[0, 1.0, 0]}>
                <octahedronGeometry args={[0.16, 0]} />
                <meshStandardMaterial
                  color={isDay ? '#fde68a' : '#7dd3fc'}
                  emissive={isDay ? '#fbbf24' : '#38bdf8'}
                  emissiveIntensity={isDay ? 0.45 : 1.75}
                />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* Animated Lagoon Water */}
      <SanctuaryWater isDay={isDay} reducedMotion={reducedMotion} />

      {/* Instanced Trees & Flora */}
      <SanctuaryVegetation isDay={isDay} reducedMotion={reducedMotion} />

      {/* Atmospheric Fireflies / Sunbeams */}
      <AtmosphericMotes
        isDay={isDay}
        reducedMotion={reducedMotion}
        holdProgress={holdProgress}
      />

      {/* Focal New Council Entrance Portal */}
      <CouncilEntrancePortal
        isDay={isDay}
        holdProgress={holdProgress}
        gatheringPhase={gatheringPhase}
        onPointerDown={onPortalPointerDown}
        onPointerUpOrLeave={onPortalPointerUpOrLeave}
      />

      {/* Central Companion: T.U.T AI Nova */}
      <CharacterActor
        id="nova"
        label="T.U.T AI Nova"
        sublabel="Council Companion"
        kind="nova"
        homePosition={[0, 0.12, 0.6]}
        patrolWaypoints={[
          [0, 0.12, 0.6],
          [1.6, 0.12, -0.8],
          [-1.5, 0.12, -0.4],
          [0.3, 0.12, 1.9],
        ]}
        status="operational"
        gatheringPhase={gatheringPhase}
        gatherDelaySec={Math.max(0.6, (expectedPortalEntrants - 1) * 0.45)}
        holdProgress={holdProgress}
        reducedMotion={reducedMotion}
        showLabels={showLabels}
        onSelect={onSelectCharacter}
        onEnteredPortal={handleCharacterEntered}
      />

      {/* Live AI Provider Characters */}
      {visibleProviders.map((prov, idx) => {
        const slot = providerSlotMap.get(prov.providerId) || {
          home: [3, 0.08, 2] as [number, number, number],
          waypoints: [],
        };
        const cfg = PROVIDER_REGISTRY[prov.providerId];
        return (
          <CharacterActor
            key={prov.providerId}
            id={prov.providerId}
            label={cfg?.shortName || prov.shortName}
            sublabel={prov.statusDetail}
            kind={prov.providerId}
            homePosition={slot.home}
            patrolWaypoints={slot.waypoints}
            status={prov.status}
            gatheringPhase={gatheringPhase}
            gatherDelaySec={0.2 + idx * 0.35}
            holdProgress={holdProgress}
            reducedMotion={reducedMotion}
            showLabels={showLabels}
            onSelect={onSelectCharacter}
            onEnteredPortal={handleCharacterEntered}
          />
        );
      })}
    </>
  );
}
