import { AnimationClip } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// One parse per file for the whole session. The landing stage, every match and
// a rematch share these promises, so a file is never downloaded or parsed
// twice. Callers must clone what they receive (SkeletonUtils.clone for the
// character, clip.clone() before editing tracks, scene.clone() for venues).
const cache = new Map();
const fbxLoader = new FBXLoader();
// Campus models are meshopt-compressed (tools/strip_glb_extras.mjs, then gltf-transform meshopt).
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

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
// All 29 moves live in one compact file of animation tracks only (made from the
// Mixamo FBX files by tools/build_clips.py): about 1 MB to download instead of
// 36 MB, since every FBX also carries its own copy of the character mesh.
let clipLibrary;
const loadClipLibrary = () => (clipLibrary ||= fetch('/animations/clips.json')
  .then(response => { if (!response.ok) throw new Error(`clips.json ${response.status}`); return response.json(); })
  .catch(error => { clipLibrary = null; throw error; }));
// Resolves like a loaded FBX ({ animations: [clip] }), so callers need not change.
export const loadAnimation = file => once(`clip:${file}`, async () => {
  const library = await loadClipLibrary();
  if (!library[file]) throw new Error(`No animation ${file}`);
  return { animations: [AnimationClip.parse(library[file])] };
});

let manifest;
export const loadVenueManifest = () => (manifest ||= fetch('/campus/manifest.json')
  .then(response => response.ok ? response.json() : {})
  .catch(() => ({})));

// Called from the menus so the match usually opens with everything ready.
export function preloadMatchAssets(venueId) {
  loadPlayerModel().catch(() => {});
  loadClipLibrary().catch(() => {});
  if (venueId) loadVenueManifest().then(entries => {
    if (entries[venueId]?.url) loadGLTF(entries[venueId].url).catch(() => {});
  });
}
