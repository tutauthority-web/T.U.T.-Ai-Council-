import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ProjectedHtml } from '../core/ProjectedHtml';
import type { ProviderId } from '../../shared/providers';
import { getCharacterAnimationClips, type CharacterAnimState } from './CharacterClips';
import {
  createNovaCharacterRig,
  createProviderCharacterRig,
  type ArticulatedCharacterRig,
} from './ProceduralCharacters';

export type CharacterOperationalStatus =
  | 'operational'
  | 'connecting'
  | 'warning'
  | 'error'
  | 'disconnected';

export interface CharacterActorProps {
  id: string;
  label: string;
  sublabel?: string;
  kind: 'nova' | ProviderId;
  homePosition: [number, number, number];
  patrolWaypoints?: Array<[number, number, number]>;
  status: CharacterOperationalStatus;
  gatheringPhase: 'idle' | 'charging' | 'gathering' | 'entered';
  gatherDelaySec?: number;
  portalEntryPoint?: [number, number, number];
  holdProgress?: number;
  reducedMotion?: boolean;
  showLabels?: boolean;
  onSelect?: (id: string) => void;
  onEnteredPortal?: (id: string) => void;
}

const TMP_TARGET = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const UP_VEC = new THREE.Vector3(0, 1, 0);
const MAT_LOOK = new THREE.Matrix4();

