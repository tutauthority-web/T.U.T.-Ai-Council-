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

const _routeOrbPos = new THREE.Vector3();

/**
 * Expansive animated ocean surrounding the AI Model Land archipelago.
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
      uniforms.uHorizon.value.set('#b4e2fa');
      uniforms.uHighlight.value.set('#fff7d6');
    } else {
      uniforms.uDeep.value.set('#050d20');
      uniforms.uCrest.value.set('#102b5c');
      uniforms.uHorizon.value.set('#101d3b');
      uniforms.uHighlight.value.set('#7dd3fc');
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0]} receiveShadow>
      <planeGeometry args={[360, 360, 72, 72]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          varying vec3 vWorldPos;
          void main() {
            vec3 pos = position;
            float w1 = sin(pos.x * 0.14 + uTime * 1.1) * 0.12;
            float w2 = cos(pos.y * 0.18 - uTime * 0.9) * 0.10;
            pos.z += w1 + w2;
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
            float wave = sin(vWorldPos.x * 0.45 + uTime * 1.2) * cos(vWorldPos.z * 0.4 - uTime * 0.95);
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float fresnel = pow(max(0.0001, 1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0)), 3.2);
            float distFade = smoothstep(42.0, 155.0, length(vWorldPos.xz));

            vec3 col = mix(uDeep, uCrest, wave * 0.35 + 0.42);
            col = mix(col, uHorizon, clamp(fresnel * 0.65 + distFade * 0.7, 0.0, 1.0));

            float glint = pow(max(0.0001, wave), 8.0);
            col += uHighlight * glint * 0.25;

            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/**
 * Central landmark monument per city architectural style.
 * Renders muted wireframe silhouette when city is disconnected.
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

  const glowColor = isError
    ? '#f43f5e'
    : isWarning
      ? '#f59e0b'
      : isActive
        ? config.accentHex
        : '#64748b';

  const glowStrength = isError || isWarning ? 1.45 : isActive ? (isDay ? 0.85 : 1.8) : 0;

  useFrame((_, delta) => {
    if (reducedMotion || !rotorRef.current || isDisconnected) return;
    const speed = isActive ? 0.65 : 0.18;
    rotorRef.current.rotation.y += delta * speed;
  });

  if (isDisconnected) {
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.42, 0.72, 2.2, 6]} />
          <meshStandardMaterial
            color={isDay ? '#94a3b8' : '#334155'}
            roughness={0.85}
            transparent
            opacity={0.34}
          />
        </mesh>
        <mesh position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.43, 0.73, 2.22, 6]} />
          <meshBasicMaterial
            color={isDay ? '#64748b' : '#475569'}
            wireframe
            transparent
            opacity={0.48}
          />
        </mesh>
      </group>
    );
  }

  const warningBeacon =
    isWarning || isError ? (
      <mesh position={[0, 3.65, 0]}>
        <coneGeometry args={[0.38, 0.68, 3]} />
        <meshStandardMaterial
          color={isError ? '#f43f5e' : '#f59e0b'}
          emissive={isError ? '#f43f5e' : '#f59e0b'}
          emissiveIntensity={1.65}
        />
      </mesh>
    ) : null;

  if (config.architectureStyle === 'crystalline') {
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 1.55, 0]} castShadow>
          <octahedronGeometry args={[0.78, 0]} />
          <meshPhysicalMaterial
            color={config.stoneHexDay}
            metalness={0.35}
            roughness={0.18}
            clearcoat={0.7}
          />
        </mesh>
        <group ref={rotorRef} position={[0, 2.35, 0]}>
          <mesh rotation={[Math.PI / 2.6, 0, 0]}>
            <torusGeometry args={[1.08, 0.045, 10, 32]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
          <mesh position={[0, 0.88, 0]}>
            <octahedronGeometry args={[0.32, 0]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
        </group>
        {warningBeacon}
      </group>
    );
  }

  if (config.architectureStyle === 'geodesic') {
    return (
      <group position={[0, 0.25, 0]}>
        <mesh position={[0, 0.8, 0]} castShadow>
          <cylinderGeometry args={[1.0, 1.25, 0.62, 6]} />
          <meshStandardMaterial color={isDay ? '#d1fae5' : '#0f2d2c'} roughness={0.45} metalness={0.3} />
        </mesh>
        <mesh position={[0, 1.55, 0]} castShadow>
          <icosahedronGeometry args={[0.85, 1]} />
          <meshPhysicalMaterial
            color={isDay ? '#ecfdf5' : '#134e4a'}
            metalness={0.4}
            roughness={0.22}
            clearcoat={0.6}
          />
        </mesh>
        <group ref={rotorRef} position={[0, 1.6, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.15, 0.05, 10, 6]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
        </group>
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
            <torusGeometry args={[0.65, 0.04, 8, 24]} />
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
          </mesh>
        </group>
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
            <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength * 0.7} />
          </mesh>
        );
      })}
      <group ref={rotorRef} position={[0, 2.68, 0]}>
        <mesh>
          <octahedronGeometry args={[0.38, 0]} />
          <meshStandardMaterial color={glowColor} emissive={glowColor} emissiveIntensity={glowStrength} />
        </mesh>
      </group>
      {warningBeacon}
    </group>
  );
}

/**
 * Individual AI Model Building inside a Provider City with status-reactive illumination
 * and muted wireframe blueprint style when provider is disconnected.
 */
