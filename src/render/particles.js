import * as THREE from 'three';

/**
 * Camera-facing particles drawn as one instanced quad mesh per system (one draw call),
 * with per-particle size, colour, alpha and spin. Billboards rather than GL points so
 * big smoke puffs aren't clipped by the GPU's maximum point size (511 px on iPhones).
 */

const vertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor; // rgb + alpha
  attribute vec2 iSize;  // size, rotation
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iSize.y);
    float s = sin(iSize.y);
    vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    mv.xy += p * iSize.x;
    gl_Position = projectionMatrix * mv;
  }`;
const fragment = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.004) discard;
  }`;

/** Soft round dot: fire, sparks, glows. */
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Lumpy puff: smoke and dust (several overlapping soft blobs). */
export function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let seed = 9;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 30;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const rad = 18 + rand() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const shade = 200 + rand() * 55;
    grad.addColorStop(0, `rgba(${shade},${shade},${shade},0.35)`);
    grad.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

/**
 * @param opts { max, additive, map, renderOrder }
 * Particles: { x,y,z, vx,vy,vz, gravity, drag, life, size0, size1, color0 (THREE.Color), color1, alpha0, alpha1, spin, floor }
 */
export function createParticleSystem(scene, { max = 512, additive = false, map, renderOrder = 5 } = {}) {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const siz = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iPos', pos);
  geometry.setAttribute('iColor', col);
  geometry.setAttribute('iSize', siz);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { map: { value: map } },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  scene.add(mesh);

  const list = [];
  const c = new THREE.Color();

  function spawn(p) {
    if (list.length >= max) list.shift();
    list.push({
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      drag: 0,
      size1: p.size0,
      color1: p.color0,
      alpha0: 1,
      alpha1: 0,
      spin: 0,
      rot: Math.random() * Math.PI * 2,
      age: 0,
      floor: -Infinity,
      ...p,
    });
  }

  function update(dt) {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) {
        list.splice(i, 1);
        continue;
      }
    }
    for (const p of list) {
      const t = p.age / p.life;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floor) {
        // Settle on the ground (casings, debris).
        p.y = p.floor;
        p.vy *= -0.25;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      p.rot += p.spin * dt;
      pos.array[n * 3] = p.x;
      pos.array[n * 3 + 1] = p.y;
      pos.array[n * 3 + 2] = p.z;
      c.copy(p.color0).lerp(p.color1, t);
      col.array[n * 4] = c.r;
      col.array[n * 4 + 1] = c.g;
      col.array[n * 4 + 2] = c.b;
      col.array[n * 4 + 3] = p.alpha0 + (p.alpha1 - p.alpha0) * t;
      siz.array[n * 2] = p.size0 + (p.size1 - p.size0) * t;
      siz.array[n * 2 + 1] = p.rot;
      n++;
    }
    geometry.instanceCount = n;
    pos.needsUpdate = col.needsUpdate = siz.needsUpdate = true;
  }

  function clear() {
    list.length = 0;
    geometry.instanceCount = 0;
  }

  function dispose() {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { spawn, update, clear, dispose, mesh };
}
