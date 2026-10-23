import * as THREE from 'three';
import { STAGES, ENEMY_TYPES, BOSS_TYPES, stageEnemyTotal, validateStages } from './stages.js';

/*
 * War is War — a 3D horde shooter built with Three.js.
 *
 * World axes: the road runs along Z. The player squad stands near z = 0 and
 * shoots towards -Z; enemies spawn far away (negative z) and walk towards +Z.
 *
 * Performance notes (the game must run 500+ animated enemies on phones):
 *  - Enemies are NOT individual meshes. Each body part is one InstancedMesh
 *    and per-enemy state lives in typed arrays (struct-of-arrays, see `E`).
 *  - Bullets and particles use the same pattern with fixed-size pools.
 *  - Temp vectors/matrices are module-level (`_v`, `_q`, `_mOut`, ...) so the
 *    hot loops never allocate and never trigger GC pauses.
 */

// ---------- Config ----------
const CFG = {
  roadWidth: 12,
  roadLength: 280,
  roadStart: 30,          // z where the road begins (towards the camera)
  // Active-enemy cap: the size of the enemy pool and of every instanced mesh. A stage may bring
  // more enemies than this in total; the extra rows wait in the reinforcement queue.
  maxActiveEnemies: 520,
  reinforcementZ: -80,    // where queued rows enter the bridge (hidden by the fog)
  waveDowntime: 6,        // default seconds between waves (stages can override per wave)
  bulletSpeed: 55,
  bulletRange: 95,
  spread: 0.03,           // random aim jitter in radians
  playerHp: 100,
  funnelDist: 14,         // at this distance the formation breaks and rushes the squad
};
const HALF_W = CFG.roadWidth / 2;

// Stages are data (stages.js). Fail loudly at startup if the data is malformed.
validateStages();

// ---------- Renderer / scene / camera ----------
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Phones get a lower pixel ratio: fill-rate is the bottleneck with 500 enemies + shadows.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9dcee, 55, 230);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
const camBase = new THREE.Vector3(0, 14, 15);
const camLook = new THREE.Vector3(0, 0, -14);
const CAM_DIR = new THREE.Vector3(0, 14, 15).normalize();
const CAM_MIN_DIST = 20.5;
const FRAME_HALF_W = 7.6; // half-width that must stay visible at the squad's depth (road + signs)
let camFollow = 0.45;     // how much the camera follows the player along x

// Responsive framing: instead of a fixed camera, pull it back along CAM_DIR just
// enough for the road width to fit the *horizontal* FOV at any aspect ratio.
// This is what keeps portrait phones from cropping the sides of the road.
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  camera.fov = THREE.MathUtils.clamp(55 + (1 - aspect) * 12, 50, 66);
  camera.updateProjectionMatrix();

  // horizontal half-FOV derived from the vertical FOV and aspect ratio
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfHFov = Math.atan(halfH * aspect);
  const dist = Math.max(CAM_MIN_DIST, FRAME_HALF_W / Math.tan(halfHFov));
  camBase.copy(CAM_DIR).multiplyScalar(dist);
  // portrait screens have spare height: look further down the road to show the horde
  camLook.set(0, 0, aspect < 1 ? -14 - (1 - aspect) * 10 : -14);
  // on narrow screens follow the player less so the squad stays in frame
  camFollow = aspect < 1 ? 0.2 : 0.45;
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
onResize();

// ---------- Texture helpers ----------
// All textures are drawn procedurally on canvases: the game ships with zero image assets.
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rand = (a, b) => a + Math.random() * (b - a);

const glowTex = canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

// ---------- Sky and lights ----------
scene.background = canvasTex(2, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#4f86c8');
  gr.addColorStop(0.5, '#9fc2e6');
  gr.addColorStop(1, '#e2edf8');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x5d6b7c, 1.1));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(-14, 40, -2);
sun.target.position.set(0, 0, -30);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(isTouch ? 1024 : 2048);
// A tight shadow frustum around the road only: wider bounds would blur every shadow.
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 65, bottom: -65, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ---------- Scenery: a bridge above the clouds ----------
const roadTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8b9097'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) {
    const v = (110 + Math.random() * 50) | 0;
    g.fillStyle = `rgba(${v},${v},${v + 5},0.35)`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.fillStyle = 'rgba(55,58,64,0.55)'; g.fillRect(0, h - 3, w, 3);
  g.fillStyle = '#5c6168'; g.fillRect(0, 0, 9, h); g.fillRect(w - 9, 0, 9, h);
  g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(w / 2 - 3, 50, 6, h - 100);
});
roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
roadTex.repeat.set(1, CFG.roadLength / 14);
roadTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const roadZ = CFG.roadStart - CFG.roadLength / 2;
const sideMat = new THREE.MeshStandardMaterial({ color: 0x5a6069, roughness: 0.9 });
const topMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
const road = new THREE.Mesh(
  new THREE.BoxGeometry(CFG.roadWidth, 1.2, CFG.roadLength),
  [sideMat, sideMat, topMat, sideMat, sideMat, sideMat] // box face order: +x,-x,+y,-y,+z,-z
);
road.position.set(0, -0.6, roadZ);
road.receiveShadow = true;
scene.add(road);

// girder under the deck and pillars sinking into the clouds
const girder = new THREE.Mesh(
  new THREE.BoxGeometry(CFG.roadWidth * 0.65, 3, CFG.roadLength),
  new THREE.MeshStandardMaterial({ color: 0x474d56, roughness: 0.9 })
);
girder.position.set(0, -2.7, roadZ);
scene.add(girder);
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.9 });
for (let z = CFG.roadStart - 20; z > CFG.roadStart - CFG.roadLength; z -= 45) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 70, 12), pillarMat);
  p.position.set(0, -39, z);
  scene.add(p);
}

// side guard walls
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.7, metalness: 0.3 });
for (const side of [-1, 1]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, CFG.roadLength), wallMat);
  wall.position.set(side * (HALF_W + 0.17), 0.3, roadZ);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
}

// Preload the web font so power-up panels drawn on canvas use it instead of a fallback.
document.fonts.load('76px "Lilita One"');

// sea of clouds
const cloudTex = canvasTex(512, 512, (g, w, h) => {
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 30 + Math.random() * 100;
    // draw every blob 5 times (wrapped) so the texture tiles without visible seams
    for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.6)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
});
cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
const seaBase = new THREE.Mesh(
  new THREE.PlaneGeometry(1200, 1200),
  new THREE.MeshBasicMaterial({ color: 0xb4cde6 })
);
seaBase.rotation.x = -Math.PI / 2;
seaBase.position.y = -70;
scene.add(seaBase);
// three stacked layers scrolling at different speeds give cheap parallax depth
const cloudLayers = [];
for (const [y, rep, op] of [[-45, 4, 0.9], [-28, 3, 0.7], [-16, 2, 0.45]]) {
  const t = cloudTex.clone();
  t.repeat.set(rep, rep);
  t.needsUpdate = true;
  const layer = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: op, depthWrite: false })
  );
  layer.rotation.x = -Math.PI / 2;
  layer.position.set(0, y, -100);
  scene.add(layer);
  cloudLayers.push(t);
}
// loose cloud puffs beside the bridge
const puffs = [];
const puffMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
for (let i = 0; i < 40; i++) {
  const s = new THREE.Sprite(puffMat);
  const side = Math.random() < 0.5 ? -1 : 1;
  s.position.set(side * rand(14, 70), rand(-14, -3), rand(-200, 30));
  const k = rand(18, 40);
  s.scale.set(k * 1.6, k, 1);
  scene.add(s);
  puffs.push(s);
}
// distant ruins poking out of the clouds
const ruinMat = new THREE.MeshStandardMaterial({ color: 0x8a96a6, roughness: 1 });
for (let i = 0; i < 40; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const h = rand(10, 40);
  const b = new THREE.Mesh(new THREE.BoxGeometry(rand(3, 9), h, rand(3, 9)), ruinMat);
  b.position.set(side * rand(45, 140), -38 + h / 2, rand(-240, -20));
  b.rotation.y = rand(0, Math.PI);
  scene.add(b);
}

