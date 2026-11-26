import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import gsap from 'gsap';
import { useWorldTheme } from '../../contexts/WorldThemeContext';
import type { ProviderId } from '../../shared/providers';
import { createArchitecturalWindowTexture } from '../core/environmentUtils';
import { ProjectedHtml } from '../core/ProjectedHtml';
import type {
  CityArchitectureConfig,
  CityDistrictData,
  CityModelBuildingData,
  ModelLandLevel,
} from './modelLandData';

interface ModelLandWorldProps {
  districts: CityDistrictData[];
  level: ModelLandLevel;
  selectedCityId: ProviderId | null;
  selectedBuildingId: string | null;
  showLabels?: boolean;
  isPremium?: boolean;
  resetCameraSeq?: number;
  onSelectCity: (providerId: ProviderId) => void;
  onSelectBuilding: (building: CityModelBuildingData) => void;
}

// Pre-allocated scratch math objects (zero GC allocations inside useFrame)
const _routeOrbPos = new THREE.Vector3();
const _shuttlePos = new THREE.Vector3();
const _shuttleTangent = new THREE.Vector3();
const _shuttleLookAt = new THREE.Vector3();
const _sparkDummy = new THREE.Object3D();

/**
 * Expansive animated ocean surrounding the AI Model Land archipelago,
 * with multi-octave swells, caustic shimmer, and Fresnel horizon sheen.
 */
