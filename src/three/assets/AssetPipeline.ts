import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AssetSourceKind = 'procedural_rig' | 'gltf_override';

export interface WorldAssetDescriptor {
  id: string;
  label: string;
  category: 'character' | 'monument' | 'city' | 'nature';
  currentSource: AssetSourceKind;
  optionalGlbPath: string;
  notes: string;
}

/**
 * Manifest of all hero 3D assets used in T.U.T AI Council.
 * Every entry works natively via multi-part articulated procedural rigs (zero 404s)
 * and supports drop-in external .glb replacements via loadOptionalGLTF().
 */
export const WORLD_ASSET_MANIFEST: readonly WorldAssetDescriptor[] = [
  {
    id: 'nova_companion',
    label: 'T.U.T AI Nova Companion',
    category: 'character',
    currentSource: 'procedural_rig',
    optionalGlbPath: '/assets/models/nova_companion.glb',
    notes: 'Silver-blue articulated humanoid bot with expressive cyan eyes, violet crest, and AnimationMixer state rig.',
  },
  {
    id: 'provider_characters',
    label: 'Provider AI Avatars (Gemini, OpenAI, Anthropic, Groq, OpenRouter, Cerebras, Mistral)',
    category: 'character',
    currentSource: 'procedural_rig',
    optionalGlbPath: '/assets/models/provider_avatars.glb',
    notes: 'Distinct multi-part silhouettes per provider with idle, walk, turn, beckon, and portal-entry AnimationClips.',
  },
  {
    id: 'council_portal',
    label: 'New Council Gathering Portal',
    category: 'monument',
    currentSource: 'procedural_rig',
    optionalGlbPath: '/assets/models/council_portal.glb',
    notes: 'Sculpted twin-arc monolith arch with rotating rune rings, levitating crystal keystone, and volumetric vortex.',
  },
  {
    id: 'provider_cities',
    label: 'Model Land Provider Cities',
    category: 'city',
    currentSource: 'procedural_rig',
    optionalGlbPath: '/assets/models/provider_cities.glb',
    notes: 'Distinct island cities for Google Gemini, OpenAI, Anthropic, Groq, and workspace hubs with status-reactive buildings.',
  },
  {
    id: 'sanctuary_flora',
    label: 'Instanced Sanctuary Trees & Swaying Flora',
    category: 'nature',
    currentSource: 'procedural_rig',
    optionalGlbPath: '/assets/models/sanctuary_flora.glb',
    notes: 'InstancedMesh multi-tier trees and wind-animated vegetation clusters.',
  },
] as const;

class WorldAssetPipeline {
  private readonly manager = new THREE.LoadingManager();
  private readonly gltfLoader: GLTFLoader;
  private readonly gltfCache = new Map<string, Promise<GLTF>>();
  private readonly clipCache = new Map<string, THREE.AnimationClip>();

  constructor() {
    this.gltfLoader = new GLTFLoader(this.manager);
  }

  /**
   * Loads an optional external GLTF/GLB asset ONLY when explicitly requested.
   * Never invoked speculatively for missing files so runtime logs remain 404-free.
   */
  public loadOptionalGLTF(url: string): Promise<GLTF> {
    const cached = this.gltfCache.get(url);
    if (cached) return cached;
    const promise = new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => {
          this.gltfCache.delete(url);
          reject(err);
        },
      );
    });
    this.gltfCache.set(url, promise);
    return promise;
  }

  public getOrCreateClip(key: string, factory: () => THREE.AnimationClip): THREE.AnimationClip {
    const existing = this.clipCache.get(key);
    if (existing) return existing;
    const clip = factory();
    clip.optimize();
    this.clipCache.set(key, clip);
    return clip;
  }

  /**
   * Grounds any loaded Object3D so its bounding box bottom rests cleanly on y = 0
   * and centered on X/Z, ensuring reliable placement on terrain and plazas.
   */
  public normalizeBottomCenter(object: THREE.Object3D): THREE.Object3D {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return object;
    const center = new THREE.Vector3();
    box.getCenter(center);
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= box.min.y;
    return object;
  }
}

export const assetPipeline = new WorldAssetPipeline();
