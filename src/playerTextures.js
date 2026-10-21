import { LoadingManager, Texture, TextureLoader } from 'three';

// This FBX export refers to its creator's local .fbm folder, but those images
// are not in the repository. Don't request private export-machine file paths.
// Embedded images and supplied public/remote textures still use the real loader.
export class ExportTextureLoader extends TextureLoader {
  load(url, onLoad, onProgress, onError) {
    if (/\/home\/app\/mixamo-mini\/tmp\/skins_[^/]+\.fbm\/Ch38_100[12]_[^/]+\.png$/i.test(url)) {
      const texture = new Texture();
      texture.userData.missingExportSource = true;
      return texture;
    }
    return super.load(url, onLoad, onProgress, onError);
  }
}

export function playerTextureManager() {
  const manager = new LoadingManager();
  manager.addHandler(/\.png$/i, new ExportTextureLoader(manager));
  return manager;
}

export function removeMissingExportTextures(model) {
  model.traverse(part => {
    if (!part.isMesh) return;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      for (const [key, value] of Object.entries(material)) {
        if (!value?.isTexture || !value.userData.missingExportSource) continue;
        material[key] = null;
        material.userData.missingExportTextures = true;
      }
    }
  });
  return model;
}
