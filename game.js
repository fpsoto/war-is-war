import * as THREE from 'three';

// ---------- Config ----------
const CFG = {
  roadWidth: 12,
  roadLength: 280,
  roadStart: 30,          // z donde empieza la carretera (hacia la cámara)
  maxEnemies: 520,
  bulletSpeed: 55,
  bulletRange: 95,
  spread: 0.03,
  playerHp: 100,
  funnelDist: 14,         // a esta distancia la formación se rompe y va hacia el jugador
};
const HALF_W = CFG.roadWidth / 2;

// Etapas: la dificultad se ajusta aquí.
const LEVELS = [
  {
    title: 'ETAPA 1', text: '100 soldados en formación',
    count: 100, cols: 10, spacingX: 1.1, spacingZ: 1.8, startZ: -34,
    hp: 1, speed: 2.0, squad: 1, fireInterval: 0.07, contactDamage: 5,
  },
  {
    title: 'ETAPA 2', text: '500 soldados de pared a pared',
    count: 500, cols: 14, fullWidth: true, spacingZ: 0.95, startZ: -32,
    hp: 1, speed: 1.6, squad: 2, fireInterval: 0.06, contactDamage: 4,
  },
  {
    title: 'ETAPA 3', text: '500 soldados y un gigante',
    count: 500, cols: 14, fullWidth: true, spacingZ: 0.95, startZ: -32,
    hp: 1, speed: 1.5, squad: 3, fireInterval: 0.06, contactDamage: 4,
    boss: { hp: 160, scale: 3.6, gap: 2.4 },
  },
];

// ---------- Renderer / escena / cámara ----------
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// en móviles limitamos la resolución para mantener la fluidez con 500 enemigos
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
const FRAME_HALF_W = 7.6; // media anchura que debe verse a la altura del pelotón (carretera + carteles)
let camFollow = 0.45;     // cuánto sigue la cámara al jugador en x

// Encuadre responsivo: la cámara se aleja lo justo para que el ancho de la
// carretera quepa en pantalla con cualquier relación de aspecto.
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  camera.aspect = aspect;
  camera.fov = THREE.MathUtils.clamp(55 + (1 - aspect) * 12, 50, 66);
  camera.updateProjectionMatrix();

  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfHFov = Math.atan(halfH * aspect);
  const dist = Math.max(CAM_MIN_DIST, FRAME_HALF_W / Math.tan(halfHFov));
  camBase.copy(CAM_DIR).multiplyScalar(dist);
  // en vertical hay más alto disponible: miramos más al fondo para ver la horda
  camLook.set(0, 0, aspect < 1 ? -14 - (1 - aspect) * 10 : -14);
  // en pantallas estrechas la cámara sigue menos al jugador para no salirse
  camFollow = aspect < 1 ? 0.2 : 0.45;
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
onResize();

// ---------- Utilidades de texturas ----------
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

// ---------- Cielo y luces ----------
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
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 65, bottom: -65, near: 1, far: 140 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ---------- Escenario: puente sobre las nubes ----------
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
  [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]
);
road.position.set(0, -0.6, roadZ);
road.receiveShadow = true;
scene.add(road);

// viga inferior y pilares que se hunden en las nubes
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

// barandas laterales
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.7, metalness: 0.3 });
for (const side of [-1, 1]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, CFG.roadLength), wallMat);
  wall.position.set(side * (HALF_W + 0.17), 0.3, roadZ);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
}

document.fonts.load('76px "Lilita One"');