function ArchipelagoOcean({
  isDay,
  reducedMotion,
}: {
  isDay: boolean;
  reducedMotion: boolean;
}) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#0b4275') },
      uCrest: { value: new THREE.Color('#2ca3d9') },
      uHorizon: { value: new THREE.Color('#b4e2fa') },
      uHighlight: { value: new THREE.Color('#fff5d4') },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime;
    if (isDay) {
      uniforms.uDeep.value.set('#0e548a');
      uniforms.uCrest.value.set('#38bdf8');
      uniforms.uHorizon.value.set('#bae6fd');
      uniforms.uHighlight.value.set('#fff7d6');
    } else {
      uniforms.uDeep.value.set('#040b1c');
      uniforms.uCrest.value.set('#123269');
      uniforms.uHorizon.value.set('#0f1d3a');
      uniforms.uHighlight.value.set('#7dd3fc');
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0]} receiveShadow>
      <planeGeometry args={[420, 420, 80, 80]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          varying vec3 vWorldPos;
          void main() {
            vec3 pos = position;
            float w1 = sin(pos.x * 0.14 + uTime * 1.15) * 0.13;
            float w2 = cos(pos.y * 0.18 - uTime * 0.92) * 0.11;
            float w3 = sin((pos.x + pos.y) * 0.08 + uTime * 0.7) * 0.08;
            pos.z += w1 + w2 + w3;
            vec4 world = modelMatrix * vec4(pos, 1.0);
            vWorldPos = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform vec3 uDeep;
          uniform vec3 uCrest;
          uniform vec3 uHorizon;
          uniform vec3 uHighlight;
          varying vec3 vWorldPos;

          void main() {
            float waveA = sin(vWorldPos.x * 0.42 + uTime * 1.25) * cos(vWorldPos.z * 0.38 - uTime * 0.95);
            float waveB = sin(vWorldPos.x * 0.21 - vWorldPos.z * 0.25 + uTime * 0.75);
            float radialPulse = sin(length(vWorldPos.xz) * 0.35 - uTime * 1.1) * 0.5 + 0.5;

            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(max(0.0001, 1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0)), 3.0);
            float distFade = smoothstep(55.0, 185.0, length(vWorldPos.xz));

            vec3 col = mix(uDeep, uCrest, clamp(waveA * 0.32 + waveB * 0.14 + 0.44, 0.0, 1.0));
            col += uCrest * radialPulse * 0.08;
            col = mix(col, uHorizon, clamp(fresnel * 0.62 + distFade * 0.72, 0.0, 1.0));

            float glint = pow(max(0.0001, waveA * 0.7 + waveB * 0.3), 7.0);
            col += uHighlight * glint * 0.32;

            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/**
 * Distant sculpted sea stacks, floating monoliths, and perimeter horizon beacons
 * framing the archipelago so no horizon direction ever looks empty.
 */
function HorizonArchipelago({
  isDay,
  reducedMotion,
  qualityTier,
}: {
  isDay: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'balanced' | 'lite';
}) {
  const beaconsRef = useRef<THREE.Group | null>(null);
  const stackCount = qualityTier === 'lite' ? 10 : 18;

  const stacks = useMemo(() => {
    const items: Array<{
      x: number;
      z: number;
      scale: number;
      height: number;
      rotY: number;
      color: string;
      phase: number;
    }> = [];
    const palette = ['#38bdf8', '#818cf8', '#34d399', '#a78bfa', '#fbbf24', '#2dd4bf'];
    for (let i = 0; i < stackCount; i += 1) {
      const angle = (i / stackCount) * Math.PI * 2 + 0.19;
      const radius = 37 + (i % 4) * 6.5;
      items.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        scale: 1.45 + (i % 3) * 0.75,
        height: 3.4 + (i % 5) * 1.45,
        rotY: angle + (i % 2) * 0.7,
        color: palette[i % palette.length],
        phase: i * 0.85,
      });
    }
    return items;
  }, [stackCount]);

  useFrame((state) => {
    if (reducedMotion || !beaconsRef.current) return;
    const t = state.clock.elapsedTime;
    beaconsRef.current.children.forEach((child, idx) => {
      const st = stacks[idx];
      if (!st) return;
      child.position.y = st.height + 1.05 + Math.sin(t * 1.5 + st.phase) * 0.28;
      child.rotation.y = t * 0.85 + st.phase;
    });
  });

  return (
    <group name="HorizonArchipelago">
      {stacks.map((st, idx) => (
        <group key={idx} position={[st.x, -0.35, st.z]} rotation={[0, st.rotY, 0]}>
          {/* Terraced Sea Stack Base */}
          <mesh position={[0, 0.55, 0]} receiveShadow>
            <cylinderGeometry args={[st.scale * 1.15, st.scale * 1.75, 1.15, 7]} />
            <meshStandardMaterial
              color={isDay ? '#94a3b8' : '#0f172a'}
              roughness={0.85}
              metalness={0.18}
            />
          </mesh>
          {/* Sculpted Basalt Spire */}
          <mesh position={[0, 1.1 + st.height * 0.45, 0]}>
            <cylinderGeometry args={[st.scale * 0.35, st.scale * 0.92, st.height, 6]} />
            <meshStandardMaterial
              color={isDay ? '#64748b' : '#1e293b'}
              roughness={0.72}
              metalness={0.28}
            />
          </mesh>
          {/* Glowing Horizon Collar */}
          <mesh position={[0, st.height + 0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[st.scale * 0.52, 0.065, 6, 18]} />
            <meshStandardMaterial
              color={st.color}
              emissive={st.color}
              emissiveIntensity={isDay ? 0.65 : 1.45}
            />
          </mesh>
        </group>
      ))}

      {/* Levitating Lighthouse Crystal Tips */}
      <group ref={beaconsRef}>
        {stacks.map((st, idx) => (
          <mesh key={idx} position={[st.x, st.height + 0.7, st.z]}>
            <octahedronGeometry args={[0.42, 0]} />
            <meshStandardMaterial
              color={st.color}
              emissive={st.color}
              emissiveIntensity={isDay ? 0.9 : 1.9}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * Sweeping high-altitude Orbital Sanctuary Ring & relay satellites circling Model Land.
 */
function OrbitalSanctuaryRing({
  isDay,
  isPremium,
  reducedMotion,
  qualityTier,
}: {
  isDay: boolean;
  isPremium: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'balanced' | 'lite';
}) {
  const outerRingRef = useRef<THREE.Group | null>(null);
  const innerRingRef = useRef<THREE.Group | null>(null);
  const satCount = qualityTier === 'lite' ? 4 : 6;

  useFrame((state, delta) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    if (outerRingRef.current) {
      outerRingRef.current.rotation.y += delta * 0.045;
      outerRingRef.current.position.y = 14.5 + Math.sin(t * 0.4) * 0.35;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.y -= delta * 0.075;
    }
  });

  const primaryCol = isPremium ? '#fbbf24' : '#38bdf8';
  const secondaryCol = isPremium ? '#38bdf8' : '#818cf8';

  return (
    <group name="OrbitalSanctuaryRing">
      <group ref={outerRingRef} position={[0, 14.5, 0]} rotation={[0.14, 0, -0.09]}>
        {/* Main Orbital Gantry Halo */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[28.5, 0.14, 10, 96]} />
          <meshStandardMaterial
            color={primaryCol}
            emissive={primaryCol}
            emissiveIntensity={isDay ? 0.55 : 1.35}
            transparent
            opacity={0.72}
          />
        </mesh>

        {/* Outer Fine Track */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[30.2, 0.055, 8, 96]} />
          <meshStandardMaterial
            color={secondaryCol}
            emissive={secondaryCol}
            emissiveIntensity={isDay ? 0.45 : 1.1}
            transparent
            opacity={0.5}
          />
        </mesh>

        {/* Orbital Relay Satellites */}
        {Array.from({ length: satCount }).map((_, i) => {
          const angle = (i / satCount) * Math.PI * 2;
          const r = 28.5;
          return (
            <group
              key={i}
              position={[Math.cos(angle) * r, 0, Math.sin(angle) * r]}
              rotation={[0, -angle, 0]}
            >
              <mesh>
                <octahedronGeometry args={[0.52, 0]} />
                <meshStandardMaterial
                  color={primaryCol}
                  emissive={primaryCol}
                  emissiveIntensity={isDay ? 0.9 : 1.8}
                />
              </mesh>
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[1.65, 0.08, 0.45]} />
                <meshStandardMaterial
                  color={isDay ? '#e2e8f0' : '#334155'}
                  metalness={0.65}
                  roughness={0.25}
                />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* Inner Counter-Rotating Constellation Track */}
      <group ref={innerRingRef} position={[0, 11.2, 0]} rotation={[-0.12, 0, 0.11]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[19.5, 0.075, 8, 72]} />
          <meshStandardMaterial
            color={secondaryCol}
            emissive={secondaryCol}
            emissiveIntensity={isDay ? 0.45 : 1.25}
            transparent
            opacity={0.48}
          />
        </mesh>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 19.5, 0, Math.sin(a) * 19.5]}>
              <sphereGeometry args={[0.26, 8, 8]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive={secondaryCol}
                emissiveIntensity={1.9}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/**
 * Six autonomous multi-part winged data shuttles flying smoothly along closed 3D routes
 * between islands so the sky above Model Land is alive with motion.
 */
function AutonomousDataShuttles({
  isDay,
  isPremium,
  reducedMotion,
  qualityTier,
}: {
  isDay: boolean;
  isPremium: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'balanced' | 'lite';
}) {
  const shuttlesRef = useRef<Array<THREE.Group | null>>([]);
  const shuttleCount = qualityTier === 'lite' ? 3 : 6;

  const flightPaths = useMemo(() => {
    const configs = [
      { rx: 14, rz: 14, yBase: 5.8, yAmp: 1.4, speed: 0.14, phase: 0.0, color: '#38bdf8' },
      { rx: 21, rz: 16, yBase: 7.4, yAmp: 1.8, speed: -0.11, phase: 1.3, color: '#a78bfa' },
      { rx: 16, rz: 22, yBase: 6.5, yAmp: 1.5, speed: 0.125, phase: 2.6, color: '#34d399' },
      { rx: 24, rz: 24, yBase: 9.2, yAmp: 2.1, speed: -0.095, phase: 3.9, color: '#fbbf24' },
      { rx: 11, rz: 18, yBase: 5.2, yAmp: 1.1, speed: 0.16, phase: 5.0, color: '#f472b6' },
      { rx: 26, rz: 14, yBase: 8.4, yAmp: 1.6, speed: 0.105, phase: 4.2, color: '#22d3ee' },
    ];
    return configs.slice(0, shuttleCount).map((cfg) => {
      const pts: THREE.Vector3[] = [];
      const steps = 16;
      for (let i = 0; i < steps; i += 1) {
        const a = (i / steps) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            Math.cos(a) * cfg.rx + Math.sin(a * 2) * 1.8,
            cfg.yBase + Math.sin(a * 3 + cfg.phase) * cfg.yAmp,
            Math.sin(a) * cfg.rz + Math.cos(a * 2) * 1.8,
          ),
        );
      }
      return {
        curve: new THREE.CatmullRomCurve3(pts, true),
        speed: cfg.speed,
        phase: cfg.phase,
        color: isPremium ? '#fbbf24' : cfg.color,
      };
    });
  }, [shuttleCount, isPremium]);

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    flightPaths.forEach((fp, idx) => {
      const grp = shuttlesRef.current[idx];
      if (!grp) return;
      const rawU = (t * fp.speed + fp.phase * 0.17) % 1;
      const u = rawU < 0 ? rawU + 1 : rawU;
      fp.curve.getPointAt(u, _shuttlePos);
      fp.curve.getTangentAt(u, _shuttleTangent);
      if (fp.speed < 0) _shuttleTangent.negate();

      grp.position.copy(_shuttlePos);
      _shuttleLookAt.copy(_shuttlePos).add(_shuttleTangent);
      grp.lookAt(_shuttleLookAt);
      grp.rotateZ(Math.sin(t * 1.4 + fp.phase) * 0.16);
    });
  });

  return (
    <group name="AutonomousDataShuttles">
      {flightPaths.map((fp, idx) => (
        <group
          key={idx}
          ref={(el) => {
            shuttlesRef.current[idx] = el;
          }}
        >
          {/* Sleek Fuselage */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.16, 0.72, 6]} />
            <meshStandardMaterial
              color={isDay ? '#f1f5f9' : '#cbd5e1'}
              metalness={0.6}
              roughness={0.25}
            />
          </mesh>
          {/* Swept Wings */}
          <mesh position={[0, 0, -0.06]}>
            <boxGeometry args={[0.92, 0.04, 0.24]} />
            <meshStandardMaterial
              color={fp.color}
              emissive={fp.color}
              emissiveIntensity={isDay ? 0.65 : 1.35}
            />
          </mesh>
          {/* Thruster Glow Core */}
          <mesh position={[0, 0, -0.36]}>
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial color="#ffffff" emissive={fp.color} emissiveIntensity={2.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * Central landmark monument per city architectural style.
 * Renders an animated holographic blueprint when city is disconnected,
 * and multi-ring kinetic spires with sky-beams & orbiting drones when active.
 */
function CityLandmarkSpire({
  config,
  isActive,
  isDisconnected,
  isError,
  isWarning,
  isDay,
  reducedMotion,
}: {
  config: CityArchitectureConfig;
  isActive: boolean;
  isDisconnected: boolean;
  isError: boolean;
  isWarning: boolean;
  isDay: boolean;
  reducedMotion: boolean;
}) {
  const rotorRef = useRef<THREE.Group | null>(null);
  const secondaryRotorRef = useRef<THREE.Group | null>(null);
  const blueprintRingRef = useRef<THREE.Mesh | null>(null);
  const coreBobRef = useRef<THREE.Mesh | null>(null);

  const glowColor = isError
    ? '#f43f5e'
    : isWarning
      ? '#f59e0b'
      : isActive
        ? config.accentHex
        : '#64748b';

  const glowStrength = isError || isWarning ? 1.55 : isActive ? (isDay ? 0.95 : 1.9) : 0;

  useFrame((state, delta) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    if (isDisconnected) {
      if (blueprintRingRef.current) {
        blueprintRingRef.current.rotation.z += delta * 0.45;
        blueprintRingRef.current.position.y = 1.3 + Math.sin(t * 1.4) * 0.45;
      }
      return;
    }

    const speed = isActive ? 0.78 : 0.22;
    if (rotorRef.current) {
      rotorRef.current.rotation.y += delta * speed;
    }
    if (secondaryRotorRef.current) {
      secondaryRotorRef.current.rotation.y -= delta * speed * 1.25;
      secondaryRotorRef.current.rotation.z = Math.sin(t * 0.9) * 0.22;
    }
    if (coreBobRef.current) {
      coreBobRef.current.position.y = 3.05 + Math.sin(t * 2.1) * 0.14;
      coreBobRef.current.rotation.y += delta * 1.1;
    }
  });

  if (isDisconnected) {
    const bpColor = isDay ? '#64748b' : '#475569';
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.42, 0.72, 2.2, 6]} />
          <meshStandardMaterial
            color={isDay ? '#94a3b8' : '#334155'}
            roughness={0.85}
            transparent
            opacity={0.3}
          />
        </mesh>
        <mesh position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.44, 0.74, 2.24, 6]} />
          <meshBasicMaterial color={bpColor} wireframe transparent opacity={0.52} />
        </mesh>
        {/* Animated Holographic Blueprint Scan Ring */}
        <mesh ref={blueprintRingRef} rotation={[Math.PI / 2, 0, 0]} position={[0, 1.3, 0]}>
          <torusGeometry args={[0.92, 0.032, 6, 24]} />
          <meshBasicMaterial
            color={config.accentHex}
            transparent
            opacity={isDay ? 0.42 : 0.38}
          />
        </mesh>
      </group>
    );
  }

  const warningBeacon =
    isWarning || isError ? (
      <mesh position={[0, 4.05, 0]}>
        <coneGeometry args={[0.38, 0.68, 3]} />
        <meshStandardMaterial
          color={isError ? '#f43f5e' : '#f59e0b'}
          emissive={isError ? '#f43f5e' : '#f59e0b'}
          emissiveIntensity={1.65}
        />
      </mesh>
    ) : null;

  const skyBeam = isActive ? (
    <mesh position={[0, 4.6, 0]}>
      <cylinderGeometry args={[0.04, 0.22, 6.4, 8, 1, true]} />
      <meshBasicMaterial
        color={glowColor}
        transparent
        opacity={isDay ? 0.14 : 0.22}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  ) : null;

  if (config.architectureStyle === 'crystalline') {
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 1.55, 0]} castShadow>
          <octahedronGeometry args={[0.82, 0]} />
          <meshPhysicalMaterial
            color={config.stoneHexDay}
            metalness={0.35}
            roughness={0.18}
            clearcoat={0.75}
          />
        </mesh>
        <group ref={rotorRef} position={[0, 2.2, 0]}>
          <mesh rotation={[Math.PI / 2.6, 0, 0]}>
            <torusGeometry args={[1.18, 0.048, 10, 32]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
          {[0, 1].map((i) => (
            <mesh key={i} position={[i === 0 ? 1.18 : -1.18, 0, 0]}>
              <octahedronGeometry args={[0.16, 0]} />
              <meshStandardMaterial color="#ffffff" emissive={glowColor} emissiveIntensity={2.0} />
            </mesh>
          ))}
        </group>
        <group ref={secondaryRotorRef} position={[0, 1.55, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.48, 0.032, 8, 32]} />
            <meshStandardMaterial color={config.secondaryHex} emissive={config.secondaryHex} emissiveIntensity={glowStrength * 0.85} />
          </mesh>
        </group>
        <mesh ref={coreBobRef} position={[0, 3.05, 0]}>
          <octahedronGeometry args={[0.32, 0]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
        </mesh>
        {skyBeam}
        {warningBeacon}
      </group>
    );
  }

  if (config.architectureStyle === 'geodesic') {
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 0.78, 0]} castShadow>
          <cylinderGeometry args={[1.04, 1.28, 0.62, 6]} />
          <meshStandardMaterial color={isDay ? '#d1fae5' : '#0f2d2c'} roughness={0.45} metalness={0.3} />
        </mesh>
        <mesh position={[0, 1.55, 0]} castShadow>
          <icosahedronGeometry args={[0.88, 1]} />
          <meshPhysicalMaterial
            color={isDay ? '#ecfdf5' : '#134e4a'}
            metalness={0.4}
            roughness={0.22}
            clearcoat={0.6}
          />
        </mesh>
        <group ref={rotorRef} position={[0, 1.6, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.22, 0.05, 10, 6]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
        </group>
        <group ref={secondaryRotorRef} position={[0, 2.35, 0]}>
          <mesh rotation={[Math.PI / 2.4, 0.4, 0]}>
            <torusGeometry args={[0.92, 0.035, 8, 24]} />
            <meshStandardMaterial color={config.secondaryHex} emissive={config.secondaryHex} emissiveIntensity={glowStrength * 0.9} />
          </mesh>
        </group>
        <mesh ref={coreBobRef} position={[0, 3.05, 0]}>
          <octahedronGeometry args={[0.28, 0]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
        </mesh>
        {skyBeam}
        {warningBeacon}
      </group>
    );
  }

  if (config.architectureStyle === 'ziggurat') {
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.0, 0.6, 2.0]} />
          <meshStandardMaterial color={isDay ? '#e7d5bc' : '#33251d'} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.92, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.38, 0.56, 1.38]} />
          <meshStandardMaterial color={isDay ? '#d6be9c' : '#422e22'} roughness={0.65} />
        </mesh>
        <mesh position={[0, 1.58, 0]} castShadow>
          <cylinderGeometry args={[0.25, 0.52, 0.95, 8]} />
          <meshStandardMaterial color={isDay ? '#b45309' : '#78350f'} roughness={0.45} metalness={0.4} />
        </mesh>
        <group ref={rotorRef} position={[0, 2.48, 0]}>
          <mesh rotation={[Math.PI / 3, 0, 0]}>
            <torusGeometry args={[0.72, 0.045, 8, 24]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
        </group>
        <group ref={secondaryRotorRef} position={[0, 1.85, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.15, 0.032, 8, 24]} />
            <meshStandardMaterial color={config.secondaryHex} emissive={config.secondaryHex} emissiveIntensity={glowStrength * 0.8} />
          </mesh>
        </group>
        <mesh ref={coreBobRef} position={[0, 3.05, 0]}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
        </mesh>
        {skyBeam}
        {warningBeacon}
      </group>
    );
  }

  // Turbine / Network Citadel
  return (
    <group position={[0, 0.25, 0]}>
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.45, 0.88, 2.2, 8]} />
        <meshStandardMaterial color={isDay ? '#334155' : '#181824'} metalness={0.65} roughness={0.28} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.78, 1.0, Math.sin(a) * 0.78]}
            rotation={[0, -a, -0.22]}
            castShadow
          >
            <boxGeometry args={[0.18, 1.65, 0.42]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength * 0.72} />
          </mesh>
        );
      })}
      <group ref={rotorRef} position={[0, 2.25, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.05, 0.042, 8, 28]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
        </mesh>
      </group>
      <group ref={secondaryRotorRef} position={[0, 1.45, 0]}>
        <mesh rotation={[Math.PI / 2.5, 0, 0]}>
          <torusGeometry args={[1.32, 0.03, 8, 28]} />
          <meshStandardMaterial color={config.secondaryHex} emissive={config.secondaryHex} emissiveIntensity={glowStrength * 0.85} />
        </mesh>
      </group>
      <mesh ref={coreBobRef} position={[0, 3.05, 0]}>
        <octahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
      </mesh>
      {skyBeam}
      {warningBeacon}
    </group>
  );
}

