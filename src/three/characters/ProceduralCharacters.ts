import * as THREE from 'three';
import type { ProviderId } from '../../shared/providers';
import { createBrushedMetalTexture } from '../core/environmentUtils';

export interface CharacterRigMaterials {
  eyeGlow: THREE.MeshStandardMaterial;
  accentGlow: THREE.MeshStandardMaterial;
  statusRing: THREE.MeshBasicMaterial;
  disposables: Array<{ dispose: () => void }>;
}

export interface ArticulatedCharacterRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group;
  halo: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  materials: CharacterRigMaterials;
}

let cachedMetalTex: THREE.CanvasTexture | null = null;
function getSharedMetalTex(): THREE.CanvasTexture {
  if (!cachedMetalTex) {
    cachedMetalTex = createBrushedMetalTexture();
  }
  return cachedMetalTex;
}

function makeShieldChevronGeometry(w = 0.24, h = 0.28): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, h * 0.5);
  shape.lineTo(w * 0.5, h * 0.15);
  shape.lineTo(w * 0.34, -h * 0.5);
  shape.lineTo(0, -h * 0.22);
  shape.lineTo(-w * 0.34, -h * 0.5);
  shape.lineTo(-w * 0.5, h * 0.15);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

function makeWingFinGeometry(scale = 1): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.38 * scale, 0.52 * scale);
  shape.lineTo(0.24 * scale, 0.62 * scale);
  shape.lineTo(-0.04 * scale, 0.18 * scale);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.035 * scale,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