// mar de nubes
const cloudTex = canvasTex(512, 512, (g, w, h) => {
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 30 + Math.random() * 100;
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
// nubes sueltas a los lados del puente
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
// ruinas lejanas entre las nubes
const ruinMat = new THREE.MeshStandardMaterial({ color: 0x8a96a6, roughness: 1 });
for (let i = 0; i < 40; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const h = rand(10, 40);
  const b = new THREE.Mesh(new THREE.BoxGeometry(rand(3, 9), h, rand(3, 9)), ruinMat);
  b.position.set(side * rand(45, 140), -38 + h / 2, rand(-240, -20));
  b.rotation.y = rand(0, Math.PI);
  scene.add(b);
}

// ---------- Soldados del jugador ----------
const heroMats = {
  armor: new THREE.MeshStandardMaterial({ color: 0x2f5fd0, metalness: 0.45, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1c2232, metalness: 0.4, roughness: 0.55 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd8a542, metalness: 0.85, roughness: 0.3 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe0b08a, roughness: 0.7 }),
};

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

  // brazos sujetando el arma
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

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  scene.add(blob);

  return { group: g, legs, gun, muzzle, flash, blob, recoil: 0, flashT: 0 };
}

// formación del pelotón: filas de hasta 4, las más llenas delante
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
const squad = [];
for (let i = 0; i < SQUAD_MAX; i++) {
  const s = buildSoldier();
  s.group.visible = s.blob.visible = false;
  scene.add(s.group);
  squad.push(s);
}

const player = {
  x: 0, targetX: 0, z: 0, hp: CFG.playerHp, fireT: 0, prevX: 0, size: 1,
  rapidT: 0, pierceT: 0, // power-ups temporales (segundos restantes)
};
const squadPos = []; // [{x,z}] posiciones mundiales de los soldados activos

// ---------- Enemigos (InstancedMesh por parte del cuerpo) ----------
const MAX_E = CFG.maxEnemies;
const E = {
  x: new Float32Array(MAX_E), z: new Float32Array(MAX_E),
  vx: new Float32Array(MAX_E), sepX: new Float32Array(MAX_E), sepZ: new Float32Array(MAX_E),
  speed: new Float32Array(MAX_E), phase: new Float32Array(MAX_E), scale: new Float32Array(MAX_E),
  yaw: new Float32Array(MAX_E), hp: new Int8Array(MAX_E),
  state: new Uint8Array(MAX_E), // 0 oculto, 1 vivo, 2 muriendo
  t: new Float32Array(MAX_E), flash: new Float32Array(MAX_E),
};
let N = 0; // enemigos activos en la etapa
const bodyColors = [];
const skinColors = [];

function makeInst(geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, MAX_E);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = true;
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
const lambert = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
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

// Formación en rejilla; deja un hueco en el centro si hay jefe.
function spawnFormation(lv) {
  const cols = lv.cols;
  const spacingX = lv.fullWidth ? (CFG.roadWidth - 1.0) / (cols - 1) : lv.spacingX;
  const x0 = -spacingX * (cols - 1) / 2;
  const rowsNeeded = Math.ceil(lv.count / cols);
  const bossZ = lv.startZ - (rowsNeeded * lv.spacingZ) / 2 - 1;
  let n = 0;
  for (let row = 0; n < lv.count; row++) {
    for (let c = 0; c < cols && n < lv.count; c++) {
      const x = x0 + c * spacingX;
      const z = lv.startZ - row * lv.spacingZ;
      if (lv.boss && Math.hypot(x, (z - bossZ) * 0.8) < lv.boss.gap) continue;
      E.x[n] = x + rand(-0.04, 0.04);
      E.z[n] = z + rand(-0.04, 0.04);
      E.vx[n] = 0;
      E.speed[n] = lv.speed;
      E.phase[n] = (row % 2) * 0.4; // marcha casi sincronizada
      E.scale[n] = rand(0.95, 1.05);
      E.hp[n] = lv.hp;
      E.state[n] = 1;
      E.t[n] = 0;
      E.flash[n] = 0;
      E.yaw[n] = 0;
      n++;
    }
  }
  N = n;
  for (let i = N; i < MAX_E; i++) E.state[i] = 0;
  for (const key in parts) parts[key].count = N;
  return bossZ;
}

const _mBase = new THREE.Matrix4(), _mPart = new THREE.Matrix4(), _mOut = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _qIdent = new THREE.Quaternion();
const _white = new THREE.Color(0xffffff);

function setPart(mesh, i, px, py, pz, rx) {
  _e.set(rx, 0, 0);
  _q.setFromEuler(_e);
  _mPart.compose(_v.set(px, py, pz), _q, _s.set(1, 1, 1));
  _mOut.multiplyMatrices(_mBase, _mPart);
  mesh.setMatrixAt(i, _mOut);
}

// devuelve el soldado del pelotón más cercano en x
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
  const lv = LEVELS[levelIdx];
  // separación sólo para los que ya rompieron la formación (cerca del jugador)
  let nNear = 0;
  for (let i = 0; i < N; i++) {
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
          const d = Math.sqrt(d2), f = (0.75 - d) / 0.75 * 5 / d;
          E.sepX[i] += dx * f; E.sepZ[i] += dz * f;
          E.sepX[j] -= dx * f; E.sepZ[j] -= dz * f;
        }
      }
    }
  }

  for (let i = 0; i < N; i++) {
    const st = E.state[i];
    if (st === 0) continue;
    if (st === 1) {
      if (playing) {
        const distToPlayer = player.z - E.z[i];
        let vx = 0;
        if (distToPlayer < CFG.funnelDist) {
          const pull = 1 - Math.max(0, distToPlayer) / CFG.funnelDist; // 0 → 1 al acercarse
          const tx = nearestSquadX(E.x[i]);
          vx = THREE.MathUtils.clamp((tx - E.x[i]) * 1.2, -2.2, 2.2) * pull;
        }
        E.vx[i] += (vx - E.vx[i]) * Math.min(1, dt * 4);
        E.x[i] += (E.vx[i] + E.sepX[i]) * dt;
        E.z[i] += (E.speed[i] + Math.max(-1, E.sepZ[i])) * dt;
        E.x[i] = THREE.MathUtils.clamp(E.x[i], -HALF_W + 0.4, HALF_W - 0.4);
        E.yaw[i] = Math.atan2(E.vx[i], E.speed[i]) * 0.7;

        let touched = E.z[i] > player.z + 1.5;
        for (const p of squadPos) {
          const dx = E.x[i] - p.x, dz = E.z[i] - p.z;
          if (dx * dx + dz * dz < 0.8 * 0.8) { touched = true; break; }
        }
        if (touched) {
          hurtPlayer(lv.contactDamage);
          killEnemy(i, false);
        }
      }
      E.phase[i] += dt * E.speed[i] * 3.6;
    } else if (st === 2) {
      E.t[i] += dt;
      if (E.t[i] > 1.3) { E.state[i] = 0; continue; }
    }
    if (E.flash[i] > 0) E.flash[i] -= dt;
  }
}