// ---------- Player soldiers ----------
const heroMats = {
  armor: new THREE.MeshStandardMaterial({ color: 0x2f5fd0, metalness: 0.45, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1c2232, metalness: 0.4, roughness: 0.55 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd8a542, metalness: 0.85, roughness: 0.3 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.7 }),
};

// Soldier built from primitives; faces -z (towards the horde).
function buildSoldier() {
  const g = new THREE.Group();
  const { armor, dark, gold, skin } = heroMats;
  const mk = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // legs are groups pivoting at the hip so they can swing when strafing
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.17, 0.78, 0);
    g.add(leg);
    mk(new THREE.BoxGeometry(0.24, 0.62, 0.28), armor, 0, -0.31, 0, leg);
    mk(new THREE.BoxGeometry(0.27, 0.18, 0.38), dark, 0, -0.69, -0.04, leg);
    legs.push(leg);
  }
  mk(new THREE.BoxGeometry(0.64, 0.12, 0.4), dark, 0, 0.82, 0);
  mk(new THREE.BoxGeometry(0.62, 0.6, 0.38), armor, 0, 1.15, 0);
  mk(new THREE.BoxGeometry(0.48, 0.28, 0.06), gold, 0, 1.24, -0.21);
  for (const sx of [-1, 1]) mk(new THREE.SphereGeometry(0.19, 12, 10), armor, sx * 0.39, 1.4, 0);
  mk(new THREE.SphereGeometry(0.2, 16, 12), skin, 0, 1.66, 0);
  mk(new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 1.69, 0);
  mk(new THREE.BoxGeometry(0.32, 0.07, 0.06), dark, 0, 1.64, -0.19);

  // arms holding the rifle
  const armR = mk(new THREE.BoxGeometry(0.16, 0.16, 0.5), armor, 0.3, 1.2, -0.2);
  armR.rotation.y = 0.25;
  const armL = mk(new THREE.BoxGeometry(0.16, 0.16, 0.55), armor, -0.12, 1.2, -0.3);
  armL.rotation.y = -0.55;

  const gun = new THREE.Group();
  gun.position.set(0.12, 1.16, -0.35);
  g.add(gun);
  mk(new THREE.BoxGeometry(0.14, 0.2, 0.8), dark, 0, 0, -0.15, gun);
  mk(new THREE.BoxGeometry(0.1, 0.22, 0.14), gold, 0, -0.18, -0.15, gun);
  const barrel = mk(new THREE.CylinderGeometry(0.045, 0.05, 0.55, 10), dark, 0, 0.03, -0.8, gun);
  barrel.rotation.x = Math.PI / 2;
  // empty marker at the barrel tip: bullets spawn from its world position
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -1.1);
  gun.add(muzzle);

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffb84a, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, transparent: true,
  }));
  flash.scale.setScalar(0.8);
  flash.visible = false;
  muzzle.add(flash);

  // fake contact shadow so the soldier stays grounded even when shadow maps are soft
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  scene.add(blob);

  return { group: g, legs, gun, muzzle, flash, blob, recoil: 0, flashT: 0 };
}