export function CharacterActor({
  id,
  label,
  sublabel,
  kind,
  homePosition,
  patrolWaypoints = [],
  status,
  gatheringPhase,
  gatherDelaySec = 0,
  portalEntryPoint = [0, 0.25, -5.1],
  holdProgress = 0,
  reducedMotion = false,
  showLabels = true,
  onSelect,
  onEnteredPortal,
}: CharacterActorProps) {
  const [hovered, setHovered] = useState(false);

  const rig = useMemo<ArticulatedCharacterRig>(() => {
    return kind === 'nova' ? createNovaCharacterRig() : createProviderCharacterRig(kind);
  }, [kind]);

  const clips = useMemo(() => getCharacterAnimationClips(), []);
  const mixer = useMemo(() => new THREE.AnimationMixer(rig.root), [rig]);
  const actions = useMemo(() => {
    const map: Record<CharacterAnimState, THREE.AnimationAction> = {
      idle: mixer.clipAction(clips.idle),
      walk: mixer.clipAction(clips.walk),
      turn: mixer.clipAction(clips.turn),
      interact: mixer.clipAction(clips.interact),
      beckon: mixer.clipAction(clips.beckon),
      enterPortal: mixer.clipAction(clips.enterPortal),
      dormant: mixer.clipAction(clips.dormant),
    };
    map.enterPortal.setLoop(THREE.LoopOnce, 1);
    map.enterPortal.clampWhenFinished = true;
    map.interact.setLoop(THREE.LoopOnce, 1);
    return map;
  }, [mixer, clips]);

  const activeStateRef = useRef<CharacterAnimState>('idle');
  const labelGroupRef = useRef<THREE.Group | null>(null);
  const waypointIndexRef = useRef(0);
  const pauseTimerRef = useRef(1.2 + (gatherDelaySec * 1.7));
  const gatherElapsedRef = useRef(0);
  const enteredNotifiedRef = useRef(false);
  const interactBoostRef = useRef(0);

  // Initialize home position once when rig mounts
  useEffect(() => {
    rig.root.position.set(homePosition[0], homePosition[1], homePosition[2]);
    if (labelGroupRef.current) {
      labelGroupRef.current.position.copy(rig.root.position);
    }
    // Face center plaza by default
    const angle = Math.atan2(-homePosition[0], -homePosition[2]);
    rig.root.rotation.set(0, angle, 0);
    actions.idle.reset().play();
    activeStateRef.current = 'idle';

    return () => {
      mixer.stopAllAction();
      rig.materials.disposables.forEach((d) => d.dispose());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, mixer, actions]);

  // Reset gathering flags when returning to idle
  useEffect(() => {
    if (gatheringPhase === 'idle') {
      gatherElapsedRef.current = 0;
      enteredNotifiedRef.current = false;
      rig.root.scale.setScalar(1);
      rig.root.visible = true;
    }
  }, [gatheringPhase, rig]);

  // Status-based emissive & ring coloring
  useEffect(() => {
    const { eyeGlow, accentGlow, statusRing } = rig.materials;
    if (status === 'disconnected') {
      eyeGlow.emissiveIntensity = 0.08;
      accentGlow.emissiveIntensity = 0.1;
      statusRing.color.set('#475569');
      statusRing.opacity = 0.18;
    } else if (status === 'error') {
      eyeGlow.emissive.set('#fb7185');
      eyeGlow.emissiveIntensity = 1.6;
      accentGlow.emissive.set('#f43f5e');
      accentGlow.emissiveIntensity = 1.4;
      statusRing.color.set('#f43f5e');
      statusRing.opacity = 0.45;
    } else if (status === 'warning') {
      eyeGlow.emissive.set('#fbbf24');
      eyeGlow.emissiveIntensity = 1.6;
      accentGlow.emissive.set('#f59e0b');
      accentGlow.emissiveIntensity = 1.3;
      statusRing.color.set('#f59e0b');
      statusRing.opacity = 0.42;
    } else if (status === 'connecting') {
      eyeGlow.emissive.set('#38bdf8');
      eyeGlow.emissiveIntensity = 2.0;
      statusRing.color.set('#38bdf8');
      statusRing.opacity = 0.48;
    } else {
      // Restore healthy glow
      if (kind === 'nova') {
        eyeGlow.emissive.set('#38bdf8');
        accentGlow.emissive.set('#7c3aed');
        statusRing.color.set('#38bdf8');
      } else {
        const c = eyeGlow.color.getHex();
        eyeGlow.emissive.setHex(c);
        accentGlow.emissive.setHex(c);
        statusRing.color.setHex(c);
      }
      eyeGlow.emissiveIntensity = 2.1;
      accentGlow.emissiveIntensity = 1.45;
      statusRing.opacity = 0.36;
    }
  }, [status, rig, kind]);

  const switchAnim = (next: CharacterAnimState, fadeSec = 0.28) => {
    if (activeStateRef.current === next) return;
    const prevAction = actions[activeStateRef.current];
    const nextAction = actions[next];
    nextAction.reset();
    nextAction.enabled = true;
    nextAction.setEffectiveWeight(1);
    nextAction.play();
    prevAction.crossFadeTo(nextAction, reducedMotion ? 0.05 : fadeSec, true);
    activeStateRef.current = next;
  };

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    mixer.update(reducedMotion ? dt * 0.25 : dt);
    if (labelGroupRef.current) {
      labelGroupRef.current.position.copy(rig.root.position);
    }

    const isOperational = status === 'operational' || status === 'connecting';

    // 1. Disconnected characters stay calmly dormant at perimeter
    if (status === 'disconnected' && kind !== 'nova') {
      switchAnim('dormant', 0.4);
      TMP_TARGET.set(homePosition[0], homePosition[1], homePosition[2]);
      rig.root.position.lerp(TMP_TARGET, dt * 3);
      return;
    }

    // 2. Gathering sequence when Portal activated
    if (gatheringPhase === 'gathering' || gatheringPhase === 'entered') {
      if (kind === 'nova') {
        // Nova stands beside portal steps and beckons everyone in, then enters last
        TMP_TARGET.set(-1.35, 0.24, -3.55);
        const dist = rig.root.position.distanceTo(TMP_TARGET);
        if (dist > 0.16) {
          switchAnim('walk', 0.22);
          TMP_DIR.copy(TMP_TARGET).sub(rig.root.position).normalize();
          rig.root.position.addScaledVector(TMP_DIR, dt * 2.5);
          MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
          TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
          rig.root.quaternion.slerp(TMP_QUAT, dt * 8);
        } else {
          gatherElapsedRef.current += dt;
          if (gatherElapsedRef.current < gatherDelaySec) {
            switchAnim('beckon', 0.25);
            TMP_TARGET.set(portalEntryPoint[0], 0.24, portalEntryPoint[2]);
            MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
            TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
            rig.root.quaternion.slerp(TMP_QUAT, dt * 6);
          } else {
            TMP_TARGET.set(portalEntryPoint[0], portalEntryPoint[1], portalEntryPoint[2]);
            const dPortal = rig.root.position.distanceTo(TMP_TARGET);
            if (dPortal > 0.35) {
              switchAnim('walk', 0.2);
              TMP_DIR.copy(TMP_TARGET).sub(rig.root.position).normalize();
              rig.root.position.addScaledVector(TMP_DIR, dt * 2.8);
              MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
              TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
              rig.root.quaternion.slerp(TMP_QUAT, dt * 8);
            } else {
              switchAnim('enterPortal', 0.18);
              if (!enteredNotifiedRef.current) {
                enteredNotifiedRef.current = true;
                onEnteredPortal?.(id);
              }
            }
          }
        }
        return;
      }

      if (!isOperational && status !== 'warning') {
        switchAnim('dormant', 0.3);
        return;
      }

      gatherElapsedRef.current += dt;
      if (gatherElapsedRef.current < gatherDelaySec) {
        switchAnim('turn', 0.22);
        TMP_TARGET.set(portalEntryPoint[0], rig.root.position.y, portalEntryPoint[2]);
        MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
        TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
        rig.root.quaternion.slerp(TMP_QUAT, dt * 6);
        return;
      }

      TMP_TARGET.set(portalEntryPoint[0], portalEntryPoint[1], portalEntryPoint[2]);
      const distToPortal = rig.root.position.distanceTo(TMP_TARGET);
      if (distToPortal > 0.38) {
        switchAnim('walk', 0.2);
        TMP_DIR.copy(TMP_TARGET).sub(rig.root.position).normalize();
        rig.root.position.addScaledVector(TMP_DIR, dt * 2.9);
        MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
        TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
        rig.root.quaternion.slerp(TMP_QUAT, dt * 9);
      } else {
        switchAnim('enterPortal', 0.16);
        if (!enteredNotifiedRef.current) {
          enteredNotifiedRef.current = true;
          onEnteredPortal?.(id);
        }
      }
      return;
    }

    // 3. Charging sequence (Press & Hold anticipation): AI characters turn toward portal attentively
    if (gatheringPhase === 'charging' && holdProgress > 0.05) {
      if (isOperational || kind === 'nova') {
        switchAnim(holdProgress > 0.55 ? 'beckon' : 'turn', 0.24);
        TMP_TARGET.set(portalEntryPoint[0], rig.root.position.y, portalEntryPoint[2]);
        MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
        TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
        rig.root.quaternion.slerp(TMP_QUAT, dt * 7);
        rig.materials.statusRing.opacity = 0.36 + holdProgress * 0.45;
      }
      return;
    }

    // 4. Normal Living Autonomous Idle / Patrol / Interact behaviors
    if (interactBoostRef.current > 0) {
      interactBoostRef.current -= dt;
      switchAnim('interact', 0.16);
      return;
    }

    // Error / Warning pulse modulation
    if (status === 'error') {
      rig.materials.eyeGlow.emissiveIntensity =
        1.1 + Math.sin(state.clock.elapsedTime * 7.0) * 0.6;
    } else if (status === 'warning') {
      rig.materials.eyeGlow.emissiveIntensity =
        1.2 + Math.sin(state.clock.elapsedTime * 3.5) * 0.45;
    }

    if (patrolWaypoints.length > 0 && !reducedMotion && (isOperational || kind === 'nova')) {
      const targetArr = patrolWaypoints[waypointIndexRef.current % patrolWaypoints.length];
      TMP_TARGET.set(targetArr[0], targetArr[1], targetArr[2]);
      const dist = rig.root.position.distanceTo(TMP_TARGET);

      if (dist > 0.18) {
        pauseTimerRef.current = 0;
        switchAnim('walk', 0.28);
        TMP_DIR.copy(TMP_TARGET).sub(rig.root.position).normalize();
        const speed = kind === 'nova' ? 1.15 : 0.95;
        rig.root.position.addScaledVector(TMP_DIR, dt * speed);
        MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
        TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
        rig.root.quaternion.slerp(TMP_QUAT, dt * 4.5);
      } else {
        switchAnim('idle', 0.35);
        // Face center slightly while idling
        TMP_TARGET.set(0, rig.root.position.y, -1.0);
        MAT_LOOK.lookAt(TMP_TARGET, rig.root.position, UP_VEC);
        TMP_QUAT.setFromRotationMatrix(MAT_LOOK);
        rig.root.quaternion.slerp(TMP_QUAT, dt * 2.2);

        pauseTimerRef.current += dt;
        if (pauseTimerRef.current > 3.2) {
          pauseTimerRef.current = 0;
          waypointIndexRef.current = (waypointIndexRef.current + 1) % patrolWaypoints.length;
        }
      }
    } else {
      switchAnim('idle', 0.3);
    }
  });

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    interactBoostRef.current = 1.25;
    onSelect?.(id);
  };

  return (
    <group
      onClick={handleClick}
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
      <primitive object={rig.root} />

      <group ref={labelGroupRef}>
        {showLabels && gatheringPhase !== 'entered' && (
          <ProjectedHtml
            position={[0, kind === 'nova' ? 2.15 : 1.98, 0]}
            center
            distanceFactor={15}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={`px-2 py-1 rounded-md text-center whitespace-nowrap border transition-opacity ${
                hovered ? 'opacity-100 scale-105' : 'opacity-90'
              } ${
                status === 'disconnected'
                  ? 'bg-slate-900/75 border-slate-700/60 text-slate-400'
                  : status === 'error'
                    ? 'bg-rose-950/90 border-rose-500/60 text-rose-100'
                    : status === 'warning'
                      ? 'bg-amber-950/90 border-amber-500/60 text-amber-100'
                      : 'bg-[#090E1A]/85 border-slate-700/70 text-slate-100'
              }`}
            >
              <div className="text-[11px] font-display font-semibold leading-tight flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full inline-block ${
                    status === 'operational'
                      ? 'bg-emerald-400'
                      : status === 'connecting'
                        ? 'bg-sky-400'
                        : status === 'warning'
                          ? 'bg-amber-400'
                          : status === 'error'
                            ? 'bg-rose-400'
                            : 'bg-slate-500'
                  }`}
                />
                {label}
              </div>
              {hovered && sublabel && (
                <div className="text-[9px] text-slate-300 mt-0.5">{sublabel}</div>
              )}
            </div>
          </ProjectedHtml>
        )}
      </group>
    </group>
  );
}
