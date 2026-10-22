import * as THREE from 'three';

// World-sized colour variation stays visible at the match camera; a separate
// repeating height texture supplies small grass fibres without extra geometry.
const TURF_LENGTH = 160, TURF_WIDTH = 80;

export function createStadiumGrassMaterial(anisotropy = 4) {
  let seed = 240519;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const noise = (columns, rows) => {
    const values = Float32Array.from({ length: (columns + 1) * (rows + 1) }, random);
    return (u, v) => {
      const x = u * columns, y = v * rows, ix = Math.floor(x), iy = Math.floor(y);
      const sx = x - ix, sy = y - iy, fx = sx * sx * (3 - 2 * sx), fy = sy * sy * (3 - 2 * sy);
      const at = (dx, dy) => values[(iy + dy) * (columns + 1) + ix + dx];
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(0, 0), at(1, 0), fx),
        THREE.MathUtils.lerp(at(0, 1), at(1, 1), fx), fy) - .5;
    };
  };
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
  const context = canvas.getContext('2d'), image = context.createImageData(canvas.width, canvas.height);
  const broad = noise(36, 18), clumps = noise(420, 210);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const u = x / canvas.width, v = y / canvas.height;
    const patch = broad(u, v), clump = clumps(u, v), grain = (random() - .5) * 9;
    // Soft mowing bands, with olive/dry blades among the green rather than
    // uniform saturated stripes. Neither texture changes the physical ground.
    const mowing = Math.tanh(Math.sin(u * Math.PI * 40) * 4) * 2;
    const shade = patch * 18 + clump * 19 + grain + mowing, i = (y * canvas.width + x) * 4;
    image.data[i] = 65 + shade + Math.max(0, patch) * 12;
    image.data[i + 1] = 86 + shade;
    image.data[i + 2] = 40 + shade * .65;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const blades = ['rgba(163,154,77,.25)', 'rgba(27,46,18,.24)', 'rgba(126,145,65,.28)'];
  for (let i = 0; i < 150000; i++) {
    context.strokeStyle = blades[i % blades.length]; context.lineWidth = .65;
    const x = random() * canvas.width, y = random() * canvas.height;
    context.beginPath(); context.moveTo(x, y);
    context.lineTo(x + (random() - .5) * 2, y - 1 - random() * 3); context.stroke();
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const fibres = document.createElement('canvas'); fibres.width = fibres.height = 512;
  const bump = fibres.getContext('2d'); bump.fillStyle = '#808080'; bump.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22000; i++) {
    bump.strokeStyle = i % 2 ? '#b5b5b5' : '#505050'; bump.lineWidth = .8;
    const x = random() * 512, y = random() * 512;
    bump.beginPath(); bump.moveTo(x, y); bump.lineTo(x + (random() - .5) * 3, y + 2 + random() * 5); bump.stroke();
  }
  const bumpMap = new THREE.CanvasTexture(fibres);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping; bumpMap.repeat.set(40, 20); bumpMap.anisotropy = anisotropy;
  return new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: .025, roughness: 1, metalness: 0 });
}

export function stadiumGrassUV(x, z) {
  return [x / TURF_LENGTH + .5, z / TURF_WIDTH + .5];
}

// The exported stadium combines turf, seats and track in one vertex-coloured
// mesh. Replace only its horizontal green infield triangles, preserving the
// exact curved edge beside the track and the original y=0 playing surface.
export function textureStadiumGrass(root, material) {
  root.updateMatrixWorld(true);
  const positions = [], uvs = [], owned = [], point = new THREE.Vector3();
  root.traverse(node => {
    if (!node.isMesh || !node.geometry.attributes.color) return;
    const source = node.geometry, p = source.attributes.position, c = source.attributes.color, index = source.index;
    const count = index ? index.count : p.count, vertex = i => index ? index.getX(i) : i, keep = [];
    for (let t = 0; t < count; t += 3) {
      const ids = [vertex(t), vertex(t + 1), vertex(t + 2)];
      const corners = ids.map(i => point.fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld).clone());
      const grass = ids.every(i => c.getY(i) > c.getX(i) * 1.3 && c.getY(i) > c.getZ(i) * 1.3)
        && corners.every(v => Math.abs(v.y) < .15 && Math.abs(v.x) < 80 && Math.abs(v.z) < 40)
        && Math.max(...corners.map(v => v.y)) - Math.min(...corners.map(v => v.y)) < .01;
      if (!grass) { keep.push(...ids); continue; }
      for (const v of corners) { positions.push(v.x, v.y, v.z); uvs.push(...stadiumGrassUV(v.x, v.z)); }
    }
    if (keep.length === count) return;
    node.geometry = source.clone(); node.geometry.setIndex(keep); owned.push(node.geometry);
  });
  if (positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals();
    const turf = new THREE.Mesh(geometry, material); turf.name = 'stadium-natural-grass'; turf.receiveShadow = true;
    turf.applyMatrix4(root.matrixWorld.clone().invert()); root.add(turf); owned.push(geometry);
  }
  return () => owned.forEach(geometry => geometry.dispose());
}