// Squad layout: rows of up to 4 (two rows beyond that), outer soldiers slightly behind.
// Returns [offsetX, offsetZ] per soldier, relative to the player anchor.
const SQUAD_MAX = 8;
function squadLayout(n) {
  const perRow = n <= 4 ? n : Math.ceil(n / 2);
  const out = [];
  for (let k = 0; k < n; k++) {
    const row = Math.floor(k / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = k % perRow;
    const x = (col - (inRow - 1) / 2) * 0.75;
    const z = row * 0.85 + (inRow > 2 && (col === 0 || col === inRow - 1) ? 0.2 : 0);
    out.push([x, z]);
  }
  return out;
}
// All soldiers are built up front and toggled visible, so gaining one never stalls a frame.
const squad = [];
for (let i = 0; i < SQUAD_MAX; i++) {
  const s = buildSoldier();
  s.group.visible = s.blob.visible = false;
  scene.add(s.group);
  squad.push(s);
}

const player = {
  x: 0, targetX: 0, z: 0, hp: CFG.playerHp, fireT: 0, prevX: 0, size: 1,
  rapidT: 0, pierceT: 0, // timed power-ups (seconds left)
};
const squadPos = []; // [{x,z}] world positions of the active soldiers, rebuilt every frame

// ---------- Enemies (one InstancedMesh per body part) ----------
// Struct-of-arrays: enemy i is E.x[i], E.z[i], ... Typed arrays keep the hot loops
// cache-friendly and allocation-free.
const MAX_E = CFG.maxActiveEnemies;
const E = {
  x: new Float32Array(MAX_E), z: new Float32Array(MAX_E),
  vx: new Float32Array(MAX_E), sepX: new Float32Array(MAX_E), sepZ: new Float32Array(MAX_E),
  speed: new Float32Array(MAX_E), phase: new Float32Array(MAX_E), scale: new Float32Array(MAX_E),
  yaw: new Float32Array(MAX_E), hp: new Int8Array(MAX_E),
  state: new Uint8Array(MAX_E), // 0 free, 1 alive, 2 dying (the slot is released when the fall ends)
  t: new Float32Array(MAX_E), flash: new Float32Array(MAX_E),
  wave: new Int8Array(MAX_E),   // index of the wave the enemy belongs to
};

// Enemy pool. Free slot indices live on a stack, so spawning and releasing are O(1) and never
// allocate. Slots are handed out lowest-first and `hi` tracks the highest slot used this stage:
// every per-enemy loop and the instanced draw count stop at `hi` instead of the full capacity.
const freeSlots = new Int32Array(MAX_E);
let freeTop = 0;
let hi = 0;

// ?cap=N (testing) hands out fewer slots than the meshes can hold, lowering the active cap.
// Floor of 32: a queued row only enters when the whole row fits, so the cap must exceed any row.
const activeCap = THREE.MathUtils.clamp(
  parseInt(new URLSearchParams(location.search).get('cap'), 10) || MAX_E, 32, MAX_E);

function resetEnemyPool() {
  E.state.fill(0);
  for (let k = 0; k < activeCap; k++) freeSlots[k] = activeCap - 1 - k; // slot 0 on top
  freeTop = activeCap;
  hi = 0;
}

function allocEnemy() {
  if (freeTop === 0) return -1;
  const i = freeSlots[--freeTop];
  if (i + 1 > hi) hi = i + 1;
  return i;
}

function releaseEnemy(i) {
  E.state[i] = 0;
  freeSlots[freeTop++] = i;
}

const bodyColors = [];
const skinColors = [];

function makeInst(geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, MAX_E);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // rewritten every frame
  m.castShadow = true;
  // the instances span the whole road, so the mesh's own bounding sphere is meaningless
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
const lambert = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
// Limb geometries are translated so their origin sits at the joint (hip/shoulder):
// rotating the instance then swings the limb around the joint instead of its center.
const parts = {
  torso: makeInst(new THREE.BoxGeometry(0.55, 0.62, 0.32), lambert()),
  head: makeInst(new THREE.SphereGeometry(0.22, 10, 8), lambert()),
  legL: makeInst(new THREE.BoxGeometry(0.18, 0.55, 0.2).translate(0, -0.275, 0), new THREE.MeshLambertMaterial({ color: 0x3b4030 })),
  legR: null,
  armL: makeInst(new THREE.BoxGeometry(0.14, 0.14, 0.55).translate(0, 0, 0.27), lambert()),
  armR: null,
};
parts.legR = makeInst(parts.legL.geometry, parts.legL.material);
parts.armR = makeInst(parts.armL.geometry, parts.armL.material);

const CLOTHES = ['#5b7a3a', '#55703a', '#4f6a36', '#62803f', '#5a7444'];
const SKINS = ['#7fa15a', '#8bb06a', '#6e9450', '#94b874'];
for (let i = 0; i < MAX_E; i++) {
  bodyColors.push(new THREE.Color(CLOTHES[(i * 3) % CLOTHES.length]));
  skinColors.push(new THREE.Color(SKINS[(i * 7) % SKINS.length]));
  parts.torso.setColorAt(i, bodyColors[i]);
  parts.head.setColorAt(i, skinColors[i]);
  parts.armL.setColorAt(i, skinColors[i]);
  parts.armR.setColorAt(i, skinColors[i]);
}

// ---------- Stage manager and wave spawner ----------
// A stage (stages.js) is a list of waves. Wave 1 is laid out when the stage is set up; each later
// wave starts once the previous one is down to `whenRemaining` enemies, after `downtime` seconds.
// Rows that don't fit under the active-enemy cap wait in a queue and enter at the far end of the
// bridge as slots free up.
const W = {
  next: 0,      // index of the next wave to start
  timer: 0,     // downtime accumulated towards the next wave
  queue: [],    // reinforcement rows: { xs, types, wave, phase, interval }
  rowTimer: 0,  // seconds until the next queued row may enter
  alive: [],    // per wave: enemies still alive or queued
};
let stageTotal = 0; // enemies the whole stage brings, across all waves (bosses excluded)

function spawnEnemy(type, x, z, wave, phase) {
  const i = allocEnemy();
  if (i < 0) return false;
  const t = ENEMY_TYPES[type];
  E.x[i] = x;
  E.z[i] = z;
  E.vx[i] = 0;
  // same speed for every enemy of a type keeps the formation intact
  E.speed[i] = t.speed * STAGES[stageIdx].pace;
  E.phase[i] = phase;
  E.scale[i] = rand(0.95, 1.05);
  E.hp[i] = t.hp;
  E.state[i] = 1;
  E.t[i] = 0;
  E.flash[i] = 0;
  E.yaw[i] = 0;
  E.wave[i] = wave;
  return true;
}

// Expands { soldier: 120, runner: 20 } into the order the formation is filled. Types are spread
// proportionally (like Bresenham's line algorithm) so a mixed wave doesn't arrive as one block
// per type. Runs once per wave, outside the frame loop.
function waveRoster(wave) {
  const entries = Object.entries(wave.enemies);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const placed = entries.map(() => 0);
  const out = [];
  for (let k = 1; k <= total; k++) {
    let best = 0, bestDeficit = -Infinity;
    entries.forEach(([, n], j) => {
      const deficit = (n * k) / total - placed[j];
      if (deficit > bestDeficit) { bestDeficit = deficit; best = j; }
    });
    placed[best]++;
    out.push(entries[best][0]);
  }
  return out;
}

// Lays a wave out on a grid. When the wave has a boss, slots inside an ellipse around it are
// skipped (pushing enemies to extra rows) so the boss marches inside a hole in the horde.
function startWave(w) {
  const st = STAGES[stageIdx];
  const wave = st.waves[w];
  const f = wave.formation;
  const roster = waveRoster(wave);
  const cols = f.cols;
  const spacingX = f.fullWidth ? (CFG.roadWidth - 1.0) / (cols - 1) : f.spacingX;
  const x0 = -spacingX * (cols - 1) / 2;
  const rowsNeeded = Math.ceil(roster.length / cols);
  const bossZ = f.startZ - (rowsNeeded * f.spacingZ) / 2 - 1;
  // time for the formation to advance one row: queued rows enter at this rhythm to keep spacing
  const interval = f.spacingZ / (ENEMY_TYPES.soldier.speed * st.pace);
  W.alive[w] = roster.length;

  let n = 0, queuing = false;
  for (let row = 0; n < roster.length; row++) {
    const z = f.startZ - row * f.spacingZ;
    const xs = [], types = [];
    for (let c = 0; c < cols && n < roster.length; c++) {
      const x = x0 + c * spacingX;
      if (wave.boss && Math.hypot(x, (z - bossZ) * 0.8) < wave.boss.gap) continue;
      xs.push(x);
      types.push(roster[n++]);
    }
    if (xs.length === 0) continue;
    const phase = (row % 2) * 0.4; // near-synchronised march
    // Rows go straight into the formation while the pool has room. From the first row that
    // doesn't fit, every later row is queued too, so reinforcements keep the formation order.
    if (!queuing && freeTop >= xs.length) {
      for (let k = 0; k < xs.length; k++) spawnEnemy(types[k], xs[k] + rand(-0.04, 0.04), z + rand(-0.04, 0.04), w, phase);
    } else {
      queuing = true;
      W.queue.push({ xs, types, wave: w, phase, interval });
    }
  }
  if (wave.boss) spawnBoss(wave.boss, bossZ, st.pace);
}

function updateWaves(dt) {
  const st = STAGES[stageIdx];

  // Reinforcements: the next queued row enters once the pool has room for the whole row and the
  // previous row has had time to move one row-spacing forward.
  W.rowTimer -= dt;
  if (W.queue.length && W.rowTimer <= 0 && freeTop >= W.queue[0].xs.length) {
    const r = W.queue.shift();
    for (let k = 0; k < r.xs.length; k++) {
      spawnEnemy(r.types[k], r.xs[k] + rand(-0.04, 0.04), CFG.reinforcementZ + rand(-0.04, 0.04), r.wave, r.phase);
    }
    W.rowTimer = r.interval;
  }

  // Next wave: wait until the previous wave is thin enough, then for the downtime.
  if (W.next < st.waves.length) {
    const wave = st.waves[W.next];
    if (W.alive[W.next - 1] <= (wave.whenRemaining ?? 0)) {
      W.timer += dt;
      if (W.timer >= (wave.downtime ?? CFG.waveDowntime)) {
        startWave(W.next);
        W.next++;
        W.timer = 0;
        showBanner(`WAVE ${W.next}`, `${W.alive[W.next - 1]} enemies incoming`);
      }
    }
  }
}

// Reused scratch objects: hot loops must not allocate.
const _mBase = new THREE.Matrix4(), _mPart = new THREE.Matrix4(), _mOut = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0); // "hidden" instance
const _qIdent = new THREE.Quaternion();
const _white = new THREE.Color(0xffffff);

// Writes one body part of enemy i: world = enemyBase * localPart(offset, pitch).
function setPart(mesh, i, px, py, pz, rx) {
  _e.set(rx, 0, 0);
  _q.setFromEuler(_e);
  _mPart.compose(_v.set(px, py, pz), _q, _s.set(1, 1, 1));
  _mOut.multiplyMatrices(_mBase, _mPart);
  mesh.setMatrixAt(i, _mOut);
}

// x of the squad member closest to x (enemies home in on the nearest soldier)
function nearestSquadX(x) {
  let best = squadPos[0].x, bd = Infinity;
  for (const p of squadPos) {
    const d = Math.abs(p.x - x);
    if (d < bd) { bd = d; best = p.x; }
  }
  return best;
}