/**
 * Individual AI Model Building inside a Provider City with breathing window illumination,
 * rotating rooftop crystal + halo ring, upward data sparks, and blueprint wireframes.
 */
function ModelBuildingMesh({
  building,
  cityConfig,
  isSelected,
  isDay,
  showLabel,
  reducedMotion,
  qualityTier,
  onSelect,
}: {
  building: CityModelBuildingData;
  cityConfig: CityArchitectureConfig;
  isSelected: boolean;
  isDay: boolean;
  showLabel: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'balanced' | 'lite';
  onSelect: (b: CityModelBuildingData) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const beaconRef = useRef<THREE.Mesh | null>(null);
  const haloRef = useRef<THREE.Mesh | null>(null);
  const scanRingRef = useRef<THREE.Mesh | null>(null);
  const scanRingBRef = useRef<THREE.Mesh | null>(null);
  const towerMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const dataSparksRef = useRef<THREE.InstancedMesh | null>(null);

  const isOperational = building.status === 'operational';
  const isDisconnected = building.status === 'disconnected';
  const isError = building.status === 'error';
  const isWarning = building.status === 'warning';
  const isConnecting = building.status === 'connecting';

  const statusColor = isError
    ? '#f43f5e'
    : isWarning
      ? '#f59e0b'
      : isConnecting
        ? '#38bdf8'
        : isOperational
          ? cityConfig.accentHex
          : '#475569';

  const windowTex = useMemo(
    () =>
      createArchitecturalWindowTexture(
        statusColor,
        isOperational ? 0.9 : isWarning || isError ? 0.45 : 0.06,
        building.variant,
      ),
    [statusColor, isOperational, isWarning, isError, building.variant],
  );

  useEffect(() => () => windowTex.dispose(), [windowTex]);

  const towerHeight = 1.85 * building.heightScale;

  const baseEmissive =
    isOperational
      ? isDay
        ? 0.58
        : 1.35
      : isWarning || isError
        ? 0.9
        : isConnecting
          ? 1.1
          : 0;

  useFrame((state, delta) => {
    if (reducedMotion || isDisconnected) return;
    const t = state.clock.elapsedTime;
    const phase = building.buildingNumber * 0.72;

    if (beaconRef.current) {
      beaconRef.current.rotation.y += delta * (isOperational ? 1.65 : 0.45);
      beaconRef.current.position.y = towerHeight + 0.64 + Math.sin(t * 2.4 + phase) * 0.08;
    }
    if (haloRef.current) {
      haloRef.current.rotation.z += delta * 1.1;
      haloRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 1.3 + phase) * 0.25;
    }
    if (towerMatRef.current && isOperational) {
      towerMatRef.current.emissiveIntensity =
        baseEmissive * (0.9 + Math.sin(t * 1.9 + phase) * 0.14);
    }
    if (scanRingRef.current && isConnecting) {
      scanRingRef.current.position.y = 0.32 + ((t * 1.6) % towerHeight);
    }
    if (scanRingBRef.current && isConnecting) {
      scanRingBRef.current.position.y =
        0.32 + towerHeight - ((t * 1.6) % towerHeight);
    }
    if (dataSparksRef.current && isOperational && qualityTier !== 'lite') {
      for (let i = 0; i < 3; i += 1) {
        const progress = ((t * 0.65 + phase + i * 0.333) % 1);
        const a = t * 1.8 + i * ((Math.PI * 2) / 3) + phase;
        const r = 0.66 - progress * 0.12;
        _sparkDummy.position.set(
          Math.cos(a) * r,
          0.32 + progress * (towerHeight + 0.3),
          Math.sin(a) * r,
        );
        const s = Math.sin(progress * Math.PI) * 1.05;
        _sparkDummy.scale.setScalar(Math.max(0.01, s));
        _sparkDummy.updateMatrix();
        dataSparksRef.current.setMatrixAt(i, _sparkDummy.matrix);
      }
      dataSparksRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  const bodyColor = isDay
    ? isDisconnected
      ? '#94a3b8'
      : '#e2e8f0'
    : isDisconnected
      ? '#1e293b'
      : '#26334d';

  return (
    <group
      position={building.localOffset}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(building);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'default';
      }}
    >
      {/* Stepped Foundation Plinth */}
      <mesh position={[0, 0.14, 0]} castShadow={!isDisconnected} receiveShadow>
        <cylinderGeometry args={[0.64, 0.78, 0.28, building.variant === 1 ? 6 : 8]} />
        <meshStandardMaterial
          color={isDay ? '#cbd5e1' : '#1e293b'}
          roughness={0.68}
          metalness={isDisconnected ? 0.1 : 0.25}
          transparent={isDisconnected}
          opacity={isDisconnected ? 0.45 : 1}
        />
      </mesh>

      {/* Main Architectural Tower Shaft */}
      <mesh position={[0, 0.28 + towerHeight * 0.5, 0]} castShadow={!isDisconnected} receiveShadow>
        {building.variant === 0 ? (
          <cylinderGeometry args={[0.42, 0.54, towerHeight, 8]} />
        ) : building.variant === 1 ? (
          <boxGeometry args={[0.82, towerHeight, 0.82]} />
        ) : (
          <cylinderGeometry args={[0.34, 0.56, towerHeight, 6]} />
        )}
        <meshStandardMaterial
          ref={towerMatRef}
          color={bodyColor}
          map={isDisconnected ? null : windowTex}
          emissive={statusColor}
          emissiveMap={isDisconnected ? null : windowTex}
          emissiveIntensity={baseEmissive}
          roughness={isDisconnected ? 0.85 : 0.34}
          metalness={isDisconnected ? 0.1 : 0.42}
          transparent={isDisconnected}
          opacity={isDisconnected ? 0.36 : 1}
        />
      </mesh>

      {/* Wireframe Blueprint Overlay for Disconnected Cities */}
      {isDisconnected && (
        <mesh position={[0, 0.28 + towerHeight * 0.5, 0]}>
          {building.variant === 0 ? (
            <cylinderGeometry args={[0.43, 0.55, towerHeight + 0.02, 8]} />
          ) : building.variant === 1 ? (
            <boxGeometry args={[0.84, towerHeight + 0.02, 0.84]} />
          ) : (
            <cylinderGeometry args={[0.35, 0.57, towerHeight + 0.02, 6]} />
          )}
          <meshBasicMaterial
            color={isDay ? '#64748b' : '#475569'}
            wireframe
            transparent
            opacity={0.46}
          />
        </mesh>
      )}

      {/* Roof Crown Collar, Rotating Halo & Floating Crystal */}
      {!isDisconnected && (
        <>
          <mesh position={[0, 0.28 + towerHeight, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.43, 0.16, 8]} />
            <meshStandardMaterial
              color={statusColor}
              emissive={statusColor}
              emissiveIntensity={isOperational ? 0.85 : 0.25}
              roughness={0.3}
              metalness={0.5}
            />
          </mesh>

          <mesh ref={beaconRef} position={[0, towerHeight + 0.64, 0]}>
            <octahedronGeometry args={[0.19, 0]} />
            <meshStandardMaterial
              color={statusColor}
              emissive={statusColor}
              emissiveIntensity={isOperational ? 1.95 : 1.5}
            />
          </mesh>

          {isOperational && (
            <mesh ref={haloRef} position={[0, towerHeight + 0.64, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.34, 0.022, 6, 18]} />
              <meshBasicMaterial color={statusColor} transparent opacity={0.85} />
            </mesh>
          )}
        </>
      )}

      {/* Upward Rising Holographic Data Sparks around Operational Towers */}
      {isOperational && qualityTier !== 'lite' && (
        <instancedMesh ref={dataSparksRef} args={[undefined, undefined, 3]}>
          <octahedronGeometry args={[0.07, 0]} />
          <meshBasicMaterial color={statusColor} />
        </instancedMesh>
      )}

      {/* Dual Counter-Moving Connecting Scan Rings */}
      {isConnecting && (
        <>
          <mesh ref={scanRingRef} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.8, 0]}>
            <torusGeometry args={[0.68, 0.036, 8, 24]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
          <mesh ref={scanRingBRef} rotation={[Math.PI / 2, 0, 0]} position={[0, 1.4, 0]}>
            <torusGeometry args={[0.62, 0.028, 8, 24]} />
            <meshBasicMaterial color="#7dd3fc" />
          </mesh>
        </>
      )}

      {/* Selected or Hovered Highlight Ring */}
      {(isSelected || hovered) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.92, 1.08, 32]} />
          <meshBasicMaterial color={isSelected ? '#38bdf8' : statusColor} side={THREE.DoubleSide} />
        </mesh>
      )}

      {showLabel && (
        <ProjectedHtml
          position={[0, towerHeight + 1.08, 0]}
          center
          distanceFactor={14}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={`px-2 py-0.5 rounded-md text-center whitespace-nowrap border transition-transform ${
              isSelected
                ? 'bg-blue-950/95 border-blue-400 text-white scale-105'
                : hovered
                  ? 'bg-[#090E1A]/95 border-slate-500 text-slate-100 scale-105'
                  : isDisconnected
                    ? 'bg-[#090E1A]/80 border-slate-700/60 text-slate-300'
                    : 'bg-[#090E1A]/88 border-slate-700/80 text-slate-100'
            }`}
          >
            <div className="text-[10px] font-display font-semibold flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: statusColor }}
              />
              {building.displayName}
            </div>
            {(hovered || isSelected) && (
              <div className="text-[9px] text-slate-300 mt-0.5">
                Bldg {building.buildingNumber} · {building.statusLabel}
              </div>
            )}
          </div>
        </ProjectedHtml>
      )}
    </group>
  );
}