function ModelBuildingMesh({
  building,
  cityConfig,
  isSelected,
  isDay,
  showLabel,
  reducedMotion,
  onSelect,
}: {
  building: CityModelBuildingData;
  cityConfig: CityArchitectureConfig;
  isSelected: boolean;
  isDay: boolean;
  showLabel: boolean;
  reducedMotion: boolean;
  onSelect: (b: CityModelBuildingData) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const beaconRef = useRef<THREE.Mesh | null>(null);
  const scanRingRef = useRef<THREE.Mesh | null>(null);

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
        isOperational ? 0.88 : isWarning || isError ? 0.45 : 0.06,
        building.variant,
      ),
    [statusColor, isOperational, isWarning, isError, building.variant],
  );

  useEffect(() => () => windowTex.dispose(), [windowTex]);

  const towerHeight = 1.85 * building.heightScale;

  useFrame((state, delta) => {
    if (reducedMotion || isDisconnected) return;
    const t = state.clock.elapsedTime;
    if (beaconRef.current) {
      beaconRef.current.rotation.y += delta * (isOperational ? 1.4 : 0.35);
      beaconRef.current.position.y =
        towerHeight + 0.62 + Math.sin(t * 2.2 + building.buildingNumber) * 0.06;
    }
    if (scanRingRef.current && isConnecting) {
      scanRingRef.current.position.y = 0.35 + ((t * 1.5) % towerHeight);
    }
  });

  const bodyColor = isDay
    ? isDisconnected
      ? '#94a3b8'
      : '#e2e8f0'
    : isDisconnected
      ? '#1e293b'
      : '#26334d';

  const emissiveIntensity =
    isOperational
      ? isDay
        ? 0.55
        : 1.3
      : isWarning || isError
        ? 0.9
        : isConnecting
          ? 1.05
          : 0;

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
          color={bodyColor}
          map={isDisconnected ? null : windowTex}
          emissive={statusColor}
          emissiveMap={isDisconnected ? null : windowTex}
          emissiveIntensity={emissiveIntensity}
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
            opacity={0.44}
          />
        </mesh>
      )}

      {/* Roof Crown Collar (hidden/muted when disconnected) */}
      {!isDisconnected && (
        <>
          <mesh position={[0, 0.28 + towerHeight, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.43, 0.16, 8]} />
            <meshStandardMaterial
              color={statusColor}
              emissive={statusColor}
              emissiveIntensity={isOperational ? 0.8 : 0.25}
              roughness={0.3}
              metalness={0.5}
            />
          </mesh>

          <mesh ref={beaconRef} position={[0, towerHeight + 0.62, 0]}>
            <octahedronGeometry args={[0.19, 0]} />
            <meshStandardMaterial
              color={statusColor}
              emissive={statusColor}
              emissiveIntensity={isOperational ? 1.85 : 1.5}
            />
          </mesh>
        </>
      )}

      {/* Progressive Connecting Scan Ring */}
      {isConnecting && (
        <mesh ref={scanRingRef} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.8, 0]}>
          <torusGeometry args={[0.66, 0.035, 8, 24]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
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
          position={[0, towerHeight + 1.05, 0]}
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
 * Segmented dashed perimeter ring rendered around disconnected islands.
 */
function DisconnectedDashedRing({ radius, isDay }: { radius: number; isDay: boolean }) {
  const segments = 22;
  const dashColor = isDay ? '#64748b' : '#475569';
  return (
    <group position={[0, 0.25, 0]}>
      {Array.from({ length: segments }).map((_, i) => {
        const angle = (i / segments) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
            rotation={[0, -angle + Math.PI / 2, 0]}
          >
            <boxGeometry args={[0.58, 0.05, 0.12]} />
            <meshBasicMaterial color={dashColor} transparent opacity={0.65} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Complete Provider Island + Boulevard Roads + Landmark + Model Buildings.
 */
function ProviderCityIsland({
  district,
  level,
  isSelectedCity,
  selectedBuildingId,
  isDay,
  showLabels,
  reducedMotion,
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
  onSelectCity: (pid: ProviderId) => void;
  onSelectBuilding: (b: CityModelBuildingData) => void;
}) {
  const { config, status, statusLabel, buildings } = district;
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

  return (
    <group position={config.position} name={`City_${config.providerId}`}>
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

      {/* Illuminated Boulevard Ring vs Dashed Offline Perimeter */}
      {isDisconnected ? (
        <DisconnectedDashedRing radius={config.islandRadius - 0.18} isDay={isDay} />
      ) : (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 0]}>
          <ringGeometry args={[2.35, 2.62, 42]} />
          <meshStandardMaterial
            color={roadRingColor}
            emissive={roadRingColor}
            emissiveIntensity={isActive ? (isDay ? 0.32 : 1.1) : 0.75}
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
          onSelect={onSelectBuilding}
        />
      ))}

      {/* World-Level City Banner */}
      {showLabels && level === 'world' && (
        <ProjectedHtml
          position={[0, 3.8, 0]}
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
 * Energy conduits across the ocean linking operational provider cities to the Council Hub,
 * and muted dashed links for disconnected cities.
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

  const routes = useMemo(() => {
    const center = new THREE.Vector3(0, 0.55, 0);
    return districts.map((d) => {
      const p = d.config.position;
      const end = new THREE.Vector3(p[0], 0.45, p[2]);
      const mid = new THREE.Vector3(p[0] * 0.5, 1.55, p[2] * 0.5);
      const curve = new THREE.QuadraticBezierCurve3(center, mid, end);
      const isDisconnected = d.status === 'disconnected';
      const dashPoints: Array<[number, number, number]> = [];
      if (isDisconnected) {
        const dashCount = 9;
        for (let i = 1; i < dashCount; i += 1) {
          const pt = curve.getPoint(i / dashCount);
          dashPoints.push([pt.x, pt.y, pt.z]);
        }
      }
      const tubeGeo = isDisconnected ? null : new THREE.TubeGeometry(curve, 20, 0.065, 6, false);
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

  useFrame((state) => {
    if (reducedMotion) return;
    const t = state.clock.elapsedTime;
    routes.forEach((r, idx) => {
      const orb = pulseOrbsRef.current[idx];
      if (!orb || !r.active) return;
      const phase = (t * 0.38 + idx * 0.19) % 1;
      r.curve.getPoint(1 - phase, _routeOrbPos);
      orb.position.copy(_routeOrbPos);
    });
  });

  return (
    <group name="EnergyRoutes">
      {/* Central Council Hub Island */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[2.1, 2.6, 0.65, 16]} />
        <meshStandardMaterial color={isDay ? '#cbd5e1' : '#141d36'} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.25, 0]}>
        <ringGeometry args={[1.45, 1.68, 32]} />
        <meshStandardMaterial color="#8b5cf6" emissive="#7c3aed" emissiveIntensity={1.15} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <cylinderGeometry args={[0.85, 1.15, 0.55, 8]} />
        <meshStandardMaterial color={isDay ? '#e2e8f0' : '#1e293b'} roughness={0.38} metalness={0.55} />
      </mesh>
      <mesh position={[0, 1.35, 0]}>
        <octahedronGeometry args={[0.48, 0]} />
        <meshStandardMaterial color="#8b5cf6" emissive="#38bdf8" emissiveIntensity={1.75} />
      </mesh>

      {showLabels && level === 'world' && (
        <ProjectedHtml position={[0, 2.35, 0]} center distanceFactor={40} style={{ pointerEvents: 'none' }}>
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
                  <sphereGeometry args={[0.09, 6, 6]} />
                  <meshBasicMaterial
                    color={isDay ? '#64748b' : '#475569'}
                    transparent
                    opacity={0.48}
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
                  emissiveIntensity={r.active ? (isDay ? 0.5 : 1.35) : 0.85}
                  transparent
                  opacity={r.active ? 0.88 : 0.55}
                />
              </mesh>
            )}
            {r.active && (
              <mesh
                ref={(el) => {
                  pulseOrbsRef.current[idx] = el;
                }}
              >
                <sphereGeometry args={[0.16, 10, 10]} />
                <meshStandardMaterial color="#ffffff" emissive={col} emissiveIntensity={2.0} />
              </mesh>
            )}
            {(r.warning || r.error) && (
              <mesh position={r.midPoint}>
                <octahedronGeometry args={[0.26, 0]} />
                <meshStandardMaterial
                  color={col}
                  emissive={col}
                  emissiveIntensity={1.65}
                />
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
}: {
  isDay: boolean;
  reducedMotion: boolean;
}) {
  const { qualityTier } = useWorldTheme();
  const ringARef = useRef<THREE.Mesh | null>(null);
  const ringBRef = useRef<THREE.Mesh | null>(null);
  const crystalRef = useRef<THREE.Mesh | null>(null);
  const motesRef = useRef<THREE.Points | null>(null);
  const count = qualityTier === 'lite' ? 90 : 180;

  const motesGeo = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = i * 2.39996;
      const r = 4 + ((i * 19) % 24);
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = 2.8 + ((i * 13) % 28) * 0.25;
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
    if (crystalRef.current) {
      crystalRef.current.rotation.y += delta * 1.1;
      crystalRef.current.position.y = 2.15 + Math.sin(t * 1.8) * 0.16;
    }
    if (motesRef.current) {
      motesRef.current.rotation.y += delta * 0.04;
    }
  });

  return (
    <group name="PremiumWorldAura">
      <mesh ref={ringARef} position={[0, 1.5, 0]}>
        <torusGeometry args={[2.55, 0.05, 10, 48]} />
        <meshStandardMaterial
          color="#fbbf24"
          emissive="#f59e0b"
          emissiveIntensity={isDay ? 0.7 : 1.7}
        />
      </mesh>
      <mesh ref={ringBRef} position={[0, 1.5, 0]} rotation={[Math.PI / 2.8, 0.4, 0]}>
        <torusGeometry args={[3.1, 0.04, 10, 48]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={isDay ? 0.6 : 1.55}
        />
      </mesh>
      <mesh ref={crystalRef} position={[0, 2.15, 0]}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial
          color="#fde68a"
          emissive="#fbbf24"
          emissiveIntensity={1.9}
        />
      </mesh>
      <points ref={motesRef} geometry={motesGeo}>
        <pointsMaterial
          color={isDay ? '#fde68a' : '#fcd34d'}
          size={0.18}
          transparent
          opacity={isDay ? 0.55 : 0.75}
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
  const { isDay, reducedMotion } = useWorldTheme();
  const { camera, size } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const aspect = size.width / Math.max(1, size.height);

  // Smooth GSAP camera orchestration across World -> City -> Building levels,
  // adapting distance so all 11 cities fit cleanly on screen in both portrait and landscape viewports.
  useEffect(() => {
    const activeDistrict =
      districts.find((d) => d.config.providerId === selectedCityId) || districts[0];
    const activeBuilding =
      activeDistrict?.buildings.find((b) => b.id === selectedBuildingId) || null;

    const worldDist = Math.min(132, Math.max(48, 60 / Math.max(aspect, 0.42)));
    let camGoal: [number, number, number] = [0, worldDist * 0.72, worldDist * 0.78];
    let targetGoal: [number, number, number] = [0, 0.3, 0.5];

    if (level === 'city' && activeDistrict) {
      const [cx, cy, cz] = activeDistrict.config.position;
      const cityDist = Math.min(26, Math.max(11.5, 13 / Math.max(aspect, 0.45)));
      camGoal = [cx + 0.4, cy + cityDist * 0.62, cz + cityDist * 0.84];
      targetGoal = [cx, cy + 1.0, cz];
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
  }, [level, selectedCityId, selectedBuildingId, districts, camera, reducedMotion, aspect, resetCameraSeq]);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.055}
        minPolarAngle={0.22}
        maxPolarAngle={Math.PI * 0.44}
        minDistance={level === 'building' ? 3.5 : level === 'city' ? 6.5 : 16}
        maxDistance={level === 'building' ? 16 : level === 'city' ? 28 : 155}
      />

      <ArchipelagoOcean isDay={isDay} reducedMotion={reducedMotion} />

      <InterCityEnergyRoutes
        districts={districts}
        isDay={isDay}
        showLabels={showLabels}
        level={level}
        reducedMotion={reducedMotion}
      />

      {isPremium && <PremiumWorldAura isDay={isDay} reducedMotion={reducedMotion} />}

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
          onSelectCity={onSelectCity}
          onSelectBuilding={onSelectBuilding}
        />
      ))}
    </>
  );
}