function enableShadows(group: THREE.Object3D) {
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

/**
 * Builds T.U.T AI Nova:
 * Premium silver-blue robotic companion with expressive glowing cyan eyes,
 * subtle violet T.U.T branding, sculpted contoured armor, and full articulated rig.
 */
export function createNovaCharacterRig(): ArticulatedCharacterRig {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();
  root.name = 'NovaRig';

  const metalTex = getSharedMetalTex();

  const silverBlueMat = track(
    new THREE.MeshPhysicalMaterial({
      color: '#c9d9ee',
      metalness: 0.62,
      roughness: 0.24,
      roughnessMap: metalTex,
      clearcoat: 0.55,
      clearcoatRoughness: 0.18,
    }),
  );

  const slateJointMat = track(
    new THREE.MeshStandardMaterial({
      color: '#1e293b',
      metalness: 0.5,
      roughness: 0.42,
    }),
  );

  const visorGlassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: '#071124',
      metalness: 0.25,
      roughness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    }),
  );

  const eyeGlow = track(
    new THREE.MeshStandardMaterial({
      color: '#67e8f9',
      emissive: '#38bdf8',
      emissiveIntensity: 2.2,
      roughness: 0.15,
    }),
  );

  const accentGlow = track(
    new THREE.MeshStandardMaterial({
      color: '#a78bfa',
      emissive: '#7c3aed',
      emissiveIntensity: 1.55,
      roughness: 0.2,
      metalness: 0.2,
    }),
  );

  const statusRingMat = track(
    new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    }),
  );

  // Ground contact halo ring
  const ringGeo = track(new THREE.RingGeometry(0.46, 0.56, 36));
  const ringMesh = new THREE.Mesh(ringGeo, statusRingMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.015;
  root.add(ringMesh);

  // Torso group (pivoted around waist height 0.92)
  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.set(0, 0.92, 0);
  root.add(torso);

  // Sculpted Lathe chassis profile
  const lathePoints = [
    new THREE.Vector2(0.01, -0.26),
    new THREE.Vector2(0.20, -0.22),
    new THREE.Vector2(0.32, 0.04),
    new THREE.Vector2(0.35, 0.24),
    new THREE.Vector2(0.24, 0.34),
    new THREE.Vector2(0.11, 0.38),
    new THREE.Vector2(0.01, 0.38),
  ];
  const chestGeo = track(new THREE.LatheGeometry(lathePoints, 28));
  const chestMesh = new THREE.Mesh(chestGeo, silverBlueMat);
  chestMesh.scale.set(1.06, 1, 0.84);
  torso.add(chestMesh);

  // Collar + Violet T.U.T Crest on chest
  const collarGeo = track(new THREE.TorusGeometry(0.21, 0.032, 12, 32));
  const collarMesh = new THREE.Mesh(collarGeo, slateJointMat);
  collarMesh.rotation.x = Math.PI / 2;
  collarMesh.position.y = 0.34;
  torso.add(collarMesh);

  const crestGeo = track(makeShieldChevronGeometry(0.22, 0.24));
  const crestMesh = new THREE.Mesh(crestGeo, accentGlow);
  crestMesh.position.set(0, 0.14, 0.295);
  torso.add(crestMesh);

  // Dorsal twin stabilizer fins
  const finGeo = track(makeWingFinGeometry(0.65));
  const finL = new THREE.Mesh(finGeo, silverBlueMat);
  finL.position.set(-0.24, 0.14, -0.24);
  finL.rotation.set(-0.2, -0.35, 0.25);
  torso.add(finL);
  const finR = new THREE.Mesh(finGeo, silverBlueMat);
  finR.position.set(0.24, 0.14, -0.24);
  finR.rotation.set(-0.2, 0.35, -0.25);
  finR.scale.x = -1;
  torso.add(finR);

  // Head group
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.56, 0);
  torso.add(head);

  // Neck joint
  const neckGeo = track(new THREE.CylinderGeometry(0.085, 0.105, 0.14, 16));
  const neckMesh = new THREE.Mesh(neckGeo, slateJointMat);
  neckMesh.position.y = -0.14;
  head.add(neckMesh);

  // Sculpted helmet dome
  const helmetGeo = track(new THREE.SphereGeometry(0.32, 28, 22));
  const helmetMesh = new THREE.Mesh(helmetGeo, silverBlueMat);
  helmetMesh.scale.set(1.08, 0.92, 1.0);
  head.add(helmetMesh);

  // Curved dark glass visor faceplate
  const visorGeo = track(
    new THREE.SphereGeometry(0.305, 24, 18, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.28, Math.PI * 0.44),
  );
  const visorMesh = new THREE.Mesh(visorGeo, visorGlassMat);
  visorMesh.rotation.y = Math.PI / 2 - Math.PI * 0.0; // orient +Z forward
  // Sphere phi=0 is +X; rotate so center faces +Z
  visorMesh.rotation.y = -Math.PI / 2;
  visorMesh.position.z = 0.025;
  visorMesh.scale.set(1.02, 0.94, 1.08);
  head.add(visorMesh);

  // Expressive Cyan Eyes Group (targeted by AnimationClip for blinks!)
  const eyes = new THREE.Group();
  eyes.name = 'eyes';
  eyes.position.set(0, 0.01, 0.305);
  head.add(eyes);

  const eyeGeo = track(new THREE.CapsuleGeometry(0.036, 0.045, 6, 12));
  const eyeLeft = new THREE.Mesh(eyeGeo, eyeGlow);
  eyeLeft.position.set(-0.105, 0, -0.01);
  eyeLeft.rotation.z = 0.08;
  eyes.add(eyeLeft);

  const eyeRight = new THREE.Mesh(eyeGeo, eyeGlow);
  eyeRight.position.set(0.105, 0, -0.01);
  eyeRight.rotation.z = -0.08;
  eyes.add(eyeRight);

  // Ear sensor pods with violet rim
  const earGeo = track(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 18));
  const earRingGeo = track(new THREE.TorusGeometry(0.085, 0.015, 8, 20));
  [-1, 1].forEach((side) => {
    const ear = new THREE.Mesh(earGeo, slateJointMat);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.34, 0, 0);
    head.add(ear);

    const earRing = new THREE.Mesh(earRingGeo, accentGlow);
    earRing.rotation.y = Math.PI / 2;
    earRing.position.set(side * 0.372, 0, 0);
    head.add(earRing);
  });

  // Floating T.U.T Halo Crown
  const halo = new THREE.Group();
  halo.name = 'halo';
  halo.position.set(0, 0.41, -0.02);
  head.add(halo);

  const haloTorusGeo = track(new THREE.TorusGeometry(0.24, 0.016, 10, 36));
  const haloMesh = new THREE.Mesh(haloTorusGeo, accentGlow);
  haloMesh.rotation.x = Math.PI / 2;
  halo.add(haloMesh);

  const gemGeo = track(new THREE.OctahedronGeometry(0.045, 0));
  const gemMesh = new THREE.Mesh(gemGeo, eyeGlow);
  gemMesh.position.set(0, 0.04, 0.24);
  halo.add(gemMesh);

  // Articulated Arms
  const shoulderGeo = track(new THREE.SphereGeometry(0.082, 14, 14));
  const upperArmGeo = track(new THREE.CapsuleGeometry(0.056, 0.18, 6, 12));
  const cuffGeo = track(new THREE.TorusGeometry(0.072, 0.014, 8, 18));
  const handGeo = track(new THREE.SphereGeometry(0.062, 14, 14));

  const buildArm = (name: string, xOffset: number) => {
    const arm = new THREE.Group();
    arm.name = name;
    arm.position.set(xOffset, 0.26, 0);
    arm.add(new THREE.Mesh(shoulderGeo, slateJointMat));

    const forearm = new THREE.Mesh(upperArmGeo, silverBlueMat);
    forearm.position.y = -0.19;
    arm.add(forearm);

    const cuff = new THREE.Mesh(cuffGeo, eyeGlow);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.28;
    arm.add(cuff);

    const hand = new THREE.Mesh(handGeo, slateJointMat);
    hand.position.y = -0.35;
    arm.add(hand);
    return arm;
  };

  const leftArm = buildArm('leftArm', -0.41);
  const rightArm = buildArm('rightArm', 0.41);
  torso.add(leftArm, rightArm);

  // Articulated Legs
  const hipGeo = track(new THREE.SphereGeometry(0.072, 12, 12));
  const legGeo = track(new THREE.CapsuleGeometry(0.068, 0.34, 6, 14));
  const footGeo = track(new THREE.CylinderGeometry(0.085, 0.115, 0.09, 18));

  const buildLeg = (name: string, xOffset: number) => {
    const leg = new THREE.Group();
    leg.name = name;
    leg.position.set(xOffset, -0.24, 0);
    leg.add(new THREE.Mesh(hipGeo, slateJointMat));

    const shin = new THREE.Mesh(legGeo, silverBlueMat);
    shin.position.y = -0.26;
    leg.add(shin);

    const boot = new THREE.Mesh(footGeo, slateJointMat);
    boot.position.set(0, -0.58, 0.03);
    boot.scale.set(1, 1, 1.35);
    leg.add(boot);
    return leg;
  };

  const leftLeg = buildLeg('leftLeg', -0.15);
  const rightLeg = buildLeg('rightLeg', 0.15);
  torso.add(leftLeg, rightLeg);

  enableShadows(root);

  return {
    root,
    torso,
    head,
    eyes,
    halo,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    materials: {
      eyeGlow,
      accentGlow,
      statusRing: statusRingMat,
      disposables,
    },
  };
}