const nearList = new Int32Array(MAX_E);
function updateEnemies(dt, playing) {
  const st = STAGES[stageIdx];
  // Separation is O(k²), so it only runs for enemies that already broke formation
  // near the squad. Far away the grid spacing already prevents overlap.
  let nNear = 0;
  for (let i = 0; i < hi; i++) {
    E.sepX[i] = 0; E.sepZ[i] = 0;
    if (E.state[i] === 1 && E.z[i] > player.z - CFG.funnelDist - 1) nearList[nNear++] = i;
  }
  if (playing) {
    for (let a = 0; a < nNear; a++) {
      const i = nearList[a];
      for (let b = a + 1; b < nNear; b++) {
        const j = nearList[b];
        const dx = E.x[i] - E.x[j], dz = E.z[i] - E.z[j];
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.56 && d2 > 1e-6) {
          // push apart proportionally to overlap (0.75 = desired personal space)
          const d = Math.sqrt(d2), f = (0.75 - d) / 0.75 * 5 / d;
          E.sepX[i] += dx * f; E.sepZ[i] += dz * f;
          E.sepX[j] -= dx * f; E.sepZ[j] -= dz * f;
        }
      }
    }
  }

  for (let i = 0; i < hi; i++) {
    const s = E.state[i];
    if (s === 0) continue;
    if (s === 1) {
      if (playing) {
        // Funnel: march straight while far, then steer harder towards the nearest
        // soldier as the distance shrinks. This drags the crowd into the line of fire.
        const distToPlayer = player.z - E.z[i];
        let vx = 0;
        if (distToPlayer < CFG.funnelDist) {
          const pull = 1 - Math.max(0, distToPlayer) / CFG.funnelDist; // 0 → 1 while approaching
          const tx = nearestSquadX(E.x[i]);
          vx = THREE.MathUtils.clamp((tx - E.x[i]) * 1.2, -2.2, 2.2) * pull;
        }
        E.vx[i] += (vx - E.vx[i]) * Math.min(1, dt * 4); // smoothed steering
        E.x[i] += (E.vx[i] + E.sepX[i]) * dt;
        // never let separation push an enemy backwards faster than 1 u/s
        E.z[i] += (E.speed[i] + Math.max(-1, E.sepZ[i])) * dt;
        E.x[i] = THREE.MathUtils.clamp(E.x[i], -HALF_W + 0.4, HALF_W - 0.4);
        E.yaw[i] = Math.atan2(E.vx[i], E.speed[i]) * 0.7;

        // contact with any soldier, or slipping past the squad, costs HP
        let touched = E.z[i] > player.z + 1.5;
        for (const p of squadPos) {
          const dx = E.x[i] - p.x, dz = E.z[i] - p.z;
          if (dx * dx + dz * dz < 0.8 * 0.8) { touched = true; break; }
        }
        if (touched) {
          hurtPlayer(st.contactDamage);
          killEnemy(i, false);
        }
      }
      E.phase[i] += dt * E.speed[i] * 3.6;
    } else if (s === 2) {
      E.t[i] += dt;
      // the fall animation is over: the slot goes back to the pool for reinforcements
      if (E.t[i] > 1.3) { releaseEnemy(i); continue; }
    }
    if (E.flash[i] > 0) E.flash[i] -= dt;
  }
}

// Rebuilds every enemy's 6 part matrices from its state (walk cycle, death fall).
function renderEnemies() {
  const P = parts;
  // only upload and draw the slots this stage has touched
  for (const key in P) P[key].count = hi;
  for (let i = 0; i < hi; i++) {
    const st = E.state[i];
    if (st === 0) {
      P.torso.setMatrixAt(i, _zero); P.head.setMatrixAt(i, _zero);
      P.legL.setMatrixAt(i, _zero); P.legR.setMatrixAt(i, _zero);
      P.armL.setMatrixAt(i, _zero); P.armR.setMatrixAt(i, _zero);
      continue;
    }
    let fall = 0, sink = 0;
    if (st === 2) {
      // fall backwards in 0.3 s, lie still, then sink through the floor
      const t = E.t[i];
      fall = -Math.min(t / 0.3, 1) * Math.PI / 2;
      sink = Math.max(0, t - 0.7) * 1.2;
    }
    const ph = E.phase[i];
    const bob = st === 1 ? Math.abs(Math.sin(ph)) * 0.07 : 0;
    // 'YXZ' = turn (yaw) first, then tip over (pitch) in the turned frame
    _e.set(fall, E.yaw[i], 0, 'YXZ');
    _q.setFromEuler(_e);
    _e.order = 'XYZ'; // restore: _e is shared with setPart()
    const k = E.scale[i];
    _mBase.compose(_v.set(E.x[i], bob - sink, E.z[i]), _q, _s.set(k, k, k));

    const swing = st === 1 ? Math.sin(ph) * 0.7 : 0;
    // zombie-style raised arms, slightly swaying
    const armSwing = st === 1 ? Math.sin(ph * 0.5) * 0.15 : 0.6;
    setPart(P.legL, i, -0.13, 0.55, 0, swing);
    setPart(P.legR, i, 0.13, 0.55, 0, -swing);
    setPart(P.torso, i, 0, 0.86, 0, 0);
    setPart(P.head, i, 0, 1.38, 0.02, 0);
    setPart(P.armL, i, -0.34, 1.07, 0, -0.2 + armSwing);
    setPart(P.armR, i, 0.34, 1.07, 0, -0.2 - armSwing);

    // hit feedback: flash white for a few frames
    const flashing = E.flash[i] > 0;
    P.torso.setColorAt(i, flashing ? _white : bodyColors[i]);
    P.head.setColorAt(i, flashing ? _white : skinColors[i]);
  }
  for (const key in P) P[key].instanceMatrix.needsUpdate = true;
  P.torso.instanceColor.needsUpdate = true;
  P.head.instanceColor.needsUpdate = true;
}

// ---------- Giant (stage 3 boss) ----------
// Modelled at human scale, then the whole group is scaled up (BOSS_TYPES[type].scale).
function buildGiant() {
  const g = new THREE.Group();
  // emissive white at intensity 0: raising the intensity makes the whole body flash on hit
  const flashable = (opts) => new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0, ...opts });
  const skin = flashable({ color: 0x9a3b2c, roughness: 0.7 });
  const hide = flashable({ color: 0x3a2a22, roughness: 0.9 });
  const metal = flashable({ color: 0x7a7f88, metalness: 0.8, roughness: 0.35 });
  const bone = flashable({ color: 0xe8dcc0, roughness: 0.6 });
  const eyes = new THREE.MeshBasicMaterial({ color: 0xffe14a, toneMapped: false });
  const mk = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // faces +z (towards the player)
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.22, 0.62, 0);
    g.add(leg);
    mk(new THREE.BoxGeometry(0.3, 0.5, 0.32), hide, 0, -0.25, 0, leg);
    mk(new THREE.BoxGeometry(0.36, 0.14, 0.44), skin, 0, -0.55, 0.06, leg);
    legs.push(leg);
  }
  mk(new THREE.BoxGeometry(0.8, 0.2, 0.52), metal, 0, 0.66, 0);
  mk(new THREE.BoxGeometry(0.84, 0.62, 0.52), skin, 0, 1.02, 0);
  const belly = mk(new THREE.SphereGeometry(0.36, 16, 12), skin, 0, 0.9, 0.12);
  belly.scale.set(1.05, 0.9, 0.8);
  const strap = mk(new THREE.BoxGeometry(0.1, 0.85, 0.56), hide, 0, 1.02, 0);
  strap.rotation.z = 0.65;
  for (const sx of [-1, 1]) {
    mk(new THREE.SphereGeometry(0.22, 12, 10), metal, sx * 0.5, 1.32, 0);
    for (let k = 0; k < 3; k++) {
      const spike = mk(new THREE.ConeGeometry(0.05, 0.22, 8), bone, sx * (0.44 + k * 0.08), 1.52, -0.08 + k * 0.08);
      spike.rotation.z = -sx * 0.5;
    }
  }
  // head
  mk(new THREE.SphereGeometry(0.26, 16, 12), skin, 0, 1.56, 0.05);
  mk(new THREE.BoxGeometry(0.32, 0.13, 0.24), skin, 0, 1.43, 0.15);
  for (const sx of [-1, 1]) {
    const tusk = mk(new THREE.ConeGeometry(0.03, 0.12, 6), bone, sx * 0.1, 1.53, 0.26);
    tusk.rotation.x = -0.3;
    const horn = mk(new THREE.ConeGeometry(0.06, 0.34, 8), bone, sx * 0.22, 1.78, 0);
    horn.rotation.z = -sx * 0.7;
    mk(new THREE.SphereGeometry(0.04, 8, 6), eyes, sx * 0.09, 1.62, 0.27).castShadow = false;
  }
  // arms (groups pivot at the shoulder)
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.55, 1.26, 0);
    g.add(arm);
    mk(new THREE.BoxGeometry(0.24, 0.66, 0.26), skin, 0, -0.33, 0, arm);
    mk(new THREE.SphereGeometry(0.16, 12, 10), skin, 0, -0.7, 0, arm);
    arms.push(arm);
  }
  // spiked club in the right hand
  const club = new THREE.Group();
  club.position.set(0, -0.7, 0);
  club.rotation.x = 1.3;
  arms[1].add(club);
  mk(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), hide, 0, 0.3, 0, club);
  mk(new THREE.CylinderGeometry(0.17, 0.12, 0.42, 10), metal, 0, 0.78, 0, club);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const spike = mk(new THREE.ConeGeometry(0.04, 0.14, 6), bone, Math.cos(a) * 0.17, 0.8, Math.sin(a) * 0.17, club);
    spike.rotation.set(Math.sin(a) * Math.PI / 2, 0, -Math.cos(a) * Math.PI / 2);
  }

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  g.add(blob);

  return { group: g, legs, arms, mats: [skin, hide, metal, bone] };
}

