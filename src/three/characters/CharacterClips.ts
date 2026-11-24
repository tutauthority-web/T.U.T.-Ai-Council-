import * as THREE from 'three';
import { assetPipeline } from '../assets/AssetPipeline';

export type CharacterAnimState =
  | 'idle'
  | 'walk'
  | 'turn'
  | 'interact'
  | 'beckon'
  | 'enterPortal'
  | 'dormant';

function eulerQuat(x: number, y: number, z: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

export function getCharacterAnimationClips(): Record<CharacterAnimState, THREE.AnimationClip> {
  const idle = assetPipeline.getOrCreateClip('char_idle', () => {
    const times = [0, 1.2, 2.4];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.92, 0,
      0, 0.97, 0,
      0, 0.92, 0,
    ]);
    torsoPos.setInterpolation(THREE.InterpolateSmooth);

    const headRot = new THREE.QuaternionKeyframeTrack('head.quaternion', [0, 0.8, 1.6, 2.4], [
      ...eulerQuat(0.02, -0.06, 0),
      ...eulerQuat(-0.04, 0.08, 0.03),
      ...eulerQuat(0.03, 0.04, -0.02),
      ...eulerQuat(0.02, -0.06, 0),
    ]);

    const leftArm = new THREE.QuaternionKeyframeTrack('leftArm.quaternion', times, [
      ...eulerQuat(0.06, 0, 0.14),
      ...eulerQuat(-0.04, 0, 0.18),
      ...eulerQuat(0.06, 0, 0.14),
    ]);

    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(-0.04, 0, -0.14),
      ...eulerQuat(0.06, 0, -0.18),
      ...eulerQuat(-0.04, 0, -0.14),
    ]);

    const haloRot = new THREE.QuaternionKeyframeTrack('halo.quaternion', [0, 1.2, 2.4], [
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(0.06, Math.PI, 0),
      ...eulerQuat(0, Math.PI * 2, 0),
    ]);

    // Natural eye blink near end of cycle
    const eyeBlink = new THREE.VectorKeyframeTrack(
      'eyes.scale',
      [0, 1.9, 1.98, 2.06, 2.4],
      [
        1, 1, 1,
        1, 1, 1,
        1, 0.12, 1,
        1, 1, 1,
        1, 1, 1,
      ],
    );

    return new THREE.AnimationClip('idle', 2.4, [
      torsoPos,
      headRot,
      leftArm,
      rightArm,
      haloRot,
      eyeBlink,
    ]);
  });

  const walk = assetPipeline.getOrCreateClip('char_walk', () => {
    const times = [0, 0.25, 0.5, 0.75, 1.0];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.92, 0,
      0, 0.99, 0,
      0, 0.92, 0,
      0, 0.99, 0,
      0, 0.92, 0,
    ]);
    const torsoRot = new THREE.QuaternionKeyframeTrack('torso.quaternion', times, [
      ...eulerQuat(0.08, -0.06, 0),
      ...eulerQuat(0.11, 0, 0.03),
      ...eulerQuat(0.08, 0.06, 0),
      ...eulerQuat(0.11, 0, -0.03),
      ...eulerQuat(0.08, -0.06, 0),
    ]);
    const leftLeg = new THREE.QuaternionKeyframeTrack('leftLeg.quaternion', times, [
      ...eulerQuat(0.55, 0, 0),
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(-0.55, 0, 0),
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(0.55, 0, 0),
    ]);
    const rightLeg = new THREE.QuaternionKeyframeTrack('rightLeg.quaternion', times, [
      ...eulerQuat(-0.55, 0, 0),
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(0.55, 0, 0),
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(-0.55, 0, 0),
    ]);
    const leftArm = new THREE.QuaternionKeyframeTrack('leftArm.quaternion', times, [
      ...eulerQuat(-0.48, 0, 0.16),
      ...eulerQuat(0, 0, 0.18),
      ...eulerQuat(0.48, 0, 0.16),
      ...eulerQuat(0, 0, 0.18),
      ...eulerQuat(-0.48, 0, 0.16),
    ]);
    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(0.48, 0, -0.16),
      ...eulerQuat(0, 0, -0.18),
      ...eulerQuat(-0.48, 0, -0.16),
      ...eulerQuat(0, 0, -0.18),
      ...eulerQuat(0.48, 0, -0.16),
    ]);

    return new THREE.AnimationClip('walk', 1.0, [
      torsoPos,
      torsoRot,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
    ]);
  });

  const turn = assetPipeline.getOrCreateClip('char_turn', () => {
    const times = [0, 0.35, 0.7];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.92, 0,
      0, 0.96, 0,
      0, 0.92, 0,
    ]);
    const headRot = new THREE.QuaternionKeyframeTrack('head.quaternion', times, [
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(0.04, 0.35, -0.05),
      ...eulerQuat(0, 0, 0),
    ]);
    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(0, 0, -0.16),
      ...eulerQuat(-0.35, 0, -0.4),
      ...eulerQuat(0, 0, -0.16),
    ]);
    return new THREE.AnimationClip('turn', 0.7, [torsoPos, headRot, rightArm]);
  });

  const interact = assetPipeline.getOrCreateClip('char_interact', () => {
    const times = [0, 0.28, 0.6, 0.95, 1.3];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.92, 0,
      0, 1.12, 0,
      0, 0.96, 0,
      0, 1.04, 0,
      0, 0.92, 0,
    ]);
    const headRot = new THREE.QuaternionKeyframeTrack('head.quaternion', times, [
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(-0.18, 0.12, 0.05),
      ...eulerQuat(0.06, -0.12, -0.05),
      ...eulerQuat(-0.08, 0, 0),
      ...eulerQuat(0, 0, 0),
    ]);
    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(0, 0, -0.15),
      ...eulerQuat(-1.8, 0.2, -0.55),
      ...eulerQuat(-1.45, -0.2, -0.35),
      ...eulerQuat(-1.75, 0.15, -0.5),
      ...eulerQuat(0, 0, -0.15),
    ]);
    const leftArm = new THREE.QuaternionKeyframeTrack('leftArm.quaternion', times, [
      ...eulerQuat(0, 0, 0.15),
      ...eulerQuat(-0.4, 0, 0.45),
      ...eulerQuat(-0.2, 0, 0.28),
      ...eulerQuat(-0.3, 0, 0.35),
      ...eulerQuat(0, 0, 0.15),
    ]);
    return new THREE.AnimationClip('interact', 1.3, [torsoPos, headRot, rightArm, leftArm]);
  });

  const beckon = assetPipeline.getOrCreateClip('char_beckon', () => {
    const times = [0, 0.35, 0.7, 1.05, 1.4];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.94, 0,
      0, 1.04, 0,
      0, 0.98, 0,
      0, 1.04, 0,
      0, 0.94, 0,
    ]);
    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(-0.8, 0, -0.45),
      ...eulerQuat(-2.1, 0.3, -0.5),
      ...eulerQuat(-1.5, -0.1, -0.3),
      ...eulerQuat(-2.1, 0.3, -0.5),
      ...eulerQuat(-0.8, 0, -0.45),
    ]);
    const leftArm = new THREE.QuaternionKeyframeTrack('leftArm.quaternion', times, [
      ...eulerQuat(-0.4, 0, 0.35),
      ...eulerQuat(-0.9, 0, 0.55),
      ...eulerQuat(-0.6, 0, 0.4),
      ...eulerQuat(-0.9, 0, 0.55),
      ...eulerQuat(-0.4, 0, 0.35),
    ]);
    const haloRot = new THREE.QuaternionKeyframeTrack('halo.quaternion', [0, 0.7, 1.4], [
      ...eulerQuat(0, 0, 0),
      ...eulerQuat(0.12, Math.PI, 0),
      ...eulerQuat(0, Math.PI * 2, 0),
    ]);
    return new THREE.AnimationClip('beckon', 1.4, [torsoPos, rightArm, leftArm, haloRot]);
  });

  const enterPortal = assetPipeline.getOrCreateClip('char_enter_portal', () => {
    const times = [0, 0.3, 0.75];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.95, 0,
      0, 1.35, 0,
      0, 1.55, 0,
    ]);
    const torsoScale = new THREE.VectorKeyframeTrack('.scale', times, [
      1, 1, 1,
      1.06, 1.12, 1.06,
      0.04, 0.04, 0.04,
    ]);
    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(-0.4, 0, -0.2),
      ...eulerQuat(-2.4, 0, -0.3),
      ...eulerQuat(-2.8, 0, -0.1),
    ]);
    const leftArm = new THREE.QuaternionKeyframeTrack('leftArm.quaternion', times, [
      ...eulerQuat(-0.4, 0, 0.2),
      ...eulerQuat(-2.4, 0, 0.3),
      ...eulerQuat(-2.8, 0, 0.1),
    ]);
    return new THREE.AnimationClip('enterPortal', 0.75, [
      torsoPos,
      torsoScale,
      rightArm,
      leftArm,
    ]);
  });

  const dormant = assetPipeline.getOrCreateClip('char_dormant', () => {
    const times = [0, 1.5, 3.0];
    const torsoPos = new THREE.VectorKeyframeTrack('torso.position', times, [
      0, 0.78, 0,
      0, 0.76, 0,
      0, 0.78, 0,
    ]);
    const headRot = new THREE.QuaternionKeyframeTrack('head.quaternion', times, [
      ...eulerQuat(0.32, 0, 0),
      ...eulerQuat(0.36, 0.04, 0),
      ...eulerQuat(0.32, 0, 0),
    ]);
    const leftArm = new THREE.QuaternionKeyframeTrack('leftArm.quaternion', times, [
      ...eulerQuat(0.15, 0, 0.06),
      ...eulerQuat(0.18, 0, 0.06),
      ...eulerQuat(0.15, 0, 0.06),
    ]);
    const rightArm = new THREE.QuaternionKeyframeTrack('rightArm.quaternion', times, [
      ...eulerQuat(0.15, 0, -0.06),
      ...eulerQuat(0.18, 0, -0.06),
      ...eulerQuat(0.15, 0, -0.06),
    ]);
    return new THREE.AnimationClip('dormant', 3.0, [torsoPos, headRot, leftArm, rightArm]);
  });

  return {
    idle,
    walk,
    turn,
    interact,
    beckon,
    enterPortal,
    dormant,
  };
}
