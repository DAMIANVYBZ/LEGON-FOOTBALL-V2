import * as THREE from 'three';
import { stadiumGrassUV } from './stadiumGrass.js';

function seeded(seed) {
  let value = seed;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

function surfaceTexture(venue) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 384;
  const context = canvas.getContext('2d');
  const random = seeded([...venue.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 41));
  const colors = {
    astro: ['#197b2e', '#248a36', '#399346'],
    grass: ['#42783d', '#4c8545', '#578d4e'],
    mixed: ['#6b7750', '#807659', '#8a7458'],
    worn: ['#78664c', '#847050', '#776c50'],
    soil: ['#a16642', '#a76b47', '#b0744d'],
  }[venue.surface];
  context.fillStyle = colors[0]; context.fillRect(0, 0, 512, 384);
  for (let stripe = 0; stripe < 10; stripe++) {
    context.fillStyle = colors[stripe % 2 ? 1 : 0];
    context.fillRect(stripe * 51.2, 0, 51.3, 384);
  }
  if (venue.surface === 'mixed' || venue.surface === 'worn') {
    const patches = venue.surface === 'worn' ? 140 : 100;
    for (let i = 0; i < patches; i++) {
      const x = random() * 512, y = random() * 384;
      context.fillStyle = random() > 0.45 ? 'rgba(153,93,59,.22)' : 'rgba(45,105,55,.23)';
      context.beginPath(); context.ellipse(x, y, 8 + random() * 36, 4 + random() * 22, random(), 0, Math.PI * 2); context.fill();
    }
  }
  for (let i = 0; i < 2500; i++) {
    context.fillStyle = random() > 0.5 ? 'rgba(10,40,20,.075)' : 'rgba(255,238,179,.09)';
    context.fillRect(random() * 512, random() * 384, 1 + random() * 3, 1 + random() * 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildVenueScene({ scene, venue, box, material, stadiumGrass }) {
  const { length, width } = venue;
  const soil = venue.surface === 'soil' || venue.surface === 'worn';
  const ground = soil ? '#956b4d' : venue.kind === 'stadium' ? '#546d57' : '#677c55';
  box(length + 160, 0.24, width + 150, ground, 0, -0.22, 0);
  const geometry = new THREE.PlaneGeometry(length, width);
  if (stadiumGrass) {
    const uv = geometry.attributes.uv, position = geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ...stadiumGrassUV(position.getX(i), -position.getY(i)));
  }
  const pitch = new THREE.Mesh(geometry, stadiumGrass || new THREE.MeshStandardMaterial({ map: surfaceTexture(venue), roughness: 1 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0; pitch.receiveShadow = true; scene.add(pitch);

  function tree(x, z, scale = 1) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18 * scale, .28 * scale, 3.7 * scale, 6), material('#654934'));
    trunk.position.set(x, 1.7 * scale, z); trunk.castShadow = true; scene.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2 * scale, 0), material('#254f36'));
    crown.position.set(x, 4.2 * scale, z); crown.castShadow = true; scene.add(crown);
  }

  function coveredStand(x, z, span, color = '#183c30') {
    box(span + 2, .28, 8.5, '#a8ada8', x, .1, z);
    for (let tier = 0; tier < 5; tier++) {
      const tierZ = z - 3.1 + tier * 1.35;
      box(span, .5, 1.35, tier % 2 ? '#d6dad4' : color, x, .5 + tier * .36, tierZ);
      for (let seat = -Math.floor(span / 1.6) / 2; seat <= Math.floor(span / 1.6) / 2; seat++) {
        if ((seat + tier) % 4 === 0) box(.9, .3, .75, '#f5f2e9', x + seat * 1.6, .82 + tier * .36, tierZ);
      }
    }
    for (const postX of [x - span / 2, x + span / 2]) box(.18, 4.5, .18, '#dfe2df', postX, 2.25, z - 3.3);
    box(span + 2, .28, 11, '#45564c', x, 4.55, z);
  }

  function fence(pitchLength, pitchWidth) {
    for (let x = -pitchLength / 2 - 2; x <= pitchLength / 2 + 2; x += 7) {
      for (const z of [-pitchWidth / 2 - 2, pitchWidth / 2 + 2]) box(.1, 4.2, .1, '#3a5149', x, 2.1, z);
    }
    for (let z = -pitchWidth / 2 - 2; z <= pitchWidth / 2 + 2; z += 7) {
      for (const x of [-pitchLength / 2 - 2, pitchLength / 2 + 2]) box(.1, 4.2, .1, '#3a5149', x, 2.1, z);
    }
    for (const z of [-pitchWidth / 2 - 2, pitchWidth / 2 + 2]) {
      box(pitchLength + 4, .07, .07, '#9eb0a8', 0, 4.2, z);
      box(pitchLength + 4, .04, .04, '#9eb0a8', 0, 2.1, z);
    }
    for (const x of [-pitchLength / 2 - 2, pitchLength / 2 + 2]) box(.07, .07, pitchWidth + 4, '#9eb0a8', x, 4.2, 0);
  }

  function ovalBand(inner, outer, y, color, xRadius, zRadius) {
    const geometry = new THREE.RingGeometry(inner, outer, 96);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
    mesh.scale.set(xRadius, 1, zRadius); mesh.position.y = y; mesh.receiveShadow = true; scene.add(mesh);
  }

  function sideCourt(x, z, kind) {
    const blue = kind === 'basketball' ? '#387bb5' : '#317593';
    box(23, .08, 13, blue, x, -.02, z);
    box(23, .025, .12, '#e8eee9', x, .04, z - 6.4);
    box(23, .025, .12, '#e8eee9', x, .04, z + 6.4);
    for (const edge of [-11.4, 11.4]) box(.12, .025, 13, '#e8eee9', x + edge, .04, z);
    box(.1, .025, 13, '#e8eee9', x, .04, z);
    if (kind === 'tennis') box(.08, 1.2, 13, '#d9e4df', x, .65, z);
    else for (const hoop of [-9.7, 9.7]) {
      box(.13, 3, .13, '#dce7df', x + hoop, 1.5, z);
      box(.12, 1.1, 1.5, '#e8eee9', x + hoop, 3, z);
    }
  }

  function neighborField(x, z, tint) {
    box(68, .06, 43, '#8d674c', x, -.06, z);
    box(63, .07, 39, tint, x, -.02, z);
    box(63, .025, .12, '#eef0e5', x, .03, z - 19.2);
    box(63, .025, .12, '#eef0e5', x, .03, z + 19.2);
    for (const edge of [-31, 31]) box(.12, .025, 39, '#eef0e5', x + edge, .03, z);
    box(.12, .025, 39, '#eef0e5', x, .03, z);
  }

  const random = seeded(length * 13 + width * 7);
  if (venue.kind === 'stadium') {
    ovalBand(1, 1.16, -.04, '#3a68a4', length / 2 + 5, width / 2 + 5);
    for (let lane = 0; lane < 4; lane++) ovalBand(1 + lane * .037, 1 + lane * .039, .005, '#9bbce0', length / 2 + 5, width / 2 + 5);
    for (let tier = 0; tier < 9; tier++) ovalBand(1.25 + tier * .036, 1.28 + tier * .036, .22 + tier * .46, tier % 2 ? '#89959c' : '#687c85', length / 2 + 5, width / 2 + 5);
    coveredStand(0, -width / 2 - 19, 67, '#295c58');
    coveredStand(0, width / 2 + 19, 67, '#295c58');
    for (const x of [-length / 2 - 27, length / 2 + 27]) for (const z of [-width / 2 - 24, width / 2 + 24]) {
      box(.35, 23, .35, '#e2e5e1', x, 11.5, z);
      box(4, .3, 1.7, '#eff0e9', x, 23, z);
    }
    for (let i = 0; i < 18; i++) box(2.1, .04, 4, '#d0d0c8', length / 2 + 40 + (i % 3) * 3.6, -.07, -38 + Math.floor(i / 3) * 12);
  } else if (venue.kind === 'oval') {
    ovalBand(1, 1.14, -.04, '#9e785f', length / 2 + 3, width / 2 + 3);
    for (let lane = 0; lane < 3; lane++) ovalBand(1 + lane * .04, 1 + lane * .042, .005, '#d4c8b5', length / 2 + 3, width / 2 + 3);
    sideCourt(-length / 2 - 34, -11, 'tennis');
    sideCourt(length / 2 + 34, -10, 'basketball');
    sideCourt(length / 2 + 34, 10, 'basketball');
    coveredStand(0, -width / 2 - 16, 28);
  } else if (venue.kind === 'astro') {
    box(length + 12, .06, width + 12, '#ae8053', 0, -.12, 0);
    fence(length, width);
    coveredStand(0, -width / 2 - 9, 23, '#1b493b');
  } else if (venue.kind === 'nania') {
    box(length + 22, .04, width + 22, '#9e6f4d', 0, -.13, 0);
    neighborField(-length - 35, 16, '#4f8551');
    neighborField(length + 35, -12, '#6f8e53');
    coveredStand(0, -width / 2 - 10, venue.field === 'main' ? 37 : 23);
    if (venue.field === 'main') box(28, 3.6, 6, '#8a3734', -length / 2 - 20, 1.8, 0);
  } else {
    coveredStand(0, -width / 2 - 9, venue.kind === 'park' ? 25 : 20);
    if (venue.id === 'sarbah') {
      box(2.5, .05, width + 20, '#a87552', -length / 2 - 7, -.09, 0);
      box(length + 15, .05, 2.5, '#a87552', 0, -.09, width / 2 + 7);
    }
    if (venue.id === 'gonja') box(9, 3, 5, '#ece5d8', -length / 2 - 13, 1.5, width / 2 + 10);
  }

  const treeCount = venue.kind === 'stadium' ? 10 : venue.kind === 'astro' ? 12 : 30;
  for (let i = 0; i < treeCount; i++) {
    const side = i % 2 ? 1 : -1;
    const x = i % 3 ? (random() - .5) * (length + 55) : side * (length / 2 + 24 + random() * 19);
    const z = i % 3 ? side * (width / 2 + 21 + random() * 20) : (random() - .5) * (width + 70);
    tree(x, z, .8 + random() * .65);
  }
}