interface ProviderRigTheme {
  primaryColor: string;
  trimColor: string;
  accentHex: string;
  headShape: 'twin_star' | 'geodesic' | 'astrolabe' | 'aero_fin' | 'router' | 'crystal' | 'glider';
}

const PROVIDER_RIG_THEMES: Record<ProviderId, ProviderRigTheme> = {
  google: {
    primaryColor: '#e2ecff',
    trimColor: '#1e3a8a',
    accentHex: '#7aa7ff',
    headShape: 'twin_star',
  },
  openai: {
    primaryColor: '#e9f7f2',
    trimColor: '#0f3d33',
    accentHex: '#4fd1a5',
    headShape: 'geodesic',
  },
  anthropic: {
    primaryColor: '#f5e6cf',
    trimColor: '#5c3614',
    accentHex: '#f5b762',
    headShape: 'astrolabe',
  },
  groq: {
    primaryColor: '#242938',
    trimColor: '#7c2d12',
    accentHex: '#f55036',
    headShape: 'aero_fin',
  },
  openrouter: {
    primaryColor: '#e9e2fb',
    trimColor: '#3b2466',
    accentHex: '#b794f4',
    headShape: 'router',
  },
  cerebras: {
    primaryColor: '#dff7fa',
    trimColor: '#134e5e',
    accentHex: '#5ce1e6',
    headShape: 'crystal',
  },
  mistral: {
    primaryColor: '#e3e8ff',
    trimColor: '#272c6b',
    accentHex: '#818cf8',
    headShape: 'glider',
  },
  nvidia: {
    primaryColor: '#1f261d',
    trimColor: '#365314',
    accentHex: '#76b900',
    headShape: 'aero_fin',
  },
  sambanova: {
    primaryColor: '#fff1eb',
    trimColor: '#7c2d12',
    accentHex: '#ff6b35',
    headShape: 'crystal',
  },
  huggingface: {
    primaryColor: '#fef9c3',
    trimColor: '#854d0e',
    accentHex: '#facc15',
    headShape: 'router',
  },
  together: {
    primaryColor: '#e0f2fe',
    trimColor: '#075985',
    accentHex: '#38bdf8',
    headShape: 'astrolabe',
  },
  cohere: {
    primaryColor: '#d9fbf3',
    trimColor: '#134e4a',
    accentHex: '#39d9b8',
    headShape: 'geodesic',
  },
};

/**
 * Builds a distinctive multi-part articulated character rig per AI provider.
 */