function renderEnemies() {
  const P = parts;
  for (let i = 0; i < N; i++) {
    const st = E.state[i];
    if (st === 0) {
      P.torso.setMatrixAt(i, _zero); P.head.setMatrixAt(i, _zero);
      P.legL.setMatrixAt(i, _zero); P.legR.setMatrixAt(i, _zero);
      P.armL.setMatrixAt(i, _zero); P.armR.setMatrixAt(i, _zero);
      continue;
    }
    let fall = 0, sink = 0;
    if (st === 2) {
      const t = E.t[i];
      fall = -Math.min(t / 0.3, 1) * Math.PI / 2;
      sink = Math.max(0, t - 0.7) * 1.2;
    }
    const ph = E.phase[i];
    const bob = st === 1 ? Math.abs(Math.sin(ph)) * 0.07 : 0;
    _e.set(fall, E.yaw[i], 0, 'YXZ');
    _q.setFromEuler(_e);
    _e.order = 'XYZ';
    const k = E.scale[i];
    _mBase.compose(_v.set(E.x[i], bob - sink, E.z[i]), _q, _s.set(k, k, k));

    const swing = st === 1 ? Math.sin(ph) * 0.7 : 0;
    const armSwing = st === 1 ? Math.sin(ph * 0.5) * 0.15 : 0.6;
    setPart(P.legL, i, -0.13, 0.55, 0, swing);
    setPart(P.legR, i, 0.13, 0.55, 0, -swing);
    setPart(P.torso, i, 0, 0.86, 0, 0);
    setPart(P.head, i, 0, 1.38, 0.02, 0);
    setPart(P.armL, i, -0.34, 1.07, 0, -0.2 + armSwing);
    setPart(P.armR, i, 0.34, 1.07, 0, -0.2 - armSwing);

    const flashing = E.flash[i] > 0;
    P.torso.setColorAt(i, flashing ? _white : bodyColors[i]);
    P.head.setColorAt(i, flashing ? _white : skinColors[i]);
  }
  for (const key in P) P[key].instanceMatrix.needsUpdate = true;
  P.torso.instanceColor.needsUpdate = true;
  P.head.instanceColor.needsUpdate = true;
}

