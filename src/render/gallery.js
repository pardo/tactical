import * as THREE from 'three';
import { createSoldierModel } from './soldierModel.js';
import { TEAM_COLORS } from './soldierView.js';

// Dev-only model viewer (gallery.html): one soldier, three-quarter view, for screenshots.
const q = new URLSearchParams(location.search);
const role = q.get('role') ?? 'rifleman';
const team = q.get('team') ?? 'A';
const pose = q.get('pose') ?? 'stand';
const yaw = Number(q.get('yaw') ?? 0.6);

const container = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d21);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30302a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 6, 4);
sun.castShadow = true;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(2, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f44 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const model = createSoldierModel(TEAM_COLORS[team], role);
model.figure.rotation.y = yaw;
model.setPose({
  stance: pose === 'crouch' ? 'crouch' : 'stand',
  moving: pose === 'walk' || pose === 'run',
  speed: pose === 'run' ? 4 : 1.5,
  walkPhase: 1.2,
  dead: pose === 'dead',
  fall: 1,
  aiming: pose === 'aim',
  reload: pose === 'reload' ? 0.5 : -1,
});
scene.add(model.figure);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
camera.position.set(0, 1.6, 3.6);
camera.lookAt(0, 0.8, 0);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
document.getElementById('caption').textContent = `${role.toUpperCase()} · ${team === 'A' ? 'BLUE' : 'RED'}`;
renderer.setAnimationLoop(() => renderer.render(scene, camera));
