import { MeshStandardMaterial, Color } from 'three';

// Retain the artist's face, fabric, boot and surface detail. Recolour only
// the kit; flat replacement materials erase all of that detail.
export function playerMaterial(source, { color, cloth = false, roughness = .85 } = {}) {
  const material = new MeshStandardMaterial({
    color: color || source.color || new Color('white'), roughness, metalness: 0,
    map: source.map || null, normalMap: source.normalMap || null,
    normalScale: source.normalScale?.clone(), bumpMap: source.bumpMap || null,
    bumpScale: source.bumpScale ?? 1, alphaMap: source.alphaMap || null,
    transparent: source.transparent, opacity: source.opacity,
    alphaTest: source.alphaTest, side: source.side,
  });
  if (cloth && source.map) {
    // The shared atlas contains a coloured original kit. Preserve its detail
    // as luminance so it does not multiply red into the away team's blue.
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        #ifdef USE_MAP
          float kitDetail = clamp(dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 1.8, 0.0, 1.0);
          diffuseColor.rgb = diffuse * mix(0.72, 1.15, kitDetail);
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'football-kit-luminance-v1';
  }
  return material;
}
