import * as THREE from 'three';

/** Pool of DOM text labels pinned to world positions (HTML text stays crisp on phones). */
export function createLabels(container) {
  const layer = document.createElement('div');
  layer.className = 'labels';
  container.appendChild(layer);
  const pool = [];
  const v3 = new THREE.Vector3();
  let used = 0;

  return {
    begin() {
      used = 0;
    },
    add(text, world, camera, width, height, className = '') {
      v3.set(world.x, world.y ?? 0.1, world.z).project(camera);
      if (v3.z > 1) return;
      let el = pool[used];
      if (!el) {
        el = document.createElement('div');
        pool.push(el);
        layer.appendChild(el);
      }
      used++;
      el.className = `label ${className}`;
      if (el.textContent !== text) el.textContent = text;
      el.style.transform = `translate(${((v3.x + 1) / 2) * width}px, ${((1 - v3.y) / 2) * height}px) translate(-50%, -140%)`;
      el.style.display = '';
    },
    end() {
      for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
    },
  };
}