/**
 * Segmented rotating dashed perimeter ring rendered around disconnected islands.
 */
function DisconnectedDashedRing({
  radius,
  isDay,
  reducedMotion,
}: {
  radius: number;
  isDay: boolean;
  reducedMotion: boolean;
}) {
  const ringRef = useRef<THREE.Group | null>(null);
  const segments = 22;
  const dashColor = isDay ? '#64748b' : '#475569';

  useFrame((_, delta) => {
    if (reducedMotion || !ringRef.current) return;
    ringRef.current.rotation.y += delta * 0.08;
  });

  return (
    <group ref={ringRef} position={[0, 0.25, 0]}>
      {Array.from({ length: segments }).map((_, i) => {
        const angle = (i / segments) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
            rotation={[0, -angle + Math.PI / 2, 0]}
          >
            <boxGeometry args={[0.58, 0.05, 0.12]} />
            <meshBasicMaterial color={dashColor} transparent opacity={0.68} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Complete Provider Island + Boulevard Roads + Shoreline Wake + Landmark + Model Buildings.
 */
function ProviderCityIsland({
  district,
  level,
  isSelectedCity,
  selectedBuildingId,
  isDay,
  showLabels,
  reducedMotion,
  qualityTier,
  onSelectCity,
  onSelectBuilding,
}: {
  district: CityDistrictData;
  level: ModelLandLevel;
  isSelectedCity: boolean;
  selectedBuildingId: string | null;
  isDay: boolean;
  showLabels: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'balanced' | 'lite';
  onSelectCity: (pid: ProviderId) => void;
  onSelectBuilding: (b: CityModelBuildingData) => void;
}) {
  const { config, status, statusLabel, buildings } = district;
  const wakeRingRef = useRef<THREE.Mesh | null>(null);
  const wakeMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const isActive = status === 'operational' || status === 'connecting';
  const isDisconnected = status === 'disconnected';
  const isError = status === 'error';
  const isWarning = status === 'warning';

  const islandBaseColor = isDisconnected
    ? isDay
      ? '#cbd5e1'
      : '#0f172a'
    : isDay
      ? config.stoneHexDay
      : config.stoneHexNight;
  const coastRingColor = isDisconnected
    ? isDay
      ? '#94a3b8'
      : '#111827'
    : isDay
      ? '#d4c8a8'
      : '#1e293b';
  const roadRingColor = isError
    ? '#f43f5e'
    : isWarning
      ? '#f59e0b'
      : isActive
        ? config.accentHex
        : '#475569';

  const showBuildingLabels =
    showLabels && (level === 'building' || (level === 'city' && isSelectedCity));

  useFrame((state) => {
    if (reducedMotion || isDisconnected || !wakeRingRef.current || !wakeMatRef.current) return;
    const t = state.clock.elapsedTime;
    const phase = (t * 0.42 + config.position[0] * 0.13 + config.position[2] * 0.09) % 1;
    const normalized = phase < 0 ? phase + 1 : phase;
    const scale = 1 + normalized * 0.16;
    wakeRingRef.current.scale.set(scale, scale, 1);
    wakeMatRef.current.opacity = (1 - normalized) * (isDay ? 0.32 : 0.45);
  });

  return (
    <group position={config.position} name={`City_${config.providerId}`}>
      {/* Animated Shoreline Wake Ring on Active Islands */}
      {!isDisconnected && (
        <mesh ref={wakeRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.26, 0]}>
          <ringGeometry args={[config.islandRadius + 0.72, config.islandRadius + 0.94, 42]} />
          <meshBasicMaterial
            ref={wakeMatRef}
            color={roadRingColor}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Island Base Shelf & Shoreline */}
      <mesh
        position={[0, -0.32, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelectCity(config.providerId);
        }}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
        }}
      >
        <cylinderGeometry args={[config.islandRadius, config.islandRadius + 0.85, 0.72, 32]} />
        <meshStandardMaterial
          color={coastRingColor}
          roughness={0.88}
          transparent={isDisconnected}
          opacity={isDisconnected ? 0.65 : 1}
        />
      </mesh>

      {/* Main City Platform */}
      <mesh
        position={[0, 0.08, 0]}
        receiveShadow
        castShadow={!isDisconnected}
        onClick={(e) => {
          e.stopPropagation();
          onSelectCity(config.providerId);
        }}
      >
        <cylinderGeometry args={[config.islandRadius - 0.35, config.islandRadius - 0.08, 0.25, 32]} />
        <meshStandardMaterial
          color={islandBaseColor}
          roughness={isDisconnected ? 0.9 : 0.62}
          metalness={isDisconnected ? 0.04 : 0.14}
          transparent={isDisconnected}
          opacity={isDisconnected ? 0.62 : 1}
        />
      </mesh>

      {/* Cardinal Harbor Pylons for Active Islands */}
      {!isDisconnected &&
        [0, 1, 2, 3].map((i) => {
          const a = (i * Math.PI) / 2 + Math.PI / 4;
          const r = config.islandRadius - 0.28;
          return (
            <group key={i} position={[Math.cos(a) * r, 0.22, Math.sin(a) * r]}>
              <mesh position={[0, 0.16, 0]}>
                <cylinderGeometry args={[0.08, 0.12, 0.32, 6]} />
                <meshStandardMaterial color={isDay ? '#cbd5e1' : '#334155'} metalness={0.5} roughness={0.4} />
              </mesh>
              <mesh position={[0, 0.36, 0]}>
                <sphereGeometry args={[0.08, 6, 6]} />
                <meshStandardMaterial
                  color={roadRingColor}
                  emissive={roadRingColor}
                  emissiveIntensity={1.6}
                />
              </mesh>
            </group>
          );
        })}

      {/* Illuminated Boulevard Ring vs Animated Dashed Offline Perimeter */}
      {isDisconnected ? (
        <DisconnectedDashedRing
          radius={config.islandRadius - 0.18}
          isDay={isDay}
          reducedMotion={reducedMotion}
        />
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 0]}>
          <ringGeometry args={[2.35, 2.62, 42]} />
          <meshStandardMaterial
            color={roadRingColor}
            emissive={roadRingColor}
            emissiveIntensity={isActive ? (isDay ? 0.35 : 1.15) : 0.75}
          />
        </mesh>
      )}

      {/* Selected City Outer Selection Ring */}
      {isSelectedCity && level !== 'world' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.23, 0]}>
          <ringGeometry args={[config.islandRadius - 0.25, config.islandRadius - 0.05, 42]} />
          <meshBasicMaterial color={isDisconnected ? '#94a3b8' : config.accentHex} />
        </mesh>
      )}

      {/* Central Landmark Spire */}
      <group
        onClick={(e) => {
          e.stopPropagation();
          onSelectCity(config.providerId);
        }}
      >
        <CityLandmarkSpire
          config={config}
          isActive={isActive}
          isDisconnected={isDisconnected}
          isError={isError}
          isWarning={isWarning}
          isDay={isDay}
          reducedMotion={reducedMotion}
        />
      </group>

      {/* Individual Model Buildings */}
      {buildings.map((b) => (
        <ModelBuildingMesh
          key={b.id}
          building={b}
          cityConfig={config}
          isSelected={selectedBuildingId === b.id}
          isDay={isDay}
          showLabel={showBuildingLabels}
          reducedMotion={reducedMotion}
          qualityTier={qualityTier}
          onSelect={onSelectBuilding}
        />
      ))}

      {/* World-Level City Banner */}
      {showLabels && level === 'world' && (
        <ProjectedHtml
          position={[0, 4.0, 0]}
          center
          distanceFactor={42}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={`px-2 py-1 rounded-lg border text-center whitespace-nowrap shadow-md ${
              isDisconnected
                ? 'bg-[#090E1A]/80 border-slate-700/60 text-slate-300'
                : 'bg-[#090E1A]/92 border-slate-600/80 text-slate-100'
            }`}
          >
            <div className="text-[11px] font-display font-bold flex items-center justify-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                style={{ backgroundColor: isDisconnected ? '#64748b' : roadRingColor }}
              />
              {config.cityName}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              {isDisconnected
                ? 'Disconnected'
                : `${statusLabel} · ${district.operationalModelsCount || buildings.length}`}
            </div>
          </div>
        </ProjectedHtml>
      )}
    </group>
  );
}

