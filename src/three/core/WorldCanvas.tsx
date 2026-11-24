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

/**
 * Full sky sphere shader transitioning smoothly between natural warm sunlit Day
 * and deep starry aurora-violet Night.
 */
function SkyAtmosphere({ isDay, reducedMotion }: { isDay: boolean; reducedMotion: boolean }) {
  const { qualityTier } = useWorldTheme();
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

  const starGeo = useMemo(() => {
    const count = qualityTier === 'lite' ? 280 : 650;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = ((i * 137.508) % 360) * (Math.PI / 180);
      const phi = Math.acos(0.12 + ((i * 0.6180339) % 0.85));
      const r = 185;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [qualityTier]);

  useEffect(() => () => starGeo.dispose(), [starGeo]);

  useFrame((state, delta) => {
    const targetNight = isDay ? 0 : 1;
    const step = reducedMotion ? 1 : Math.min(1, delta * 3.5);
    skyUniforms.uNightFactor.value = THREE.MathUtils.lerp(
      skyUniforms.uNightFactor.value,
      targetNight,
      step,
    );
    skyUniforms.uTime.value = state.clock.elapsedTime;

    if (isDay) {
      skyUniforms.uZenith.value.set('#2874d8');
      skyUniforms.uHorizon.value.set('#b4e2fa');
      skyUniforms.uSunGlow.value.set('#fff3c9');
      skyUniforms.uSunDir.value.set(0.45, 0.58, -0.65).normalize();
    } else {
      skyUniforms.uZenith.value.set('#050918');
      skyUniforms.uHorizon.value.set('#101d3b');
      skyUniforms.uSunGlow.value.set('#80a8ff');
      skyUniforms.uSunDir.value.set(-0.42, 0.52, -0.74).normalize();
    }
  });

  return (
    <group name="SkyAtmosphere">
      <mesh frustumCulled={false}>
        <sphereGeometry args={[210, 32, 24]} />
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
              vec3 col = mix(uHorizon, uZenith, pow(h, 0.65));
              float sunDot = max(dot(normalize(vWorldDir), uSunDir), 0.0001);
              float disc = smoothstep(0.9965, 0.9992, sunDot);
              float halo = pow(sunDot, mix(14.0, 26.0, uNightFactor)) * mix(0.65, 0.35, uNightFactor);
              col += uSunGlow * (halo + disc * 1.15);

              // Subtle nocturnal aurora veil
              if (uNightFactor > 0.05) {
                float ribbon = sin(vWorldDir.x * 5.0 + uTime * 0.12) * cos(vWorldDir.z * 4.0 - uTime * 0.09);
                float band = smoothstep(0.2, 0.72, h) * (1.0 - smoothstep(0.72, 0.95, h));
                vec3 aurora = mix(vec3(0.18, 0.58, 0.95), vec3(0.55, 0.32, 0.96), ribbon * 0.5 + 0.5);
                col += aurora * band * max(0.0, ribbon) * 0.18 * uNightFactor;
              }
              gl_FragColor = vec4(col, 1.0);
            }
          `}
        />
      </mesh>

      {!isDay && (
        <points geometry={starGeo} frustumCulled={false}>
          <pointsMaterial
            color="#dbeafe"
            size={1.25}
            sizeAttenuation={false}
            transparent
            opacity={0.78}
            fog={false}
            depthWrite={false}
          />
        </points>
      )}
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
          camera={{ position: cameraPosition, fov, near: 0.25, far: 320 }}
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