const giant = buildGiant();
giant.group.visible = false;
scene.add(giant.group);
// state: 0 inactive, 1 alive, 2 dying
const boss = { active: false, state: 0, hp: 0, maxHp: 1, x: 0, z: 0, speed: 1, phase: 0, flash: 0, t: 0, scale: 1, lastStep: 0 };

// def is a wave's boss entry ({ type, gap }); pace is the stage's speed multiplier.
function spawnBoss(def, z, pace) {
  const type = BOSS_TYPES[def.type];
  boss.active = true;
  boss.state = 1;
  boss.hp = boss.maxHp = type.hp;
  boss.scale = type.scale;
  boss.x = 0;
  boss.z = z;
  boss.speed = ENEMY_TYPES.soldier.speed * pace; // same pace as the horde so it stays inside its hole
  boss.phase = 0;
  boss.flash = 0;
  boss.t = 0;
  giant.group.visible = true;
  giant.group.rotation.set(0, 0, 0);
  giant.group.scale.setScalar(boss.scale);
}

function hideBoss() {
  boss.active = false;
  boss.state = 0;
  giant.group.visible = false;
}

function updateBoss(dt, playing) {
  if (!boss.active) return;
  const g = giant.group;
  if (boss.state === 1) {
    if (playing) {
      boss.z += boss.speed * dt;
      const reach = 0.6 * boss.scale;
      if (boss.z + reach > player.z - 0.4) {
        hurtPlayer(CFG.playerHp); // the giant crushes the squad: instant defeat
        shake = 0.8;
      }
    }
    boss.phase += dt * boss.speed * 2.2;
    const step = Math.sin(boss.phase);
    giant.legs[0].rotation.x = step * 0.45;
    giant.legs[1].rotation.x = -step * 0.45;
    giant.arms[0].rotation.x = -step * 0.35;
    // blend from a normal arm swing to "club raised overhead" as it closes in
    const near = THREE.MathUtils.clamp((boss.z - (player.z - 18)) / 10, 0, 1);
    giant.arms[1].rotation.x = step * 0.35 * (1 - near) - near * (2.4 + Math.sin(time * 6) * 0.3);
    g.rotation.set(0, 0, step * 0.05);
    g.position.set(boss.x, Math.abs(Math.cos(boss.phase)) * 0.12, boss.z);
    // a small camera shake every time a foot lands (sign change of the step cycle)
    const stepSign = Math.sign(step);
    if (playing && stepSign !== boss.lastStep) {
      boss.lastStep = stepSign;
      shake = Math.max(shake, 0.12);
    }
  } else if (boss.state === 2) {
    boss.t += dt;
    g.rotation.x = -Math.min(boss.t / 0.9, 1) * Math.PI / 2;
    g.position.y = -Math.max(0, boss.t - 1.6) * 2;
    if (boss.t > 3.5) hideBoss();
  }
  if (boss.flash > 0) boss.flash -= dt;
  const glow = boss.flash > 0 ? 0.55 : 0;
  for (const m of giant.mats) m.emissiveIntensity = glow;
}

function hitBoss(x, y, z) {
  boss.hp--;
  boss.flash = 0.06;
  spawnParticles(x, y, z, 3, 0xffd36b, 3);
  updateHud();
  if (boss.hp <= 0) {
    boss.state = 2;
    boss.t = 0;
    shake = 0.7;
    for (let k = 0; k < 6; k++) {
      spawnParticles(boss.x + rand(-1, 1), rand(1, 4), boss.z + rand(-1, 1), 12, k % 2 ? 0x9a3b2c : 0xffc04a, 7);
    }
    checkWin();
  }
}

// ---------- Power-up panels along the edges ----------
// Panels travel from the far end along both edges. Shoot one until its counter
// empties to collect it; if it slips past the squad it is lost.
const POWERUPS = {
  soldier: { label: '+1', sub: 'SOLDIER', bg: '#2f6fe0', edge: 0x1b3f8f, ink: '#ffffff', hits: 6, weight: 45 },
  rapid:   { label: 'x2', sub: 'FIRE RATE', bg: '#ffc928', edge: 0xc79a12, ink: '#4a2f00', hits: 8, weight: 20 },
  heal:    { label: '+30', sub: 'HEALTH', bg: '#2cbf47', edge: 0x1c8a32, ink: '#ffffff', hits: 5, weight: 15 },
  pierce:  { label: '>>>', sub: 'PIERCE', bg: '#9b2fd6', edge: 0x5e1385, ink: '#ffffff', hits: 10, weight: 20 },
};
const PANEL = { w: 2.3, h: 1.4, x: HALF_W - 0.2, speed: 3.6, spawnZ: -95, hitHalfW: 1.15 };
const PANEL_DURATION = { rapid: 8, pierce: 6 };
const panelGeo = new THREE.BoxGeometry(PANEL.w, PANEL.h, 0.2);
const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8);
const postMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.5, roughness: 0.5 });
const panels = [];
let panelTimer = 1.5;

// Each panel owns a small canvas texture, redrawn only when it is hit.
function drawPanel(p) {
  const def = POWERUPS[p.type];
  const g = p.ctx, w = p.canvas.width, h = p.canvas.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = def.bg;
  g.fillRect(10, 10, w - 20, h - 20);
  g.fillStyle = def.ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '86px "Lilita One", sans-serif';
  g.fillText(def.label, w / 2, h * 0.38);
  g.font = '30px "Lilita One", sans-serif';
  g.fillText(def.sub, w / 2, h * 0.68);
  // remaining-hits bar
  const bw = w - 60, bx = 30, by = h - 34;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(bx, by, bw, 14);
  g.fillStyle = def.ink;
  g.fillRect(bx, by, bw * (p.hits / p.maxHits), 14);
  p.tex.needsUpdate = true;
}

// Weighted random pick, skipping power-ups that would be useless right now.
function pickPowerType() {
  const options = Object.entries(POWERUPS).filter(([k]) =>
    !(k === 'soldier' && player.size >= SQUAD_MAX) && !(k === 'heal' && player.hp >= CFG.playerHp));
  let r = Math.random() * options.reduce((a, [, d]) => a + d.weight, 0);
  for (const [k, d] of options) { r -= d.weight; if (r <= 0) return k; }
  return options[0][0];
}