// ---------- Gigante (jefe de la etapa 3) ----------
function buildGiant() {
  const g = new THREE.Group();
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

  // mira hacia +z (hacia el jugador)
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
  // cabeza
  mk(new THREE.SphereGeometry(0.26, 16, 12), skin, 0, 1.56, 0.05);
  mk(new THREE.BoxGeometry(0.32, 0.13, 0.24), skin, 0, 1.43, 0.15);
  for (const sx of [-1, 1]) {
    const tusk = mk(new THREE.ConeGeometry(0.03, 0.12, 6), bone, sx * 0.1, 1.53, 0.26);
    tusk.rotation.x = -0.3;
    const horn = mk(new THREE.ConeGeometry(0.06, 0.34, 8), bone, sx * 0.22, 1.78, 0);
    horn.rotation.z = -sx * 0.7;
    mk(new THREE.SphereGeometry(0.04, 8, 6), eyes, sx * 0.09, 1.62, 0.27).castShadow = false;
  }
  // brazos
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.55, 1.26, 0);
    g.add(arm);
    mk(new THREE.BoxGeometry(0.24, 0.66, 0.26), skin, 0, -0.33, 0, arm);
    mk(new THREE.SphereGeometry(0.16, 12, 10), skin, 0, -0.7, 0, arm);
    arms.push(arm);
  }
  // garrote en la mano derecha
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
const boss = { active: false, state: 0, hp: 0, maxHp: 1, x: 0, z: 0, speed: 1, phase: 0, flash: 0, t: 0, scale: 1, lastStep: 0 };

function spawnBoss(lv, z) {
  boss.active = true;
  boss.state = 1;
  boss.hp = boss.maxHp = lv.boss.hp;
  boss.scale = lv.boss.scale;
  boss.x = 0;
  boss.z = z;
  boss.speed = lv.speed;
  boss.phase = 0;
  boss.flash = 0;
  boss.t = 0;
  giant.group.visible = true;
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
        hurtPlayer(CFG.playerHp); // el gigante aplasta al pelotón
        shake = 0.8;
      }
    }
    boss.phase += dt * boss.speed * 2.2;
    const step = Math.sin(boss.phase);
    giant.legs[0].rotation.x = step * 0.45;
    giant.legs[1].rotation.x = -step * 0.45;
    giant.arms[0].rotation.x = -step * 0.35;
    // levanta el garrote cuando está cerca
    const near = THREE.MathUtils.clamp((boss.z - (player.z - 18)) / 10, 0, 1);
    giant.arms[1].rotation.x = step * 0.35 * (1 - near) - near * (2.4 + Math.sin(time * 6) * 0.3);
    g.rotation.set(0, 0, step * 0.05);
    g.position.set(boss.x, Math.abs(Math.cos(boss.phase)) * 0.12, boss.z);
    // temblor en cada pisada
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