export function createProviderCharacterRig(providerId: ProviderId): ArticulatedCharacterRig {
  const theme = PROVIDER_RIG_THEMES[providerId];
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const root = new THREE.Group();
  root.name = `ProviderRig_${providerId}`;

  const metalTex = getSharedMetalTex();
  const bodyMat = track(
    new THREE.MeshPhysicalMaterial({
      color: theme.primaryColor,
      metalness: providerId === 'groq' ? 0.68 : 0.42,
      roughness: 0.28,
      roughnessMap: metalTex,
      clearcoat: 0.45,
      clearcoatRoughness: 0.2,
    }),
  );
  const trimMat = track(
    new THREE.MeshStandardMaterial({
      color: theme.trimColor,
      metalness: 0.45,
      roughness: 0.38,
    }),
  );
  const visorMat = track(
    new THREE.MeshPhysicalMaterial({
      color: '#090e1a',
      roughness: 0.1,
      metalness: 0.25,
      clearcoat: 0.9,
    }),
  );
  const eyeGlow = track(
    new THREE.MeshStandardMaterial({
      color: theme.accentHex,
      emissive: theme.accentHex,
      emissiveIntensity: 1.9,
      roughness: 0.2,
    }),
  );
  const accentGlow = track(
    new THREE.MeshStandardMaterial({
      color: theme.accentHex,
      emissive: theme.accentHex,
      emissiveIntensity: 1.45,
      roughness: 0.25,
    }),
  );
  const statusRingMat = track(
    new THREE.MeshBasicMaterial({
      color: theme.accentHex,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
    }),
  );

  // Ground contact halo
  const ringGeo = track(new THREE.RingGeometry(0.4, 0.49, 32));
  const ringMesh = new THREE.Mesh(ringGeo, statusRingMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.015;
  root.add(ringMesh);

  // Articulated Torso
  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.set(0, 0.88, 0);
  root.add(torso);

  const torsoLathe = track(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.01, -0.22),
        new THREE.Vector2(0.18, -0.18),
        new THREE.Vector2(0.28, 0.05),
        new THREE.Vector2(0.30, 0.22),
        new THREE.Vector2(0.20, 0.31),
        new THREE.Vector2(0.01, 0.32),
      ],
      providerId === 'openai' ? 6 : 20,
    ),
  );
  const chest = new THREE.Mesh(torsoLathe, bodyMat);
  chest.scale.set(1, 1, 0.86);
  torso.add(chest);

  // Chest insignia core
  const coreGeo = track(
    providerId === 'anthropic'
      ? new THREE.OctahedronGeometry(0.095, 0)
      : providerId === 'groq'
        ? makeShieldChevronGeometry(0.19, 0.22)
        : new THREE.CylinderGeometry(0.085, 0.085, 0.05, 6),
  );
  const coreMesh = new THREE.Mesh(coreGeo, accentGlow);
  if (providerId !== 'groq' && providerId !== 'anthropic') {
    coreMesh.rotation.x = Math.PI / 2;
  }
  coreMesh.position.set(0, 0.1, 0.26);
  torso.add(coreMesh);

  // Shoulder pauldrons tailored per provider
  const shoulderGeo = track(new THREE.CapsuleGeometry(0.075, 0.08, 4, 10));
  [-1, 1].forEach((side) => {
    const pauldron = new THREE.Mesh(shoulderGeo, trimMat);
    pauldron.position.set(side * 0.31, 0.24, 0);
    pauldron.rotation.z = side * -0.45;
    torso.add(pauldron);
  });

  // Groq aerodynamic fins or Mistral glider wings
  if (providerId === 'groq' || providerId === 'mistral') {
    const finGeo = track(makeWingFinGeometry(providerId === 'groq' ? 0.85 : 0.72));
    const finL = new THREE.Mesh(finGeo, accentGlow);
    finL.position.set(-0.22, 0.14, -0.22);
    finL.rotation.set(-0.35, -0.4, 0.28);
    const finR = new THREE.Mesh(finGeo, accentGlow);
    finR.position.set(0.22, 0.14, -0.22);
    finR.rotation.set(-0.35, 0.4, -0.28);
    finR.scale.x = -1;
    torso.add(finL, finR);
  }

  // Head
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.5, 0);
  torso.add(head);

  const neck = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.075, 0.095, 0.12, 14)),
    trimMat,
  );
  neck.position.y = -0.12;
  head.add(neck);

  const skullGeo = track(
    theme.headShape === 'geodesic'
      ? new THREE.IcosahedronGeometry(0.26, 1)
      : theme.headShape === 'crystal'
        ? new THREE.OctahedronGeometry(0.27, 1)
        : new THREE.SphereGeometry(0.26, 22, 18),
  );
  const skull = new THREE.Mesh(skullGeo, bodyMat);
  skull.scale.set(1.04, 0.95, 1.0);
  head.add(skull);

  // Dark visor face plate
  const visorPlate = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.32, 0.15, 0.12)),
    visorMat,
  );
  visorPlate.position.set(0, 0, 0.2);
  head.add(visorPlate);

  // Expressive Eyes Group
  const eyes = new THREE.Group();
  eyes.name = 'eyes';
  eyes.position.set(0, 0.01, 0.265);
  head.add(eyes);

  const eyeShapeGeo = track(
    providerId === 'groq'
      ? new THREE.BoxGeometry(0.075, 0.036, 0.02)
      : new THREE.SphereGeometry(0.038, 12, 12),
  );
  const eyeL = new THREE.Mesh(eyeShapeGeo, eyeGlow);
  eyeL.position.set(-0.08, 0, 0);
  if (providerId === 'groq') eyeL.rotation.z = -0.18;
  const eyeR = new THREE.Mesh(eyeShapeGeo, eyeGlow);
  eyeR.position.set(0.08, 0, 0);
  if (providerId === 'groq') eyeR.rotation.z = 0.18;
  eyes.add(eyeL, eyeR);

  // Halo / Provider Crown Motif
  const halo = new THREE.Group();
  halo.name = 'halo';
  halo.position.set(0, 0.36, 0);
  head.add(halo);

  if (theme.headShape === 'twin_star') {
    const starGeo = track(new THREE.OctahedronGeometry(0.07, 0));
    const s1 = new THREE.Mesh(starGeo, accentGlow);
    s1.position.set(-0.14, 0.04, 0);
    s1.scale.set(0.7, 1.4, 0.7);
    const s2 = new THREE.Mesh(starGeo, accentGlow);
    s2.position.set(0.14, 0.04, 0);
    s2.scale.set(0.55, 1.1, 0.55);
    halo.add(s1, s2);
  } else if (theme.headShape === 'geodesic' || theme.headShape === 'astrolabe') {
    const orbit = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.21, 0.015, 8, 28)),
      accentGlow,
    );
    orbit.rotation.x = Math.PI / 2.4;
    halo.add(orbit);
    if (theme.headShape === 'astrolabe') {
      const orbit2 = new THREE.Mesh(
        track(new THREE.TorusGeometry(0.17, 0.012, 8, 24)),
        trimMat,
      );
      orbit2.rotation.y = Math.PI / 3;
      halo.add(orbit2);
    }
  } else if (theme.headShape === 'aero_fin') {
    const bolt = new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.18, 4)), accentGlow);
    bolt.rotation.x = -0.35;
    bolt.position.y = 0.04;
    halo.add(bolt);
  } else {
    const triRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.18, 0.014, 8, 6)),
      accentGlow,
    );
    triRing.rotation.x = Math.PI / 2;
    halo.add(triRing);
  }

  // Arms
  const armGeo = track(new THREE.CapsuleGeometry(0.048, 0.19, 4, 10));
  const handGeo = track(new THREE.SphereGeometry(0.052, 10, 10));
  const buildArm = (name: string, x: number) => {
    const arm = new THREE.Group();
    arm.name = name;
    arm.position.set(x, 0.22, 0);
    const limb = new THREE.Mesh(armGeo, bodyMat);
    limb.position.y = -0.15;
    const hand = new THREE.Mesh(handGeo, trimMat);
    hand.position.y = -0.30;
    arm.add(limb, hand);
    return arm;
  };
  const leftArm = buildArm('leftArm', -0.34);
  const rightArm = buildArm('rightArm', 0.34);
  torso.add(leftArm, rightArm);

  // Legs
  const legGeo = track(new THREE.CapsuleGeometry(0.056, 0.30, 4, 10));
  const bootGeo = track(new THREE.BoxGeometry(0.12, 0.08, 0.18));
  const buildLeg = (name: string, x: number) => {
    const leg = new THREE.Group();
    leg.name = name;
    leg.position.set(x, -0.22, 0);
    const shin = new THREE.Mesh(legGeo, trimMat);
    shin.position.y = -0.24;
    const boot = new THREE.Mesh(bootGeo, bodyMat);
    boot.position.set(0, -0.52, 0.03);
    leg.add(shin, boot);
    return leg;
  };
  const leftLeg = buildLeg('leftLeg', -0.13);
  const rightLeg = buildLeg('rightLeg', 0.13);
  torso.add(leftLeg, rightLeg);

  enableShadows(root);

  return {
    root,
    torso,
    head,
    eyes,
    halo,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    materials: {
      eyeGlow,
      accentGlow,
      statusRing: statusRingMat,
      disposables,
    },
  };
}