function spawnPanel(z = PANEL.spawnZ) {
  const type = pickPowerType();
  const def = POWERUPS[type];
  const side = Math.random() < 0.5 ? -1 : 1;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: def.edge, roughness: 0.5 });
  const group = new THREE.Group();
  const board = new THREE.Mesh(panelGeo, [edgeMat, edgeMat, edgeMat, edgeMat, face, edgeMat]);
  board.position.y = 1.5;
  board.rotation.set(-0.35, -side * 0.15, 0); // tilted back and angled towards the camera
  board.castShadow = true;
  group.add(board);
  for (const px of [-0.8, 0.8]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, 0.45, 0);
    post.castShadow = true;
    group.add(post);
  }
  // panels get tougher in later stages
  const hits = Math.round(def.hits * (1 + stageIdx * 0.35));
  const p = {
    type, side, group, board, face, edgeMat, canvas, ctx: canvas.getContext('2d'), tex,
    hits, maxHits: hits, x: side * PANEL.x, z, flash: 0, wobble: 0,
  };
  group.position.set(p.x, 0, p.z);
  scene.add(group);
  drawPanel(p);
  panels.push(p);
}

// Panels own a texture and two materials each: dispose them or the GPU leaks memory.
function removePanel(p) {
  scene.remove(p.group);
  p.tex.dispose(); p.face.dispose(); p.edgeMat.dispose();
  panels.splice(panels.indexOf(p), 1);
}

function clearPanels() {
  while (panels.length) removePanel(panels[0]);
  panelTimer = 1.5;
}

function updatePanels(dt, playing) {
  if (playing) {
    panelTimer -= dt;
    if (panelTimer <= 0) {
      spawnPanel();
      panelTimer = rand(2.2, 3.6);
    }
  }
  for (let k = panels.length - 1; k >= 0; k--) {
    const p = panels[k];
    if (playing) p.z += PANEL.speed * dt;
    if (p.z > player.z + 4) { removePanel(p); continue; } // missed
    p.flash -= dt;
    p.wobble = Math.max(0, p.wobble - dt * 6);
    p.face.emissiveIntensity = p.flash > 0 ? 0.5 : 0;
    p.group.position.set(p.x, 0, p.z);
    p.board.rotation.z = Math.sin(time * 40) * 0.08 * p.wobble;
  }
}

function hitPanel(p) {
  p.hits--;
  p.flash = 0.05;
  p.wobble = 1;
  spawnParticles(p.x, 1.5, p.z + 0.2, 2, 0xffffff, 2.5);
  if (p.hits > 0) { drawPanel(p); return; }
  const def = POWERUPS[p.type];
  spawnParticles(p.x, 1.5, p.z, 24, def.bg, 5);
  applyPowerUp(p.type);
  removePanel(p);
}

function applyPowerUp(type) {
  if (type === 'soldier') {
    if (player.size < SQUAD_MAX) {
      player.size++;
      const s = squad[player.size - 1];
      s.group.visible = s.blob.visible = true;
      showToast('+1 SOLDIER', '#4f8cff');
    }
  } else if (type === 'rapid') {
    player.rapidT = PANEL_DURATION.rapid;
    showToast('FIRE RATE x2!', '#ffc928');
  } else if (type === 'heal') {
    player.hp = Math.min(CFG.playerHp, player.hp + 30);
    showToast('+30 HEALTH', '#2cbf47');
  } else if (type === 'pierce') {
    player.pierceT = PANEL_DURATION.pierce;
    showToast('PIERCING ROUNDS!', '#c06bff');
  }
  updateHud();
}

// ---------- Bullets ----------
// Fixed pool; `on` marks live slots. Sized for 8 soldiers at double fire rate.
const B_MAX = 420;
const B = {
  x: new Float32Array(B_MAX), y: new Float32Array(B_MAX), z: new Float32Array(B_MAX),
  vx: new Float32Array(B_MAX), vz: new Float32Array(B_MAX),
  dist: new Float32Array(B_MAX), on: new Uint8Array(B_MAX), pierce: new Uint8Array(B_MAX),
};
const bulletMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.07, 0.07, 1.1),
  new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  B_MAX
);
const BULLET_COLOR = new THREE.Color(0xffd98a), PIERCE_COLOR = new THREE.Color(0xe08cff);
for (let i = 0; i < B_MAX; i++) bulletMesh.setColorAt(i, BULLET_COLOR);
bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bulletMesh.frustumCulled = false;
scene.add(bulletMesh);

const _muzzlePos = new THREE.Vector3();
function fire(soldier, outward) {
  const i = B.on.indexOf(0);
  if (i < 0) return; // pool exhausted: skip the shot rather than allocate
  soldier.muzzle.getWorldPosition(_muzzlePos);
  const a = rand(-CFG.spread, CFG.spread) + outward;
  B.x[i] = _muzzlePos.x; B.y[i] = _muzzlePos.y; B.z[i] = _muzzlePos.z;
  B.vx[i] = Math.sin(a) * CFG.bulletSpeed;
  B.vz[i] = -Math.cos(a) * CFG.bulletSpeed;
  B.dist[i] = 0;
  B.on[i] = 1;
  B.pierce[i] = player.pierceT > 0 ? 4 : 0; // goes through up to 4 enemies
  bulletMesh.setColorAt(i, B.pierce[i] ? PIERCE_COLOR : BULLET_COLOR);
  bulletMesh.instanceColor.needsUpdate = true;
  soldier.recoil = 1;
  soldier.flashT = 0.04;
}

// Collision is done in 2D (x/z). A bullet travels ~1 unit per frame, so instead of
// testing its point position we test the whole segment it swept this frame
// [zMin, zMax] — otherwise fast bullets would tunnel through thin enemies.
// Among everything the segment touches, the target closest to the player
// (largest z) is hit first, so the front line shields the ranks behind it.
function updateBullets(dt) {
  for (let b = 0; b < B_MAX; b++) {
    if (!B.on[b]) continue;
    const pz = B.z[b];
    B.x[b] += B.vx[b] * dt;
    B.z[b] += B.vz[b] * dt;
    B.dist[b] += CFG.bulletSpeed * dt;
    if (B.dist[b] > CFG.bulletRange) { B.on[b] = 0; continue; }
    const zMin = B.z[b] - 0.35, zMax = pz + 0.35;
    let hit = -1, best = -Infinity;
    for (let i = 0; i < hi; i++) {
      if (E.state[i] !== 1) continue;
      const ez = E.z[i];
      if (ez < zMin || ez > zMax) continue;
      if (Math.abs(E.x[i] - B.x[b]) > 0.42 * E.scale[i]) continue;
      if (ez > best) { best = ez; hit = i; }
    }
    // power-up panels take bullets too (closest target wins)
    let panelHit = null;
    for (const p of panels) {
      if (p.z < zMin || p.z > zMax || p.z <= best) continue;
      if (Math.abs(p.x - B.x[b]) > PANEL.hitHalfW) continue;
      if (!panelHit || p.z > panelHit.z) panelHit = p;
    }
    // the giant blocks bullets with its (scaled) body box
    if (boss.state === 1) {
      const r = 0.45 * boss.scale, depth = 0.3 * boss.scale;
      const front = boss.z + depth;
      if (Math.abs(B.x[b] - boss.x) < r && front > zMin && boss.z - depth < zMax && front > best &&
          (!panelHit || front > panelHit.z)) {
        B.on[b] = 0;
        hitBoss(B.x[b], B.y[b], front);
        continue;
      }
    }
    if (panelHit) {
      B.on[b] = 0;
      hitPanel(panelHit);
      continue;
    }
    if (hit >= 0) {
      // piercing rounds only keep flying when they actually kill the target;
      // otherwise the same tough enemy would be hit again next frame
      if (B.pierce[b] > 0 && E.hp[hit] <= 1) B.pierce[b]--;
      else B.on[b] = 0;
      E.hp[hit]--;
      E.flash[hit] = 0.08;
      spawnParticles(B.x[b], 1.1, E.z[hit] + 0.2, 3, 0xffd36b, 3);
      if (E.hp[hit] <= 0) killEnemy(hit, true);
    }
  }
}