// ---------- Paneles de power-up en los bordes ----------
// Avanzan desde el fondo por los laterales; hay que dispararles hasta vaciar su contador.
const POWERUPS = {
  soldier: { label: '+1', sub: 'SOLDADO', bg: '#2f6fe0', edge: 0x1b3f8f, ink: '#ffffff', hits: 6, weight: 45 },
  rapid:   { label: 'x2', sub: 'CADENCIA', bg: '#ffc928', edge: 0xc79a12, ink: '#4a2f00', hits: 8, weight: 20 },
  heal:    { label: '+30', sub: 'VIDA', bg: '#2cbf47', edge: 0x1c8a32, ink: '#ffffff', hits: 5, weight: 15 },
  pierce:  { label: '>>>', sub: 'PERFORA', bg: '#9b2fd6', edge: 0x5e1385, ink: '#ffffff', hits: 10, weight: 20 },
};
const PANEL = { w: 2.3, h: 1.4, x: HALF_W - 0.2, speed: 3.6, spawnZ: -95, hitHalfW: 1.15 };
const PANEL_DURATION = { rapid: 8, pierce: 6 };
const panelGeo = new THREE.BoxGeometry(PANEL.w, PANEL.h, 0.2);
const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.9, 8);
const postMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.5, roughness: 0.5 });
const panels = [];
let panelTimer = 1.5;

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
  // barra de impactos restantes
  const bw = w - 60, bx = 30, by = h - 34;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(bx, by, bw, 14);
  g.fillStyle = def.ink;
  g.fillRect(bx, by, bw * (p.hits / p.maxHits), 14);
  p.tex.needsUpdate = true;
}

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
  board.rotation.set(-0.35, -side * 0.15, 0);
  board.castShadow = true;
  group.add(board);
  for (const px of [-0.8, 0.8]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, 0.45, 0);
    post.castShadow = true;
    group.add(post);
  }
  const hits = Math.round(def.hits * (1 + levelIdx * 0.35));
  const p = {
    type, side, group, board, face, edgeMat, canvas, ctx: canvas.getContext('2d'), tex,
    hits, maxHits: hits, x: side * PANEL.x, z, flash: 0, wobble: 0,
  };
  group.position.set(p.x, 0, p.z);
  scene.add(group);
  drawPanel(p);
  panels.push(p);
}

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
    if (p.z > player.z + 4) { removePanel(p); continue; }
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
      showToast('+1 SOLDADO', '#4f8cff');
    }
  } else if (type === 'rapid') {
    player.rapidT = PANEL_DURATION.rapid;
    showToast('¡CADENCIA x2!', '#ffc928');
  } else if (type === 'heal') {
    player.hp = Math.min(CFG.playerHp, player.hp + 30);
    showToast('+30 VIDA', '#2cbf47');
  } else if (type === 'pierce') {
    player.pierceT = PANEL_DURATION.pierce;
    showToast('¡BALAS PERFORANTES!', '#c06bff');
  }
  updateHud();
}

// ---------- Balas ----------
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
  if (i < 0) return;
  soldier.muzzle.getWorldPosition(_muzzlePos);
  const a = rand(-CFG.spread, CFG.spread) + outward;
  B.x[i] = _muzzlePos.x; B.y[i] = _muzzlePos.y; B.z[i] = _muzzlePos.z;
  B.vx[i] = Math.sin(a) * CFG.bulletSpeed;
  B.vz[i] = -Math.cos(a) * CFG.bulletSpeed;
  B.dist[i] = 0;
  B.on[i] = 1;
  B.pierce[i] = player.pierceT > 0 ? 4 : 0; // atraviesa hasta 4 enemigos
  bulletMesh.setColorAt(i, B.pierce[i] ? PIERCE_COLOR : BULLET_COLOR);
  bulletMesh.instanceColor.needsUpdate = true;
  soldier.recoil = 1;
  soldier.flashT = 0.04;
}

function updateBullets(dt) {
  for (let b = 0; b < B_MAX; b++) {
    if (!B.on[b]) continue;
    const pz = B.z[b];
    B.x[b] += B.vx[b] * dt;
    B.z[b] += B.vz[b] * dt;
    B.dist[b] += CFG.bulletSpeed * dt;
    if (B.dist[b] > CFG.bulletRange) { B.on[b] = 0; continue; }
    // barrido entre la posición anterior y la nueva para no atravesar enemigos
    const zMin = B.z[b] - 0.35, zMax = pz + 0.35;
    let hit = -1, best = -Infinity;
    for (let i = 0; i < N; i++) {
      if (E.state[i] !== 1) continue;
      const ez = E.z[i];
      if (ez < zMin || ez > zMax) continue;
      if (Math.abs(E.x[i] - B.x[b]) > 0.42 * E.scale[i]) continue;
      if (ez > best) { best = ez; hit = i; }
    }
    // los paneles de power-up también reciben balas (gana el más cercano al jugador)
    let panelHit = null;
    for (const p of panels) {
      if (p.z < zMin || p.z > zMax || p.z <= best) continue;
      if (Math.abs(p.x - B.x[b]) > PANEL.hitHalfW) continue;
      if (!panelHit || p.z > panelHit.z) panelHit = p;
    }
    // el gigante también bloquea balas
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
    _e.set(0, Math.atan2(B.vx[b], B.vz[b]), 0);
    _q.setFromEuler(_e);
    _mOut.compose(_v.set(B.x[b], B.y[b], B.z[b]), _q, _s.set(1, 1, 1));
    bulletMesh.setMatrixAt(b, _mOut);
  }
  bulletMesh.instanceMatrix.needsUpdate = true;
}

