import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { useWorldTheme } from '../../contexts/WorldThemeContext';
import { detectSoftwareWebGL } from './environmentUtils';
import {
  WorldLabelContext,
  WorldLabelOverlay,
  WorldLabelRegistry,
} from './ProjectedHtml';

interface WorldCanvasProps {
  children: React.ReactNode;
  cameraPosition?: [number, number, number];
  fov?: number;
  fogDensityDay?: number;
  fogDensityNight?: number;
  enableBloom?: boolean;
  onSceneReady?: () => void;
  onWebGLFallback?: () => void;
  fallbackContent?: React.ReactNode;
  className?: string;
}

/**
 * Generates RoomEnvironment PMREM for physical reflections on brushed metal, water & glass
 * without external HDR downloads.
 */
function EnvironmentLightingSetup({
  isDay,
  fogDensityDay,
  fogDensityNight,
}: {
  isDay: boolean;
  fogDensityDay: number;
  fogDensityNight: number;
}) {
  const { gl, scene } = useThree();
  const envTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);

  useEffect(() => {
    let target: THREE.WebGLRenderTarget | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(gl);
      pmrem.compileEquirectangularShader();
      const roomEnv = new RoomEnvironment();
      target = pmrem.fromScene(roomEnv, 0.04);
      envTargetRef.current = target;
      scene.environment = target.texture;
      roomEnv.dispose();
      pmrem.dispose();
    } catch {
      scene.environment = null;
    }

    return () => {
      scene.environment = null;
      if (target) {
        target.dispose();
      }
      envTargetRef.current = null;
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = isDay ? 0.85 : 0.42;
    const horizonHex = isDay ? 0x9ed4f5 : 0x0a1329;
    scene.background = new THREE.Color(horizonHex);
    scene.fog = new THREE.FogExp2(horizonHex, isDay ? fogDensityDay : fogDensityNight);
  }, [scene, isDay, fogDensityDay, fogDensityNight]);

  return null;
}

const _cloudDummy = new THREE.Object3D();

/**
 * Full sky sphere shader transitioning smoothly between natural warm sunlit Day
 * and deep starry aurora-violet Night, enriched with twinkling stars, shooting stars,
 * and drifting multi-puff 3D clouds.
 */
