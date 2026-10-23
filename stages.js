/*
 * Campaign data: enemy types and stages. Pure data with no imports, so CI can load and validate
 * it with plain Node (see .github/workflows/ci.yml). The design reference is docs/level-design.md.
 *
 * A stage is a list of waves. Each wave brings a formation of enemies and, optionally, a boss.
 * The stage manager in game.js spawns a wave's rows while there is room under the active-enemy
 * cap, queues the rest as reinforcements, and starts the next wave once the previous one is
 * (mostly) cleared.
 */

// Base stats per enemy type. Stages scale speed with `pace`; difficulty tiers (#15) and new
// types (#12) build on this table.
export const ENEMY_TYPES = {
  soldier: { hp: 1, speed: 2.0 },
};

export const BOSS_TYPES = {
  brute: { hp: 160, scale: 3.6 },
};

/*
 * Stage fields:
 *   id, name, text      shown in the banner and the end-of-stage screens
 *   squad               soldiers the stage starts with (at least; earned soldiers carry over)
 *   pace                multiplier on every enemy's base speed in this stage
 *   fireInterval        seconds between volleys (the weapon system in #14 replaces this)
 *   contactDamage       health lost per enemy that reaches or slips past the squad
 *   reward              granted when the stage is cleared (applied by #17; recorded here now)
 *   waves[]:
 *     enemies           { type: count } — the total this wave brings, not the number on screen at once
 *     formation         cols + spacingZ + startZ, and either spacingX or fullWidth: true
 *     boss              optional { type, gap }: spawns in a hole of radius `gap` in the formation
 *     downtime          seconds to wait before this wave once its trigger is met (not for wave 1)
 *     whenRemaining     start once the previous wave has at most this many enemies left (default 0)
 */
export const STAGES = [
  {
    id: 1, name: 'First Contact', text: '100 soldiers in formation',
    squad: 1, pace: 1.0, fireInterval: 0.07, contactDamage: 5,
    reward: { type: 'none' },
    waves: [
      { enemies: { soldier: 100 }, formation: { cols: 10, spacingX: 1.1, spacingZ: 1.8, startZ: -34 } },
    ],
  },
  {
    id: 2, name: 'The Bridge', text: '500 soldiers wall to wall',
    squad: 2, pace: 0.8, fireInterval: 0.06, contactDamage: 4,
    reward: { type: 'fireRateBoost', amount: 0.15, temporary: true },
    waves: [
      { enemies: { soldier: 500 }, formation: { cols: 14, fullWidth: true, spacingZ: 0.95, startZ: -32 } },
    ],
  },
  {
    id: 3, name: 'The Brute', text: '500 soldiers and a giant',
    squad: 3, pace: 0.75, fireInterval: 0.06, contactDamage: 4,
    reward: { type: 'armorPiercing' },
    waves: [
      {
        enemies: { soldier: 500 },
        formation: { cols: 14, fullWidth: true, spacingZ: 0.95, startZ: -32 },
        boss: { type: 'brute', gap: 2.4 },
      },
    ],
  },
];

// Total enemies a stage brings across all its waves (bosses excluded).
export function stageEnemyTotal(stage) {
  let total = 0;
  for (const wave of stage.waves) for (const n of Object.values(wave.enemies)) total += n;
  return total;
}

// Throws on the first malformed stage, so a typo in the data fails CI instead of the browser.
export function validateStages(stages = STAGES) {
  const fail = (stage, msg) => { throw new Error(`Stage ${stage?.id ?? '?'}: ${msg}`); };
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  stages.forEach((s, i) => {
    if (s.id !== i + 1) fail(s, `id must be ${i + 1} (stages are numbered in order)`);
    if (!s.name || !s.text) fail(s, 'name and text are required');
    if (!Number.isInteger(s.squad) || s.squad < 1) fail(s, 'squad must be a positive integer');
    for (const k of ['pace', 'fireInterval', 'contactDamage']) if (!num(s[k]) || s[k] <= 0) fail(s, `${k} must be a positive number`);
    if (!s.reward || !s.reward.type) fail(s, 'reward.type is required');
    if (!Array.isArray(s.waves) || s.waves.length === 0) fail(s, 'at least one wave is required');
    s.waves.forEach((w, wi) => {
      const where = `wave ${wi + 1}`;
      const types = Object.keys(w.enemies || {});
      if (types.length === 0) fail(s, `${where}: enemies is empty`);
      for (const t of types) {
        if (!ENEMY_TYPES[t]) fail(s, `${where}: unknown enemy type '${t}'`);
        if (!Number.isInteger(w.enemies[t]) || w.enemies[t] < 1) fail(s, `${where}: count of '${t}' must be a positive integer`);
      }
      const f = w.formation;
      if (!f || !Number.isInteger(f.cols) || f.cols < 2) fail(s, `${where}: formation.cols must be an integer >= 2`);
      if (!num(f.spacingZ) || !num(f.startZ)) fail(s, `${where}: formation needs spacingZ and startZ`);
      if (!f.fullWidth && !num(f.spacingX)) fail(s, `${where}: formation needs spacingX or fullWidth`);
      if (w.boss && !BOSS_TYPES[w.boss.type]) fail(s, `${where}: unknown boss type '${w.boss.type}'`);
      if (w.boss && !num(w.boss.gap)) fail(s, `${where}: boss.gap is required`);
      if (wi > 0 && w.downtime !== undefined && !num(w.downtime)) fail(s, `${where}: downtime must be a number`);
    });
  });
  return true;
}
