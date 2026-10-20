import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// One parse per file for the whole session. The landing stage, every match and
// a rematch share these promises, so a file is never downloaded or parsed
// twice. Callers must clone what they receive (SkeletonUtils.clone for the
// character, clip.clone() before editing tracks, scene.clone() for venues).
const cache = new Map();
const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();

function once(url, load) {
  if (!cache.has(url)) {
    const promise = load(url);
    // A failed request may succeed later (flaky mobile data), so do not keep it.
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return cache.get(url);
}

export const PLAYER_MODEL_URL = '/models/Ch38_nonPBR.fbx';
export const loadFBX = url => once(url, path => fbxLoader.loadAsync(path));
export const loadGLTF = url => once(url, path => gltfLoader.loadAsync(path));
export const loadPlayerModel = () => loadFBX(PLAYER_MODEL_URL);
export const loadAnimation = file => loadFBX(`/animations/${file}.fbx`);

// Clips needed before kickoff. The rest stream in after the match has started.
export const CORE_ANIMATIONS = ['soccer-idle', 'jog-forward', 'dribble', 'kick-soccerball', 'soccer-pass',
  'receive-soccerball', 'soccer-tackle', 'goalkeeper-idle', 'goalkeeper-sidestep', 'goalkeeper-diving-save',
  'goalkeeper-catch'];

let manifest;
export const loadVenueManifest = () => (manifest ||= fetch('/campus/manifest.json')
  .then(response => response.ok ? response.json() : {})
  .catch(() => ({})));

// Called from the menus so the match usually opens with everything ready.
export function preloadMatchAssets(venueId) {
  loadPlayerModel().catch(() => {});
  for (const file of CORE_ANIMATIONS) loadAnimation(file).catch(() => {});
  if (venueId) loadVenueManifest().then(entries => {
    if (entries[venueId]?.url) loadGLTF(entries[venueId].url).catch(() => {});
  });
}
