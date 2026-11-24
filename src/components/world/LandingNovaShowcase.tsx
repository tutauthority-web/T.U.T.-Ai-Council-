import { useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { Moon, Scale, Sun } from 'lucide-react';
import heroChamberImg from '../../assets/images/hero_council_chamber_1795008973998.jpg';
import { useWorldTheme } from '../../contexts/WorldThemeContext';
import { CharacterActor } from '../../three/characters/CharacterActor';
import { WorldCanvas } from '../../three/core/WorldCanvas';

function LandingShowcaseScene() {
  const { isDay, reducedMotion } = useWorldTheme();
  const outerRingRef = useRef<THREE.Mesh | null>(null);

  useFrame((state, delta) => {
    if (reducedMotion || !outerRingRef.current) return;
    outerRingRef.current.rotation.z += delta * 0.28;
    outerRingRef.current.position.y = 0.06 + Math.sin(state.clock.elapsedTime * 1.4) * 0.015;
  });

  return (
    <>
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        enableZoom={false}
        enablePan={false}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.65}
        minPolarAngle={0.45}
        maxPolarAngle={Math.PI * 0.44}
      />

      {/* Miniature Sculpted Sanctuary Plinth */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <cylinderGeometry args={[4.45, 4.95, 0.36, 48]} />
        <meshStandardMaterial
          color={isDay ? '#dbe4f0' : '#182238'}
          roughness={0.5}
          metalness={0.26}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[2.5, 2.66, 48]} />
        <meshStandardMaterial
          color="#38bdf8"
          emissive="#38bdf8"
          emissiveIntensity={isDay ? 0.35 : 1.1}
        />
      </mesh>
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[3.72, 3.8, 6]} />
        <meshStandardMaterial
          color="#818cf8"
          emissive="#7c3aed"
          emissiveIntensity={isDay ? 0.25 : 0.95}
        />
      </mesh>

      <CharacterActor
        id="nova"
        label="T.U.T AI Nova"
        kind="nova"
        homePosition={[0, 0.04, 0.3]}
        status="operational"
        gatheringPhase="idle"
        reducedMotion={reducedMotion}
        showLabels={false}
      />
      <CharacterActor
        id="google"
        label="Google Gemini"
        kind="google"
        homePosition={[-2.35, 0.04, -1.0]}
        status="operational"
        gatheringPhase="idle"
        reducedMotion={reducedMotion}
        showLabels={false}
      />
      <CharacterActor
        id="openai"
        label="ChatGPT"
        kind="openai"
        homePosition={[2.35, 0.04, -1.0]}
        status="operational"
        gatheringPhase="idle"
        reducedMotion={reducedMotion}
        showLabels={false}
      />
      <CharacterActor
        id="anthropic"
        label="Claude"
        kind="anthropic"
        homePosition={[-1.95, 0.04, 1.85]}
        status="operational"
        gatheringPhase="idle"
        reducedMotion={reducedMotion}
        showLabels={false}
      />
      <CharacterActor
        id="groq"
        label="Groq"
        kind="groq"
        homePosition={[1.95, 0.04, 1.85]}
        status="operational"
        gatheringPhase="idle"
        reducedMotion={reducedMotion}
        showLabels={false}
      />
    </>
  );
}

export function LandingNovaShowcase() {
  const { isDay, toggleTimeOfDay } = useWorldTheme();
  const [imgFallbackError, setImgFallbackError] = useState(false);

  const fallback = !imgFallbackError ? (
    <img
      src={heroChamberImg}
      alt="Minimalist dark slate deliberation chamber representing multi-model AI collaboration"
      onError={() => setImgFallbackError(true)}
      className="w-full h-full object-cover"
    />
  ) : (
    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#0F172A] to-[#090E1A]">
      <Scale className="w-10 h-10 text-blue-400 mb-3" />
      <p className="font-display font-semibold text-slate-200">T.U.T AI Council Chamber</p>
      <p className="text-sm text-slate-400 mt-1">Parallel multi-provider deliberation environment</p>
    </div>
  );

  return (
    <div className="relative w-full h-[360px] lg:h-[460px]">
      <WorldCanvas
        cameraPosition={[0, 3.8, 7.6]}
        fov={42}
        enableBloom={false}
        fallbackContent={fallback}
      >
        <LandingShowcaseScene />
      </WorldCanvas>

      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
        <span
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border backdrop-blur-md ${
            isDay
              ? 'bg-white/85 border-slate-300 text-slate-800'
              : 'bg-[#090E1A]/85 border-slate-700 text-slate-200'
          }`}
        >
          T.U.T AI Nova &amp; Council Avatars · Drag to orbit
        </span>
        <button
          type="button"
          onClick={toggleTimeOfDay}
          className={`pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border backdrop-blur-md transition-colors cursor-pointer ${
            isDay
              ? 'bg-white/90 border-slate-300 text-slate-800 hover:bg-white'
              : 'bg-[#090E1A]/90 border-slate-700 text-slate-200 hover:bg-slate-800'
          }`}
        >
          {isDay ? (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              Day
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-sky-400" />
              Night
            </>
          )}
        </button>
      </div>
    </div>
  );
}