function renderBullets() {
  for (let b = 0; b < B_MAX; b++) {
    if (!B.on[b]) { bulletMesh.setMatrixAt(b, _zero); continue; }
    _e.set(0, Math.atan2(B.vx[b], B.vz[b]), 0); // align the tracer with its velocity
    _q.setFromEuler(_e);
    _mOut.compose(_v.set(B.x[b], B.y[b], B.z[b]), _q, _s.set(1, 1, 1));
    bulletMesh.setMatrixAt(b, _mOut);
  }
  bulletMesh.instanceMatrix.needsUpdate = true;
}

// ---------- Particles ----------
// Ring buffer: when full, the oldest particles are overwritten.
const P_MAX = 900;
const PT = {
  x: new Float32Array(P_MAX), y: new Float32Array(P_MAX), z: new Float32Array(P_MAX),
  vx: new Float32Array(P_MAX), vy: new Float32Array(P_MAX), vz: new Float32Array(P_MAX),
  life: new Float32Array(P_MAX), size: new Float32Array(P_MAX),
};
let pCursor = 0;
const partMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.1, 0.1, 0.1),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
  P_MAX
);
partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
partMesh.frustumCulled = false;
const _pc = new THREE.Color();
for (let i = 0; i < P_MAX; i++) partMesh.setColorAt(i, _pc.set(0xffffff));
scene.add(partMesh);

function spawnParticles(x, y, z, n, color, power) {
  _pc.set(color);
  for (let k = 0; k < n; k++) {
    const i = pCursor; pCursor = (pCursor + 1) % P_MAX;
    PT.x[i] = x; PT.y[i] = y; PT.z[i] = z;
    PT.vx[i] = rand(-1, 1) * power;
    PT.vy[i] = rand(0.5, 1.5) * power;
    PT.vz[i] = rand(-1, 1) * power;
    PT.life[i] = rand(0.4, 0.9);
    PT.size[i] = rand(0.7, 1.6);
    partMesh.setColorAt(i, _pc);
  }
  partMesh.instanceColor.needsUpdate = true;
}

function updateParticles(dt) {
  for (let i = 0; i < P_MAX; i++) {
    if (PT.life[i] <= 0) { partMesh.setMatrixAt(i, _zero); continue; }
    PT.life[i] -= dt;
    PT.vy[i] -= 18 * dt; // gravity
    PT.x[i] += PT.vx[i] * dt; PT.y[i] += PT.vy[i] * dt; PT.z[i] += PT.vz[i] * dt;
    // bounce on the road with damping
    if (PT.y[i] < 0.05) { PT.y[i] = 0.05; PT.vy[i] *= -0.3; PT.vx[i] *= 0.7; PT.vz[i] *= 0.7; }
    const k = PT.size[i] * Math.min(1, PT.life[i] * 3); // shrink out during the last third
    _mOut.compose(_v.set(PT.x[i], PT.y[i], PT.z[i]), _qIdent, _s.set(k, k, k));
    partMesh.setMatrixAt(i, _mOut);
  }
  partMesh.instanceMatrix.needsUpdate = true;
}

// ---------- Game state / HUD ----------
const $ = (id) => document.getElementById(id);
const ui = {
  enemyFill: $('enemyFill'), enemyCount: $('enemyCount'),
  bossBar: $('bossBar'), bossFill: $('bossFill'),
  stage: $('stageLabel'),
  hpFill: $('hpFill'), kills: $('kills'), hurt: $('hurt'),
  overlay: $('overlay'), title: $('ovTitle'), text: $('ovText'), btn: $('ovBtn'),
  banner: $('banner'), bannerTitle: $('bannerTitle'), bannerText: $('bannerText'),
  squad: $('squadCount'), powers: $('powers'), toast: $('toast'),
};
let state = 'menu'; // 'menu' | 'play' | 'win' | 'lose'
let stageIdx = 0, stageStartSize = 1;
let kills = 0, remaining = 0, shake = 0, time = 0;
let nextAction = () => startStage(0); // what the overlay button does

const stageTitle = (idx) => `STAGE ${STAGES[idx].id}`;

function showToast(text, color) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  el.style.color = color;
  ui.toast.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// Called every frame, so only touch the DOM when the text actually changes.
let lastPowersText = '';
function updatePowersHud() {
  const parts = [];
  if (player.rapidT > 0) parts.push(`<span class="pw rapid">x2 FIRE RATE ${Math.ceil(player.rapidT)}s</span>`);
  if (player.pierceT > 0) parts.push(`<span class="pw pierce">PIERCE ${Math.ceil(player.pierceT)}s</span>`);
  const html = parts.join('');
  if (html !== lastPowersText) { ui.powers.innerHTML = html; lastPowersText = html; }
}

// Event-driven HUD refresh (kills, hits, pickups) — not called every frame.
function updateHud() {
  ui.squad.textContent = `x${player.size}`;
  ui.enemyFill.style.transform = `scaleX(${stageTotal ? remaining / stageTotal : 0})`;
  ui.enemyCount.textContent = remaining;
  ui.bossBar.classList.toggle('hidden', !boss.active || boss.state === 0);
  ui.bossFill.style.transform = `scaleX(${Math.max(0, boss.hp) / boss.maxHp})`;
  ui.hpFill.style.transform = `scaleX(${Math.min(1, Math.max(0, player.hp) / CFG.playerHp)})`;
  ui.kills.textContent = `${kills} kills`;
  ui.stage.textContent = `${stageTitle(stageIdx)} / ${STAGES.length}`;
}

function killEnemy(i, byPlayer) {
  E.state[i] = 2;
  E.t[i] = 0;
  remaining--;
  W.alive[E.wave[i]]--;
  if (byPlayer) kills++;
  spawnParticles(E.x[i], 1.0, E.z[i], 6, skinColors[i].getHex(), 4);
  spawnParticles(E.x[i], 0.9, E.z[i], 4, 0x9b1b1b, 3.5);
  updateHud();
  checkWin();
}

// `remaining` counts every enemy of the stage, including waves not started yet and queued
// reinforcements, so it only reaches 0 when the whole stage has been fought.
function checkWin() {
  if (state === 'play' && remaining <= 0 && boss.state !== 1) endStage(true);
}

let hurtTimer = 0;
function hurtPlayer(dmg) {
  if (state !== 'play') return;
  player.hp -= dmg;
  shake = Math.max(shake, 0.35);
  ui.hurt.classList.add('on');
  clearTimeout(hurtTimer);
  hurtTimer = setTimeout(() => ui.hurt.classList.remove('on'), 90);
  updateHud();
  if (player.hp <= 0) endStage(false);
}

// carry: squad size brought in from the previous stage (earned soldiers are kept)
function setupStage(idx, carry = 0) {
  stageIdx = idx;
  const st = STAGES[idx];
  resetEnemyPool();
  hideBoss();
  W.queue.length = 0;
  W.alive.length = 0;
  W.timer = 0;
  W.rowTimer = 0;
  startWave(0); // wave 1 is on the bridge from the start (it shows behind the menu too)
  W.next = 1;
  stageTotal = stageEnemyTotal(st);
  B.on.fill(0);
  PT.life.fill(0);
  player.x = player.targetX = player.prevX = 0;
  player.hp = CFG.playerHp;
  player.fireT = 0;
  player.size = stageStartSize = Math.min(SQUAD_MAX, Math.max(st.squad, carry));
  player.rapidT = player.pierceT = 0;
  squad.forEach((s, k) => {
    s.group.visible = s.blob.visible = k < player.size;
  });
  clearPanels();
  // a few panels already on their way so the edges are populated from the start
  for (const z of [-24, -50, -75]) spawnPanel(z);
  kills = 0;
  remaining = stageTotal;
  updateHud();
}

let bannerTimer = 0;
function showBanner(title, text) {
  ui.bannerTitle.textContent = title;
  ui.bannerText.textContent = text;
  ui.banner.classList.add('on');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove('on'), 2200);
}