// ---------- Partículas ----------
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
    PT.vy[i] -= 18 * dt;
    PT.x[i] += PT.vx[i] * dt; PT.y[i] += PT.vy[i] * dt; PT.z[i] += PT.vz[i] * dt;
    if (PT.y[i] < 0.05) { PT.y[i] = 0.05; PT.vy[i] *= -0.3; PT.vx[i] *= 0.7; PT.vz[i] *= 0.7; }
    const k = PT.size[i] * Math.min(1, PT.life[i] * 3);
    _mOut.compose(_v.set(PT.x[i], PT.y[i], PT.z[i]), _qIdent, _s.set(k, k, k));
    partMesh.setMatrixAt(i, _mOut);
  }
  partMesh.instanceMatrix.needsUpdate = true;
}

// ---------- Estado del juego / HUD ----------
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
let state = 'menu';
let levelIdx = 0, levelStartSize = 1;
let kills = 0, remaining = 0, shake = 0, time = 0;
let nextAction = () => startLevel(0);

function showToast(text, color) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  el.style.color = color;
  ui.toast.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

let lastPowersText = '';
function updatePowersHud() {
  const parts = [];
  if (player.rapidT > 0) parts.push(`<span class="pw rapid">x2 CADENCIA ${Math.ceil(player.rapidT)}s</span>`);
  if (player.pierceT > 0) parts.push(`<span class="pw pierce">PERFORA ${Math.ceil(player.pierceT)}s</span>`);
  const html = parts.join('');
  if (html !== lastPowersText) { ui.powers.innerHTML = html; lastPowersText = html; }
}

function updateHud() {
  ui.squad.textContent = `x${player.size}`;
  ui.enemyFill.style.transform = `scaleX(${N ? remaining / N : 0})`;
  ui.enemyCount.textContent = remaining;
  ui.bossBar.classList.toggle('hidden', !boss.active || boss.state === 0);
  ui.bossFill.style.transform = `scaleX(${Math.max(0, boss.hp) / boss.maxHp})`;
  ui.hpFill.style.transform = `scaleX(${Math.min(1, Math.max(0, player.hp) / CFG.playerHp)})`;
  ui.kills.textContent = `${kills} bajas`;
  ui.stage.textContent = `${LEVELS[levelIdx].title} / ${LEVELS.length}`;
}

function killEnemy(i, byPlayer) {
  E.state[i] = 2;
  E.t[i] = 0;
  remaining--;
  if (byPlayer) kills++;
  spawnParticles(E.x[i], 1.0, E.z[i], 6, skinColors[i].getHex(), 4);
  spawnParticles(E.x[i], 0.9, E.z[i], 4, 0x9b1b1b, 3.5);
  updateHud();
  checkWin();
}

function checkWin() {
  if (state === 'play' && remaining <= 0 && boss.state !== 1) endLevel(true);
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
  if (player.hp <= 0) endLevel(false);
}