/**
 * Multi-tiered Central Council Hub + Multi-Packet Bidirectional Energy Routes
 * connecting provider cities across the archipelago.
 */
function InterCityEnergyRoutes({
  districts,
  isDay,
  showLabels,
  level,
  reducedMotion,
}: {
  districts: CityDistrictData[];
  isDay: boolean;
  showLabels: boolean;
  level: ModelLandLevel;
  reducedMotion: boolean;
}) {
  const pulseOrbsRef = useRef<Array<THREE.Mesh | null>>([]);
  const hubRingARef = useRef<THREE.Mesh | null>(null);
  const hubRingBRef = useRef<THREE.Mesh | null>(null);
  const hubCrystalRef = useRef<THREE.Mesh | null>(null);

  const routes = useMemo(() => {
    const center = new THREE.Vector3(0, 0.55, 0);
    return districts.map((d) => {
      const p = d.config.position;
      const end = new THREE.Vector3(p[0], 0.45, p[2]);
      const mid = new THREE.Vector3(p[0] * 0.5, 1.75, p[2] * 0.5);
      const curve = new THREE.QuadraticBezierCurve3(center, mid, end);
      const isDisconnected = d.status === 'disconnected';
      const dashPoints: Array<[number, number, number]> = [];
      if (isDisconnected) {
        const dashCount = 10;
        for (let i = 1; i < dashCount; i += 1) {
          const pt = curve.getPoint(i / dashCount);
          dashPoints.push([pt.x, pt.y, pt.z]);
        }
      }
      const tubeGeo = isDisconnected ? null : new THREE.TubeGeometry(curve, 24, 0.068, 6, false);
      return {
        providerId: d.config.providerId,
        curve,
        geo: tubeGeo,
        dashPoints,
        midPoint: [mid.x, mid.y * 0.85, mid.z] as [number, number, number],
        active: d.status === 'operational' || d.status === 'connecting',
        disconnected: isDisconnected,
        warning: d.status === 'warning',
        error: d.status === 'error',
        color: d.config.accentHex,
      };
    });
  }, [districts]);

  useEffect(() => {
    return () => {
      routes.forEach((r) => r.geo?.dispose());
    };
  }, [routes]);

  useFrame((state, delta) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;

    if (hubRingARef.current) {
      hubRingARef.current.rotation.z += delta * 0.75;
      hubRingARef.current.rotation.x = Math.PI / 2.6 + Math.sin(t * 0.8) * 0.16;
    }
    if (hubRingBRef.current) {
      hubRingBRef.current.rotation.z -= delta * 0.52;
      hubRingBRef.current.rotation.y = Math.cos(t * 0.65) * 0.24;
    }
    if (hubCrystalRef.current) {
      hubCrystalRef.current.rotation.y += delta * 1.25;
      hubCrystalRef.current.position.y = 1.65 + Math.sin(t * 2.1) * 0.14;
    }

    // 3 staggered bidirectional energy packets per active route
    routes.forEach((r, idx) => {
      if (!r.active) return;
      for (let pIdx = 0; pIdx < 3; pIdx += 1) {
        const orb = pulseOrbsRef.current[idx * 3 + pIdx];
        if (!orb) continue;
        const rawPhase = (t * 0.42 + idx * 0.17 + pIdx * 0.333) % 1;
        const u = pIdx === 1 ? rawPhase : 1 - rawPhase;
        r.curve.getPoint(u, _routeOrbPos);
        orb.position.copy(_routeOrbPos);
        const s = 0.85 + Math.sin(t * 5 + pIdx * 2.1) * 0.22;
        orb.scale.setScalar(s);
      }
    });
  });

  return (
    <group name="EnergyRoutes">
      {/* Multi-Tiered Central Council Hub Observatory */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[2.25, 2.8, 0.68, 16]} />
        <meshStandardMaterial color={isDay ? '#cbd5e1' : '#141d36'} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.25, 0]}>
        <ringGeometry args={[1.52, 1.78, 36]} />
        <meshStandardMaterial color="#8b5cf6" emissive="#7c3aed" emissiveIntensity={1.25} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.92, 1.25, 0.58, 8]} />
        <meshStandardMaterial color={isDay ? '#e2e8f0' : '#1e293b'} roughness={0.35} metalness={0.55} />
      </mesh>

      {/* 4 Cardinal Hub Pylons */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.48, 0.65, Math.sin(a) * 1.48]}>
            <cylinderGeometry args={[0.08, 0.14, 0.85, 6]} />
            <meshStandardMaterial color="#8b5cf6" emissive="#38bdf8" emissiveIntensity={0.85} />
          </mesh>
        );
      })}

      {/* Counter-Rotating Hub Gyroscope Rings */}
      <mesh ref={hubRingARef} position={[0, 1.65, 0]}>
        <torusGeometry args={[1.32, 0.045, 10, 36]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.45} />
      </mesh>
      <mesh ref={hubRingBRef} position={[0, 1.65, 0]} rotation={[Math.PI / 2.9, 0.5, 0]}>
        <torusGeometry args={[1.65, 0.036, 10, 36]} />
        <meshStandardMaterial color="#a78bfa" emissive="#8b5cf6" emissiveIntensity={1.35} />
      </mesh>

      {/* Levitating Hub Core Crystal + Sky Beacon */}
      <mesh ref={hubCrystalRef} position={[0, 1.65, 0]}>
        <octahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color="#8b5cf6" emissive="#38bdf8" emissiveIntensity={1.9} />
      </mesh>
      <mesh position={[0, 5.5, 0]}>
        <cylinderGeometry args={[0.06, 0.34, 7.6, 10, 1, true]} />
        <meshBasicMaterial
          color="#8b5cf6"
          transparent
          opacity={isDay ? 0.14 : 0.24}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {showLabels && level === 'world' && (
        <ProjectedHtml position={[0, 2.75, 0]} center distanceFactor={40} style={{ pointerEvents: 'none' }}>
          <div className="px-2.5 py-0.5 rounded-full bg-[#13112B]/90 border border-violet-400/50 text-[10px] font-display font-bold text-violet-200 whitespace-nowrap shadow">
            Council Hub
          </div>
        </ProjectedHtml>
      )}

      {routes.map((r, idx) => {
        if (r.disconnected) {
          return (
            <group key={r.providerId}>
              {r.dashPoints.map((pt, dIdx) => (
                <mesh key={dIdx} position={pt}>
                  <sphereGeometry args={[0.095, 6, 6]} />
                  <meshBasicMaterial
                    color={isDay ? '#64748b' : '#475569'}
                    transparent
                    opacity={0.5}
                  />
                </mesh>
              ))}
            </group>
          );
        }

        const col = r.error ? '#f43f5e' : r.warning ? '#f59e0b' : r.color;
        return (
          <group key={r.providerId}>
            {r.geo && (
              <mesh geometry={r.geo}>
                <meshStandardMaterial
                  color={col}
                  emissive={col}
                  emissiveIntensity={r.active ? (isDay ? 0.55 : 1.4) : 0.85}
                  transparent
                  opacity={r.active ? 0.9 : 0.55}
                />
              </mesh>
            )}
            {r.active &&
              [0, 1, 2].map((pIdx) => (
                <mesh
                  key={pIdx}
                  ref={(el) => {
                    pulseOrbsRef.current[idx * 3 + pIdx] = el;
                  }}
                >
                  <sphereGeometry args={[pIdx === 0 ? 0.17 : 0.125, 10, 10]} />
                  <meshStandardMaterial color="#ffffff" emissive={col} emissiveIntensity={2.15} />
                </mesh>
              ))}
            {(r.warning || r.error) && (
              <mesh position={r.midPoint}>
                <octahedronGeometry args={[0.26, 0]} />
                <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.65} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function PremiumWorldAura({
  isDay,
  reducedMotion,
  qualityTier,
}: {
  isDay: boolean;
  reducedMotion: boolean;
  qualityTier: 'high' | 'balanced' | 'lite';
}) {
  const ringARef = useRef<THREE.Mesh | null>(null);
  const ringBRef = useRef<THREE.Mesh | null>(null);
  const crownRef = useRef<THREE.Mesh | null>(null);
  const crystalRef = useRef<THREE.Mesh | null>(null);
  const motesRef = useRef<THREE.Points | null>(null);
  const count = qualityTier === 'lite' ? 110 : 240;

  const motesGeo = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = i * 2.39996;
      const r = 4.5 + ((i * 23) % 28);
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = 2.6 + ((i * 17) % 34) * 0.28;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return geo;
  }, [count]);

  useEffect(() => () => motesGeo.dispose(), [motesGeo]);

  useFrame((state, delta) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    if (ringARef.current) {
      ringARef.current.rotation.z += delta * 0.55;
      ringARef.current.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.7) * 0.14;
    }
    if (ringBRef.current) {
      ringBRef.current.rotation.z -= delta * 0.42;
      ringBRef.current.rotation.y = Math.cos(t * 0.6) * 0.22;
    }
    if (crownRef.current) {
      crownRef.current.rotation.z += delta * 0.12;
    }
    if (crystalRef.current) {
      crystalRef.current.rotation.y += delta * 1.1;
      crystalRef.current.position.y = 2.45 + Math.sin(t * 1.8) * 0.16;
    }
    if (motesRef.current) {
      motesRef.current.rotation.y += delta * 0.045;
    }
  });

  return (
    <group name="PremiumWorldAura">
      <mesh ref={ringARef} position={[0, 1.7, 0]}>
        <torusGeometry args={[2.65, 0.052, 10, 48]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#f59e0b"
          emissiveIntensity={isDay ? 0.75 : 1.75}
        />
      </mesh>
      <mesh ref={ringBRef} position={[0, 1.7, 0]} rotation={[Math.PI / 2.8, 0.4, 0]}>
        <torusGeometry args={[3.25, 0.042, 10, 48]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={isDay ? 0.65 : 1.6}
        />
      </mesh>
      <mesh ref={crownRef} position={[0, 8.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[12.5, 0.055, 8, 64]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#f59e0b"
          emissiveIntensity={isDay ? 0.5 : 1.35}
          transparent
          opacity={0.55}
        />
      </mesh>
      <mesh ref={crystalRef} position={[0, 2.45, 0]}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial
          color="#fde68a"
          emissive="#fbbf24"
          emissiveIntensity={1.95}
        />
      </mesh>
      <points ref={motesRef} geometry={motesGeo}>
        <pointsMaterial
          color={isDay ? '#fde68a' : '#fcd34d'}
          size={0.21}
          transparent
          opacity={isDay ? 0.6 : 0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export function ModelLandWorld({
  districts,
  level,
  selectedCityId,
  selectedBuildingId,
  showLabels = true,
  isPremium = false,
  resetCameraSeq = 0,
  onSelectCity,
  onSelectBuilding,
}: ModelLandWorldProps) {
  const { isDay, reducedMotion, qualityTier } = useWorldTheme();
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const districtsRef = useRef(districts);
  districtsRef.current = districts;
  const aspect = size.width / Math.max(1, size.height);

  // Smooth GSAP camera orchestration across World -> City -> Building levels.
  // Uses districtsRef so background status/usage refreshes never hijack manual user orbiting.
  useEffect(() => {
    const list = districtsRef.current;
    const activeDistrict =
      list.find((d) => d.config.providerId === selectedCityId) || list[0];
    const activeBuilding =
      activeDistrict?.buildings.find((b) => b.id === selectedBuildingId) || null;

    const worldDist = Math.min(72, Math.max(36, 36 / Math.max(aspect, 0.54)));
    let camGoal: [number, number, number] = [0, worldDist * 0.54, worldDist * 0.8];
    let targetGoal: [number, number, number] = [0, 1.2, 0];

    if (level === 'city' && activeDistrict) {
      const [cx, cy, cz] = activeDistrict.config.position;
      const cityDist = Math.min(24, Math.max(11, 12.5 / Math.max(aspect, 0.5)));
      camGoal = [cx + 0.4, cy + cityDist * 0.62, cz + cityDist * 0.84];
      targetGoal = [cx, cy + 1.15, cz];
    } else if (level === 'building' && activeDistrict && activeBuilding) {
      const [cx, cy, cz] = activeDistrict.config.position;
      const [bx, by, bz] = activeBuilding.localOffset;
      const wx = cx + bx;
      const wy = cy + by;
      const wz = cz + bz;
      camGoal = [wx + 3.4, wy + 3.1, wz + 5.2];
      targetGoal = [wx, wy + 1.35, wz];
    }

    const duration = reducedMotion ? 0.05 : 1.05;
    gsap.killTweensOf(camera.position);
    gsap.to(camera.position, {
      x: camGoal[0],
      y: camGoal[1],
      z: camGoal[2],
      duration,
      ease: 'power3.inOut',
    });

    if (controlsRef.current) {
      gsap.killTweensOf(controlsRef.current.target);
      gsap.to(controlsRef.current.target, {
        x: targetGoal[0],
        y: targetGoal[1],
        z: targetGoal[2],
        duration,
        ease: 'power3.inOut',
      });
    }
  }, [level, selectedCityId, selectedBuildingId, camera, reducedMotion, aspect, resetCameraSeq]);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.055}
        minPolarAngle={0.22}
        maxPolarAngle={Math.PI * 0.44}
        minDistance={level === 'building' ? 3.5 : level === 'city' ? 6.5 : 16}
        maxDistance={level === 'building' ? 16 : level === 'city' ? 28 : 115}
        onStart={() => {
          gsap.killTweensOf(camera.position);
          if (controlsRef.current) {
            gsap.killTweensOf(controlsRef.current.target);
          }
        }}
      />

      <ArchipelagoOcean isDay={isDay} reducedMotion={reducedMotion} />

      <HorizonArchipelago
        isDay={isDay}
        reducedMotion={reducedMotion}
        qualityTier={qualityTier}
      />

      <OrbitalSanctuaryRing
        isDay={isDay}
        isPremium={isPremium}
        reducedMotion={reducedMotion}
        qualityTier={qualityTier}
      />

      <AutonomousDataShuttles
        isDay={isDay}
        isPremium={isPremium}
        reducedMotion={reducedMotion}
        qualityTier={qualityTier}
      />

      <InterCityEnergyRoutes
        districts={districts}
        isDay={isDay}
        showLabels={showLabels}
        level={level}
        reducedMotion={reducedMotion}
      />

      {isPremium && (
        <PremiumWorldAura
          isDay={isDay}
          reducedMotion={reducedMotion}
          qualityTier={qualityTier}
        />
      )}

      {districts.map((district) => (
        <ProviderCityIsland
          key={district.config.providerId}
          district={district}
          level={level}
          isSelectedCity={selectedCityId === district.config.providerId}
          selectedBuildingId={selectedBuildingId}
          isDay={isDay}
          showLabels={showLabels}
          reducedMotion={reducedMotion}
          qualityTier={qualityTier}
          onSelectCity={onSelectCity}
          onSelectBuilding={onSelectBuilding}
        />
      ))}
    </>
  );
}