function startStage(idx, carry = 0) {
  setupStage(idx, carry);
  state = 'play';
  ui.overlay.classList.add('hidden');
  const st = STAGES[idx];
  const squadText = player.size > 1 ? ` · your squad: ${player.size} soldiers` : '';
  showBanner(stageTitle(idx), `${st.name} · ${st.text}${squadText}`);
}

function showOverlay(title, text, btn, action) {
  ui.title.textContent = title;
  ui.text.textContent = text;
  ui.btn.textContent = btn;
  nextAction = action;
  ui.overlay.classList.remove('hidden');
}

function endStage(won) {
  state = won ? 'win' : 'lose';
  const last = stageIdx === STAGES.length - 1;
  // short delay so the final death / explosion is visible before the overlay
  setTimeout(() => {
    if (!won) {
      showOverlay('DEFEAT', `The horde overran you in ${stageTitle(stageIdx).toLowerCase()} · ${kills} kills`,
        'RETRY', () => startStage(stageIdx, stageStartSize));
    } else if (last) {
      showOverlay('TOTAL VICTORY!', 'You held the bridge through every stage', 'PLAY AGAIN', () => startStage(0));
    } else {
      const next = STAGES[stageIdx + 1];
      showOverlay(`${stageTitle(stageIdx)} CLEARED!`, `${kills} kills · next: ${next.name}, ${next.text}`,
        'NEXT STAGE', () => startStage(stageIdx + 1, player.size));
    }
  }, won ? 800 : 900);
}

ui.btn.addEventListener('click', () => nextAction());

// ---------- Controls ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if ((e.code === 'Space' || e.code === 'Enter') && state !== 'play' && !ui.overlay.classList.contains('hidden')) nextAction();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// Relative drag (like a joystick strip): the squad moves by the finger's delta,
// so the player can start the drag anywhere without the squad jumping.
let dragging = false, lastX = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  // capped at 700px so wide desktop screens don't need huge mouse sweeps
  player.targetX += dx * (CFG.roadWidth / Math.min(window.innerWidth, 700)) * 1.2;
});
const endDrag = () => { dragging = false; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// ---------- Main loop ----------
const clock = new THREE.Clock();

function updatePlayer(dt) {
  const playing = state === 'play';
  const st = STAGES[stageIdx];
  const layout = squadLayout(player.size);
  const halfSpan = Math.max(...layout.map(([ox]) => Math.abs(ox)));
  if (playing) {
    player.rapidT = Math.max(0, player.rapidT - dt);
    player.pierceT = Math.max(0, player.pierceT - dt);
  }

  let dir = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) dir -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) dir += 1;
  player.targetX += dir * 11 * dt;
  // a wider squad can move less so its outer soldiers stay on the road
  const lim = HALF_W - 0.7 - halfSpan;
  if (player.sweep) player.targetX = Math.sin(time * 0.9) * lim; // ?debug autopilot
  player.targetX = THREE.MathUtils.clamp(player.targetX, -lim, lim);
  player.prevX = player.x;
  player.x += (player.targetX - player.x) * Math.min(1, dt * 14);

  const vel = (player.x - player.prevX) / Math.max(dt, 1e-4);
  const moveAmt = Math.min(1, Math.abs(vel) / 5);
  squadPos.length = 0;

  layout.forEach(([ox, oz], k) => {
    const s = squad[k];
    const x = player.x + ox, z = player.z + oz;
    squadPos.push({ x, z });
    const t = time * 14 + k * 1.3; // per-soldier phase offset so they don't step in unison
    s.group.position.set(x, Math.abs(Math.sin(t)) * 0.05 * moveAmt, z);
    s.group.rotation.z = THREE.MathUtils.lerp(s.group.rotation.z, -vel * 0.02, 0.2); // lean into the strafe
    const legSwing = Math.sin(t) * 0.6 * moveAmt;
    s.legs[0].rotation.x = legSwing;
    s.legs[1].rotation.x = -legSwing;
    s.recoil = Math.max(0, s.recoil - dt * 18);
    s.gun.position.z = -0.35 + s.recoil * 0.08;
    s.flashT -= dt;
    s.flash.visible = s.flashT > 0;
    if (s.flash.visible) {
      s.flash.scale.setScalar(rand(0.6, 1.1));
      s.flash.material.rotation = rand(0, Math.PI);
    }
    s.blob.position.set(x, 0.01, z);
  });

  if (playing) {
    // Fixed-interval firing with an accumulator: a slow frame fires several volleys
    // instead of silently lowering the fire rate.
    player.fireT -= dt;
    while (player.fireT <= 0) {
      // outer soldiers angle slightly outwards to cover more of the road
      layout.forEach(([ox], k) => fire(squad[k], ox * 0.05));
      player.fireT += st.fireInterval * (player.rapidT > 0 ? 0.5 : 1);
    }
  }
}

function updateCamera(dt) {
  shake = Math.max(0, shake - dt);
  const sx = shake > 0 ? rand(-1, 1) * shake * 0.6 : 0;
  const sy = shake > 0 ? rand(-1, 1) * shake * 0.6 : 0;
  camera.position.set(camBase.x + player.x * camFollow + sx, camBase.y + sy, camBase.z);
  camera.lookAt(camLook.x + player.x * camFollow, camLook.y, camLook.z);
}

function updateScenery(dt) {
  cloudLayers.forEach((t, i) => { t.offset.y += dt * (0.004 + i * 0.003); });
  for (const p of puffs) {
    p.position.z += dt * 2;
    if (p.position.z > 40) p.position.z -= 240;
  }
}

// One simulation step. Kept apart from rendering so ?debug can drive the game without frames.
function simulate(dt) {
  time += dt;
  const playing = state === 'play';
  updatePlayer(dt);
  updatePanels(dt, playing);
  updateEnemies(dt, playing);
  if (playing) updateWaves(dt);
  updateBoss(dt, playing);
  updateBullets(dt);
  updateParticles(dt);
  updateScenery(dt);
}

function frame() {
  // clamp dt so a background tab or a hitch doesn't teleport everything
  const dt = Math.min(clock.getDelta(), 0.05);
  simulate(dt);
  renderEnemies();
  renderBullets();
  updatePowersHud();
  updateCamera(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// version.json is written by the release workflow at deploy time (see .github/workflows/release.yml),
// so the version is never hand-edited. Local and unreleased builds have no file and show "dev".
fetch('version.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => { if (v && v.version) $('version').textContent = `v${v.version}`; })
  .catch(() => {});

// URL params: ?play starts immediately, ?stage=3 jumps to a stage, ?cap=N lowers the active-enemy
// cap (see resetEnemyPool) to exercise reinforcements or test performance on weak devices
const params = new URLSearchParams(location.search);
// (?level=N still works: it was the parameter's name before stages became data)
const stageParam = params.get('stage') ?? params.get('level');
const startIdx = THREE.MathUtils.clamp((parseInt(stageParam, 10) || 1) - 1, 0, STAGES.length - 1);
setupStage(startIdx);
if (params.has('play') || stageParam !== null) startStage(startIdx);
// ?debug exposes the live state to the console and to automated checks
if (params.has('debug')) {
  window.__warIsWar = {
    get stage() { return STAGES[stageIdx].id; }, get state() { return state; },
    get remaining() { return remaining; }, get stageTotal() { return stageTotal; },
    get active() { return activeCap - freeTop; }, get hi() { return hi; }, activeCap,
    get queuedRows() { return W.queue.length; }, get nextWave() { return W.next; },
    get waveAlive() { return [...W.alive]; }, get kills() { return kills; },
    // advance the simulation by `seconds` in fixed 1/60 s steps, without rendering
    step(seconds) { for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60); },
    // stage data and a starter, so checks can load a test stage (push to stages, then start it)
    stages: STAGES,
    start(idx) { validateStages(); startStage(idx); },
    // stand still at x, or sweep the whole road if x is 'sweep'
    aim(x) { player.sweep = x === 'sweep'; if (!player.sweep) player.targetX = x; },
  };
}
requestAnimationFrame(frame);