// carry: soldados con los que se llega a la etapa (los ganados antes se conservan)
function setupLevel(idx, carry = 0) {
  levelIdx = idx;
  const lv = LEVELS[idx];
  const bossZ = spawnFormation(lv);
  if (lv.boss) spawnBoss(lv, bossZ); else hideBoss();
  B.on.fill(0);
  PT.life.fill(0);
  player.x = player.targetX = player.prevX = 0;
  player.hp = CFG.playerHp;
  player.fireT = 0;
  player.size = levelStartSize = Math.min(SQUAD_MAX, Math.max(lv.squad, carry));
  player.rapidT = player.pierceT = 0;
  squad.forEach((s, k) => {
    s.group.visible = s.blob.visible = k < player.size;
  });
  clearPanels();
  // primeros paneles ya en camino para que se vean desde el inicio
  for (const z of [-24, -50, -75]) spawnPanel(z);
  kills = 0;
  remaining = N;
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

function startLevel(idx, carry = 0) {
  setupLevel(idx, carry);
  state = 'play';
  ui.overlay.classList.add('hidden');
  const lv = LEVELS[idx];
  const squadText = player.size > 1 ? ` · tu pelotón: ${player.size} soldados` : '';
  showBanner(lv.title, lv.text + squadText);
}

function showOverlay(title, text, btn, action) {
  ui.title.textContent = title;
  ui.text.textContent = text;
  ui.btn.textContent = btn;
  nextAction = action;
  ui.overlay.classList.remove('hidden');
}

function endLevel(won) {
  state = won ? 'win' : 'lose';
  const last = levelIdx === LEVELS.length - 1;
  setTimeout(() => {
    if (!won) {
      showOverlay('DERROTA', `La horda te alcanzó en la ${LEVELS[levelIdx].title.toLowerCase()} · ${kills} bajas`,
        'REINTENTAR', () => startLevel(levelIdx, levelStartSize));
    } else if (last) {
      showOverlay('¡VICTORIA TOTAL!', 'Derrotaste a la horda y al gigante', 'JUGAR DE NUEVO', () => startLevel(0));
    } else {
      showOverlay(`¡${LEVELS[levelIdx].title} SUPERADA!`, `${kills} bajas · siguiente: ${LEVELS[levelIdx + 1].text}`,
        'SIGUIENTE ETAPA', () => startLevel(levelIdx + 1, player.size));
    }
  }, won ? 800 : 900);
}

ui.btn.addEventListener('click', () => nextAction());

// ---------- Controles ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if ((e.code === 'Space' || e.code === 'Enter') && state !== 'play' && !ui.overlay.classList.contains('hidden')) nextAction();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

let dragging = false, lastX = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  player.targetX += dx * (CFG.roadWidth / Math.min(window.innerWidth, 700)) * 1.2;
});
const endDrag = () => { dragging = false; };
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// ---------- Bucle principal ----------
const clock = new THREE.Clock();

function updatePlayer(dt) {
  const playing = state === 'play';
  const lv = LEVELS[levelIdx];
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
  const lim = HALF_W - 0.7 - halfSpan;
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
    const t = time * 14 + k * 1.3;
    s.group.position.set(x, Math.abs(Math.sin(t)) * 0.05 * moveAmt, z);
    s.group.rotation.z = THREE.MathUtils.lerp(s.group.rotation.z, -vel * 0.02, 0.2);
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
    player.fireT -= dt;
    while (player.fireT <= 0) {
      // los soldados de los extremos abren un poco el ángulo para cubrir más ancho
      layout.forEach(([ox], k) => fire(squad[k], ox * 0.05));
      player.fireT += lv.fireInterval * (player.rapidT > 0 ? 0.5 : 1);
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

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const playing = state === 'play';

  updatePlayer(dt);
  updatePanels(dt, playing);
  updateEnemies(dt, playing);
  updateBoss(dt, playing);
  updateBullets(dt);
  updateParticles(dt);
  updateScenery(dt);
  renderEnemies();
  renderBullets();
  updatePowersHud();
  updateCamera(dt);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ?play arranca directo, ?level=3 salta a una etapa
const params = new URLSearchParams(location.search);
const startIdx = THREE.MathUtils.clamp((parseInt(params.get('level'), 10) || 1) - 1, 0, LEVELS.length - 1);
setupLevel(startIdx);
if (params.has('play') || params.has('level')) startLevel(startIdx);
requestAnimationFrame(frame);