function SkyAtmosphere({ isDay, reducedMotion }: { isDay: boolean; reducedMotion: boolean }) {
  const { qualityTier } = useWorldTheme();
  const cloudsRef = useRef<THREE.InstancedMesh | null>(null);
  const meteorGroupRef = useRef<THREE.Group | null>(null);

  const skyUniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color('#1d6fdc') },
      uHorizon: { value: new THREE.Color('#a7dbf8') },
      uSunGlow: { value: new THREE.Color('#fff1c2') },
      uSunDir: { value: new THREE.Vector3(0.45, 0.62, -0.64).normalize() },
      uNightFactor: { value: 0 },
      uTime: { value: 0 },
    }),
    [],
  );

  const starUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0.9 },
    }),
    [],
  );

  const starGeo = useMemo(() => {
    const count = qualityTier === 'lite' ? 320 : 820;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = [
      new THREE.Color('#e0f2fe'),
      new THREE.Color('#ffffff'),
      new THREE.Color('#fde68a'),
      new THREE.Color('#c7d2fe'),
    ];

    for (let i = 0; i < count; i += 1) {
      const theta = ((i * 137.508) % 360) * (Math.PI / 180);
      const phi = Math.acos(0.08 + ((i * 0.6180339) % 0.89));
      const r = 192;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      phases[i] = (i * 1.73) % (Math.PI * 2);
      sizes[i] = 1.6 + ((i * 29) % 10) * 0.28;
      const col = palette[i % palette.length];
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [qualityTier]);

  // Multi-puff cloud clusters distributed around the sky dome
  const cloudPuffs = useMemo(() => {
    const clusterCount = qualityTier === 'lite' ? 8 : 14;
    const puffs: Array<{
      baseAngle: number;
      radius: number;
      y: number;
      speed: number;
      offsetAngle: number;
      offsetY: number;
      sx: number;
      sy: number;
      sz: number;
    }> = [];
    for (let c = 0; c < clusterCount; c += 1) {
      const baseAngle = (c / clusterCount) * Math.PI * 2 + (c % 3) * 0.21;
      const radius = 64 + ((c * 19) % 5) * 14;
      const y = 26 + ((c * 13) % 6) * 3.8;
      const speed = 0.012 + (c % 4) * 0.004;
      // 3 sculpted overlapping puffs per cloud cluster
      for (let p = 0; p < 3; p += 1) {
        puffs.push({
          baseAngle,
          radius: radius + (p - 1) * 1.4,
          y,
          speed,
          offsetAngle: (p - 1) * 0.055,
          offsetY: p === 1 ? 1.15 : -0.25,
          sx: p === 1 ? 5.6 : 3.9,
          sy: p === 1 ? 2.1 : 1.5,
          sz: p === 1 ? 3.8 : 2.9,
        });
      }
    }
    return puffs;
  }, [qualityTier]);

  const meteorTracks = useMemo(
    () => [
      { period: 7.5, offset: 1.2, azimuth: 0.6, pitch: 0.55 },
      { period: 11.2, offset: 5.4, azimuth: 2.7, pitch: 0.48 },
    ],
    [],
  );

  useEffect(() => () => starGeo.dispose(), [starGeo]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const targetNight = isDay ? 0 : 1;
    const step = reducedMotion ? 1 : Math.min(1, delta * 3.5);
    skyUniforms.uNightFactor.value = THREE.MathUtils.lerp(
      skyUniforms.uNightFactor.value,
      targetNight,
      step,
    );
    skyUniforms.uTime.value = reducedMotion ? 0 : t;
    starUniforms.uTime.value = reducedMotion ? 0 : t;
    starUniforms.uOpacity.value = skyUniforms.uNightFactor.value;

    if (isDay) {
      skyUniforms.uZenith.value.set('#226ed4');
      skyUniforms.uHorizon.value.set('#bce6fc');
      skyUniforms.uSunGlow.value.set('#fff3c9');
      skyUniforms.uSunDir.value.set(0.45, 0.58, -0.65).normalize();
    } else {
      skyUniforms.uZenith.value.set('#050918');
      skyUniforms.uHorizon.value.set('#122247');
      skyUniforms.uSunGlow.value.set('#80a8ff');
      skyUniforms.uSunDir.value.set(-0.42, 0.52, -0.74).normalize();
    }

    // Animate drifting clouds smoothly
    if (cloudsRef.current) {
      const timeVal = reducedMotion ? 0 : t;
      for (let i = 0; i < cloudPuffs.length; i += 1) {
        const puff = cloudPuffs[i];
        const ang = puff.baseAngle + puff.offsetAngle + timeVal * puff.speed;
        const bob = Math.sin(timeVal * 0.45 + i * 0.6) * 0.35;
        _cloudDummy.position.set(
          Math.cos(ang) * puff.radius,
          puff.y + puff.offsetY + bob,
          Math.sin(ang) * puff.radius,
        );
        _cloudDummy.rotation.set(0, -ang + Math.PI / 2, 0);
        _cloudDummy.scale.set(puff.sx, puff.sy, puff.sz);
        _cloudDummy.updateMatrix();
        cloudsRef.current.setMatrixAt(i, _cloudDummy.matrix);
      }
      cloudsRef.current.instanceMatrix.needsUpdate = true;
    }

    // Animate periodic shooting stars at night
    if (meteorGroupRef.current && !isDay && !reducedMotion) {
      meteorGroupRef.current.children.forEach((child, idx) => {
        const track = meteorTracks[idx];
        if (!track) return;
        const cycle = (t + track.offset) % track.period;
        const activeDur = 1.15;
        if (cycle < activeDur) {
          const p = cycle / activeDur;
          const r = 148;
          const az = track.azimuth + p * 0.42;
          const el = track.pitch - p * 0.24;
          child.visible = true;
          child.position.set(
            r * Math.cos(el) * Math.cos(az),
            r * Math.sin(el),
            r * Math.cos(el) * Math.sin(az),
          );
          child.lookAt(0, 20, 0);
          child.rotateZ(-0.55);
          const fade = Math.sin(p * Math.PI);
          child.scale.set(1, 1 + fade * 1.4, 1);
        } else {
          child.visible = false;
        }
      });
    } else if (meteorGroupRef.current) {
      meteorGroupRef.current.children.forEach((c) => {
        c.visible = false;
      });
    }
  });

  return (
    <group name="SkyAtmosphere">
      <mesh frustumCulled={false}>
        <sphereGeometry args={[240, 36, 26]} />
        <shaderMaterial
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          uniforms={skyUniforms}
          vertexShader={`
            varying vec3 vWorldDir;
            void main() {
              vec4 worldPos = modelMatrix * vec4(position, 1.0);
              vWorldDir = normalize(worldPos.xyz);
              gl_Position = projectionMatrix * viewMatrix * worldPos;
            }
          `}
          fragmentShader={`
            uniform vec3 uZenith;
            uniform vec3 uHorizon;
            uniform vec3 uSunGlow;
            uniform vec3 uSunDir;
            uniform float uNightFactor;
            uniform float uTime;
            varying vec3 vWorldDir;

            void main() {
              float h = clamp(vWorldDir.y * 0.95 + 0.08, 0.0001, 1.0);
              vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));
              float sunDot = max(dot(normalize(vWorldDir), uSunDir), 0.0001);
              float disc = smoothstep(0.9962, 0.9992, sunDot);
              float halo = pow(sunDot, mix(12.0, 24.0, uNightFactor)) * mix(0.7, 0.38, uNightFactor);
              col += uSunGlow * (halo + disc * 1.2);

              // Flowing nocturnal aurora curtains + soft cosmic nebula band
              if (uNightFactor > 0.04) {
                float ribbonA = sin(vWorldDir.x * 5.2 + uTime * 0.16) * cos(vWorldDir.z * 4.1 - uTime * 0.12);
                float ribbonB = cos(vWorldDir.z * 6.4 + uTime * 0.19 - vWorldDir.x * 2.2);
                float band = smoothstep(0.14, 0.68, h) * (1.0 - smoothstep(0.68, 0.96, h));
                vec3 aurora = mix(vec3(0.14, 0.68, 0.98), vec3(0.58, 0.32, 0.98), ribbonA * 0.5 + 0.5);
                aurora = mix(aurora, vec3(0.18, 0.92, 0.72), max(0.0, ribbonB) * 0.35);
                col += aurora * band * max(0.0, ribbonA * 0.7 + 0.3) * 0.24 * uNightFactor;
              }
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>

      {/* Twinkling Multi-Color Night Starfield */}
      {!isDay && (
        <points geometry={starGeo} frustumCulled={false}>
          <shaderMaterial
            transparent
            depthWrite={false}
            fog={false}
            uniforms={starUniforms}
            vertexShader={`
              attribute float aPhase;
              attribute float aSize;
              attribute vec3 aColor;
              uniform float uTime;
              varying vec3 vColor;
              varying float vTwinkle;
              void main() {
                vColor = aColor;
                vTwinkle = 0.45 + 0.55 * sin(uTime * 2.1 + aPhase);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (0.85 + 0.4 * vTwinkle);
                gl_Position = projectionMatrix * mvPosition;
              }
            `}
            fragmentShader={`
              uniform float uOpacity;
              varying vec3 vColor;
              varying float vTwinkle;
              void main() {
                vec2 uv = gl_PointCoord - 0.5;
                float d = length(uv);
                if (d > 0.5) discard;
                float glow = exp(-d * d * 12.0);
                gl_FragColor = vec4(vColor, glow * vTwinkle * uOpacity);
              }
            `}
          />
        </points>
      )}

      {/* Periodic Shooting Stars */}
      <group ref={meteorGroupRef}>
        {meteorTracks.map((_, idx) => (
          <mesh key={idx} visible={false}>
            <cylinderGeometry args={[0.04, 0.22, 11, 6]} />
            <meshBasicMaterial
              color="#bae6fd"
              transparent
              opacity={0.78}
              fog={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>

      {/* Drifting Stylized Multi-Puff Clouds */}
      <instancedMesh
        ref={cloudsRef}
        args={[undefined, undefined, cloudPuffs.length]}
        frustumCulled={false}
      >
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color={isDay ? '#ffffff' : '#1b2c4f'}
          emissive={isDay ? '#e0f2fe' : '#1e3a8a'}
          emissiveIntensity={isDay ? 0.16 : 0.24}
          roughness={0.95}
          metalness={0}
          transparent
          opacity={isDay ? 0.72 : 0.36}
          fog={false}
        />
      </instancedMesh>
    </group>
  );
}

/**
 * Balanced 3-point key + hemisphere + cool/warm rim directional light rig
 * switching genuinely between sunlight Day and luminous Night lighting.
 */
function DayNightLightingRig({
  isDay,
  shadowsEnabled,
}: {
  isDay: boolean;
  shadowsEnabled: boolean;
}) {
  return (
    <group name="DayNightLightingRig">
      <hemisphereLight
        color={isDay ? '#b8e1ff' : '#334d8a'}
        groundColor={isDay ? '#4b6b4f' : '#0b1020'}
        intensity={isDay ? 0.85 : 0.42}
      />

      {/* Primary Key Light (Sun or Moon) */}
      <directionalLight
        position={isDay ? [24, 34, 22] : [-20, 28, -26]}
        color={isDay ? '#fff6e0' : '#9dc0ff'}
        intensity={isDay ? 2.2 : 0.95}
        castShadow={shadowsEnabled}
        shadow-mapSize-width={shadowsEnabled ? 2048 : 512}
        shadow-mapSize-height={shadowsEnabled ? 2048 : 512}
        shadow-camera-near={2}
        shadow-camera-far={95}
        shadow-camera-left={-28}
        shadow-camera-right={28}
        shadow-camera-top={28}
        shadow-camera-bottom={-28}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />

      {/* Secondary Rim / Fill Light */}
      <directionalLight
        position={isDay ? [-18, 12, -16] : [18, 14, 20]}
        color={isDay ? '#99c9ff' : '#8b5cf6'}
        intensity={isDay ? 0.52 : 0.48}
      />
    </group>
  );
}

/**
 * Selective Bloom Post-Processor using Three.js native EffectComposer + UnrealBloomPass.
 * Only mounted when High quality + hardware WebGL2 + HalfFloat FBOs are verified,
 * so R3F's native gl.render(scene, camera) is never blocked when composer is inactive.
 */
function AdaptiveBloomComposer({
  isDay,
  onUnsupported,
}: {
  isDay: boolean;
  onUnsupported: () => void;
}) {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;

    const context = gl.getContext();
    const hasHalfFloatRender =
      gl.capabilities.isWebGL2 &&
      Boolean(
        gl.extensions.get('EXT_color_buffer_float') ||
          gl.extensions.get('EXT_color_buffer_half_float'),
      );

    if (!hasHalfFloatRender) {
      onUnsupported();
      return;
    }

    let composer: EffectComposer | null = null;
    try {
      composer = new EffectComposer(gl);
      composer.setPixelRatio(gl.getPixelRatio());
      composer.setSize(size.width, size.height);

      // Verify FBO completeness before taking over the render loop
      gl.setRenderTarget(composer.renderTarget1);
      const fbStatus = context.checkFramebufferStatus(context.FRAMEBUFFER);
      gl.setRenderTarget(null);
      if (fbStatus !== context.FRAMEBUFFER_COMPLETE) {
        composer.dispose();
        onUnsupported();
        return;
      }

      const renderPass = new RenderPass(scene, camera);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(Math.max(1, size.width), Math.max(1, size.height)),
        isDay ? 0.16 : 0.38,
        isDay ? 0.32 : 0.52,
        isDay ? 0.94 : 0.74,
      );
      const outputPass = new OutputPass();

      composer.addPass(renderPass);
      composer.addPass(bloomPass);
      composer.addPass(outputPass);

      composerRef.current = composer;
      bloomPassRef.current = bloomPass;
    } catch {
      composer?.dispose();
      composerRef.current = null;
      bloomPassRef.current = null;
      onUnsupported();
    }

    return () => {
      composer?.dispose();
      composerRef.current = null;
      bloomPassRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  useEffect(() => {
    if (!composerRef.current || !bloomPassRef.current) return;
    if (size.width <= 0 || size.height <= 0) return;
    composerRef.current.setPixelRatio(gl.getPixelRatio());
    composerRef.current.setSize(size.width, size.height);
    bloomPassRef.current.resolution.set(size.width, size.height);
  }, [size.width, size.height, gl]);

  useEffect(() => {
    if (!bloomPassRef.current) return;
    bloomPassRef.current.strength = isDay ? 0.16 : 0.38;
    bloomPassRef.current.radius = isDay ? 0.32 : 0.52;
    bloomPassRef.current.threshold = isDay ? 0.94 : 0.74;
  }, [isDay]);

  useFrame(() => {
    if (composerRef.current) {
      try {
        composerRef.current.render();
      } catch {
        composerRef.current.dispose();
        composerRef.current = null;
        onUnsupported();
        gl.render(scene, camera);
      }
    } else {
      gl.render(scene, camera);
    }
  }, 1);

  return null;
}

class WorldErrorBoundary extends React.Component<
  {
    onError: () => void;
    children: React.ReactNode;
  },
  { hasError: boolean }
> {
  constructor(props: { onError: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export function WorldCanvas({
  children,
  cameraPosition = [0, 8.5, 16],
  fov = 45,
  fogDensityDay = 0.0085,
  fogDensityNight = 0.0115,
  enableBloom = true,
  onSceneReady,
  onWebGLFallback,
  fallbackContent,
  className = '',
}: WorldCanvasProps) {
  const { isDay, qualityTier, reducedMotion, isMobileViewport, webglSupported } = useWorldTheme();
  const [contextLost, setContextLost] = useState(false);
  const [renderCrashed, setRenderCrashed] = useState(false);
  const [isSoftwareGl, setIsSoftwareGl] = useState(false);
  const [bloomSupported, setBloomSupported] = useState(true);
  const labelRegistry = useMemo(() => new WorldLabelRegistry(), []);

  const effectiveDpr: [number, number] = useMemo(() => {
    if (isSoftwareGl || qualityTier === 'lite') return [1, 1];
    if (isMobileViewport || qualityTier === 'balanced') return [1, 1.5];
    return [1, 2];
  }, [isSoftwareGl, qualityTier, isMobileViewport]);

  const shadowsEnabled = !isSoftwareGl && qualityTier !== 'lite';
  const useBloom = enableBloom && bloomSupported && !isSoftwareGl && qualityTier === 'high';

  useEffect(() => {
    if (!webglSupported || contextLost || renderCrashed) {
      const raf = requestAnimationFrame(() => onSceneReady?.());
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [webglSupported, contextLost, renderCrashed, onSceneReady]);

  if (!webglSupported || contextLost || renderCrashed) {
    if (fallbackContent) {
      return <div className={`w-full h-full ${className}`}>{fallbackContent}</div>;
    }
    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-6 text-center ${
          isDay ? 'bg-sky-100 text-slate-900' : 'bg-[#090E1A] text-slate-100'
        } ${className}`}
      >
        <p className="font-display font-semibold text-base">
          3D Graphics Context Unavailable
        </p>
        <p className="text-xs opacity-75 mt-1 max-w-md">
          Your device or browser temporarily disabled WebGL acceleration. Workspace features remain fully operational.
        </p>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full min-h-[240px] ${className}`}>
      <WorldErrorBoundary
        onError={() => {
          setRenderCrashed(true);
          onWebGLFallback?.();
        }}
      >
        <Canvas
          shadows={shadowsEnabled}
          dpr={effectiveDpr}
          camera={{ position: cameraPosition, fov, near: 0.25, far: 450 }}
          gl={{
            antialias: qualityTier !== 'lite',
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: isDay ? 1.05 : 1.12,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          onCreated={({ gl }) => {
            const software = detectSoftwareWebGL(gl);
            if (software) {
              setIsSoftwareGl(true);
            }

            const canvas = gl.domElement;
            const handleLost = (e: Event) => {
              e.preventDefault();
              setContextLost(true);
              onWebGLFallback?.();
            };
            const handleRestored = () => setContextLost(false);
            canvas.addEventListener('webglcontextlost', handleLost, false);
            canvas.addEventListener('webglcontextrestored', handleRestored, false);
            requestAnimationFrame(() => onSceneReady?.());
          }}
        >
          <WorldLabelContext.Provider value={labelRegistry}>
            <EnvironmentLightingSetup
              isDay={isDay}
              fogDensityDay={fogDensityDay}
              fogDensityNight={fogDensityNight}
            />
            <SkyAtmosphere isDay={isDay} reducedMotion={reducedMotion} />
            <DayNightLightingRig isDay={isDay} shadowsEnabled={shadowsEnabled} />
            {children}
            {useBloom && (
              <AdaptiveBloomComposer
                isDay={isDay}
                onUnsupported={() => setBloomSupported(false)}
              />
            )}
          </WorldLabelContext.Provider>
        </Canvas>
      </WorldErrorBoundary>
      <WorldLabelOverlay registry={labelRegistry} />
    </div>
  );
}
