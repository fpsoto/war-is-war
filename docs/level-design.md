# WAR IS WAR — Level Design Specification

> This is the reference design for the 30-stage campaign. Each campaign issue cites the section it implements.
> Section 11 records how the design is adapted to this codebase. The balance values are starting points to tune through playtesting.

## 1. Game Overview

War is War is a browser-based 3D horde shooter built with Three.js. The player defends a bridge against increasingly dangerous enemy armies. The campaign contains 30 stages, progressing from basic infantry to elite units, siege machines, giants, and a final boss.

### Core Design Goals
- Preserve the bridge-defense gameplay loop.
- Introduce new enemy mechanics gradually.
- Increase difficulty through enemy combinations, wave pacing, and tactical pressure, not only higher HP.
- Reward the player with meaningful upgrades.
- Make each boss encounter memorable.
- Keep performance stable with hundreds of enemies.

## 2. Enemy Types

| Code | Enemy | Behavior |
|---|---|---|
| S | Soldier | Basic infantry; advances in formation. |
| R | Runner | Fast, low HP, attempts to reach the player quickly. |
| H | Heavy | High HP and armor; resistant to bullets. |
| E | Shieldbearer | Protects enemies behind it. |
| A | Archer | Ranged attacker; high target priority. |
| B | Berserker | Charges quickly and deals high contact damage. |
| D | Demolitionist | Explodes near the squad, damaging multiple soldiers. |
| M | Medic | Heals nearby enemies until eliminated. |
| T | Gunner | Fires slow projectiles that can be dodged. |
| G | Giant | Boss with high HP and melee attacks. |
| W | Siege Machine | Slow unit that fires volleys and controls bridge space. |
| C | Commander | Buffs nearby enemies' speed or defense. |

Enemy quantities represent the total number spawned during a stage, not necessarily enemies active at once. Bosses are listed separately where applicable.

## 3. Campaign: 30 Stages

### Stages 1–10: Learning and Early Threats

| Stage | Name | Enemy Composition | Starting Squad | Main Reward |
|---:|---|---|---:|---|
| 1 | First Contact | 100 S | 1 | No power-up; teach aiming and shooting. |
| 2 | The Bridge | 500 S | 2 | +15% fire rate temporarily. |
| 3 | The Brute | 500 S + 1 G | 3 | Armor-piercing ammunition. |
| 4 | Fast Approach | 120 S + 20 R | 3 | +20% reload speed. |
| 5 | Iron Wall | 140 S + 20 H | 3 | Rifle upgrade: +15% damage. |
| 6 | Broken Formation | 180 S + 30 R + 10 H | 3 | Grenade that damages groups of weak enemies. |
| 7 | Shield Line | 150 S + 30 E + 20 R | 4 | Piercing shot: passes through up to 3 enemies. |
| 8 | Rain of Arrows | 160 S + 25 A + 25 R | 4 | Temporary shield that absorbs damage. |
| 9 | Blood Rush | 180 S + 35 R + 20 B + 15 H | 4 | Overdrive: +30% fire rate for 8 seconds. |
| 10 | The Warlord | 200 S + 30 H + 20 E + 1 reinforced G | 4 | Permanent damage or magazine upgrade. |

Design notes:
- Stage 3 introduces the first boss. The giant must telegraph its attacks with a wind-up animation and a visible impact zone.
- Introduce one new enemy mechanic at a time.
- Use stages 4–9 to teach counters and target prioritization.

### Stages 11–20: Combined Warfare

| Stage | Name | Enemy Composition | Starting Squad | Main Reward |
|---:|---|---|---:|---|
| 11 | Long Range | 220 S + 35 A + 25 H | 4 | Precision sight: +25% long-range damage. |
| 12 | Explosive Charge | 200 S + 30 R + 20 D + 20 E | 4 | 3 defensive mines. |
| 13 | Field Hospital | 220 S + 25 M + 30 H + 20 R | 5 | Restore 30% squad health. |
| 14 | Berserker Horde | 200 S + 50 B + 35 R + 20 H | 5 | Shotgun; high close-range damage. |
| 15 | The Executioner | 250 S + 30 H + 25 E + 1 elite G | 5 | +20% critical-hit chance for the stage. |
| 16 | Siege Begins | 260 S + 40 H + 30 A + 2 W | 5 | Airstrike against a marked area. |
| 17 | Crossfire | 240 S + 40 A + 30 T + 30 R | 5 | Bullet time: slow enemies for 5 seconds. |
| 18 | No Safe Ground | 250 S + 35 D + 30 B + 25 M + 25 E | 6 | Squad shield for 8 seconds. |
| 19 | Iron Legion | 280 S + 60 H + 40 E + 25 C | 6 | Explosive ammunition with area damage. |
| 20 | Siege Titan | 300 S + 40 H + 30 A + 2 W + 1 Titan G | 6 | Choose an epic upgrade: damage, defense, or fire rate. |

Design notes:
- Enemies should support one another. Medics heal heavies, commanders buff runners, and ranged enemies attack while the giant pressures the squad.
- Stage 20 is a major campaign checkpoint.
- Structure Stage 20 into three phases: siege troops, Titan arrival, and final boss combat.

### Stages 21–30: The Last Defense

| Stage | Name | Enemy Composition | Starting Squad | Main Reward |
|---:|---|---|---:|---|
| 21 | Endless March | 350 S + 50 R + 40 H | 6 | Slow automatic reload between waves. |
| 22 | The Hunters | 300 S + 50 B + 35 A + 30 T + 20 E | 6 | Double weapon for 10 seconds. |
| 23 | Demolition Day | 300 S + 50 D + 40 H + 30 M + 2 W | 6 | 2 fragmentation grenades. |
| 24 | The Iron Command | 320 S + 50 H + 40 E + 30 C + 30 A | 7 | Command aura: +15% squad damage. |
| 25 | The Colossus | 350 S + 50 R + 40 H + 1 Colossus G | 7 | Anti-armor ammunition for the boss. |
| 26 | Burning Bridge | 320 S + 50 D + 40 B + 35 T + 2 W | 7 | Emergency sprint: +35% speed for 6 seconds. |
| 27 | Last Battalion | 400 S + 60 H + 50 R + 35 E + 30 M + 25 C | 7 | Revive one fallen soldier once. |
| 28 | War Machine | 350 S + 60 H + 45 A + 35 T + 3 W + 1 elite G | 8 | Automatic turret for 15 seconds. |
| 29 | The Final Assault | 400 S + 60 R + 50 H + 40 B + 35 D + 30 M + 30 A + 2 W + 1 G | 8 | Choose 2 temporary power-ups. |
| 30 | WAR IS WAR | 500 S + 60 H + 50 R + 40 E + 35 A + 30 B + 25 D + 20 M + 3 W + 1 Final Boss | 8 | Unlock endless mode. |

Design notes:
- Stages 25 and 30 require unique boss attack patterns, not only large health pools.
- Stage 30 should combine previously learned mechanics.
- The final boss should have multiple phases, weak points, and clear telegraphs.

## 4. Power-Up System

### Weapons and Damage
- Rifle upgrade: +15% base damage.
- Armor-piercing ammunition: penetrates aligned enemies or reduces armor effectiveness.
- Explosive ammunition: area damage.
- Shotgun: high damage at close range.
- Double weapon: temporarily increases offensive output.

### Defense and Survival
- Shield: absorbs a limited amount of damage.
- Healing: restores 30% squad health.
- Revive: restores one fallen squad member.
- Emergency sprint: allows quick repositioning.
- Squad protection: temporarily reduces incoming damage.

### Crowd Control
- Grenade: damages groups of weak enemies.
- Mines: damage and slow enemies approaching the defensive line.
- Airstrike: attacks a marked area.
- Bullet time: slows enemies for a limited duration.
- Turret: automatically attacks enemies for a short duration.

### Permanent Upgrades
- +10% base damage.
- +10% reload speed.
- +1 maximum squad member at selected milestones.
- +15% squad durability.
- One additional power-up storage slot.

### Reward Rules
- Offer a choice of 3 upgrades after stages 5, 10, 15, 20, and 25.
- Other stages can grant a fixed reward or consumable.
- Limit airstrikes and grenades to 2–3 stored charges per ability.
- Balance upgrades so no single option trivializes later stages.

## 5. Difficulty Progression

Use the following multipliers as initial tuning values. They must be playtested.

| Parameter | Stages 1–5 | Stages 6–15 | Stages 16–25 | Stages 26–30 |
|---|---:|---:|---:|---:|
| Enemy movement speed | 1.0x | 1.1x | 1.2x | 1.25x |
| Basic soldier health | 1.0x | 1.15x | 1.3x | 1.4x |
| Special enemy frequency | Low | Medium | High | Very high |
| Simultaneous waves | 1–2 | 2–3 | 3–4 | 4–5 |
| Wave downtime | 5–8 s | 4–7 s | 3–6 s | 2–5 s |

Balancing rules:
1. Do not increase all enemy health, speed, and damage simultaneously at every stage.
2. Powerful attacks require readable wind-up animations, clear impact zones, and reaction time.
3. Difficulty should come from tactical decisions and enemy combinations, not only bullet-sponge enemies.
4. Add small recovery stages after major bosses when appropriate.
5. Track player deaths, squad survival, average completion time, and power-up usage during playtests.

## 6. Example Wave Structure: Stage 20

### Phase 1: The Vanguard
- 120 soldiers.
- 20 heavy units.
- 15 archers.
- Goal: reduce the formation without spending every resource.

### Phase 2: The Siege
- 180 soldiers.
- 20 shieldbearers.
- 20 heavy units.
- 2 siege machines.
- Goal: force target prioritization and resource management.

### Phase 3: The Titan
- Spawn the Titan boss after most standard enemies are defeated.
- Shift gameplay from crowd clearing to boss survival.
- Use clear attack telegraphs and short recovery windows.

Do not spawn every enemy simultaneously. Stage enemy groups over time to preserve readability and performance.

## 7. Boss Design Requirements

Each major boss should have:
- At least 2–3 distinct attack patterns.
- Clear wind-up animations and telegraphs.
- A recovery window after major attacks.
- A readable health bar and phase transitions.
- A unique mechanic or weak point.
- Different behavior at low health.

Suggested milestone bosses:
- Stage 3: The Brute — basic heavy melee boss.
- Stage 10: The Warlord — armored boss supported by infantry.
- Stage 15: The Executioner — aggressive boss with high-damage attacks.
- Stage 20: Siege Titan — multi-phase siege boss.
- Stage 25: The Colossus — armor and weak-point mechanics.
- Stage 30: Final Boss — combines previously learned mechanics with a unique final phase.

## 8. Three.js Technical Requirements

Represent each stage as data instead of hardcoding individual stage logic. Use a reusable stage manager and wave spawner.

Example configuration:

```js
const stage20 = {
  id: 20,
  name: "Siege Titan",
  squadSize: 6,
  waves: [
    {
      enemies: {
        soldier: 120,
        heavy: 20,
        archer: 15
      }
    },
    {
      enemies: {
        soldier: 180,
        shield: 20,
        heavy: 20,
        siege: 2
      }
    }
  ],
  boss: {
    type: "titan",
    count: 1
  },
  reward: {
    type: "epicUpgrade",
    choices: ["damage", "defense", "fireRate"]
  }
};
```

Adapt the example to the project's existing code and data structures.

### Performance Requirements
- Use object pooling for frequently spawned and removed enemies.
- Use instancing for repeated models when compatible with materials and animation requirements.
- Separate total stage enemy count from the number of simultaneously active enemies.
- Keep AI, collision detection, and physics as simple as possible.
- Use a configurable active-enemy cap and queue reinforcements when capacity becomes available.
- Avoid unnecessary allocations and per-enemy draw calls.
- Profile CPU and GPU performance during the largest waves.

## 9. Acceptance Criteria

- All 30 stages can be loaded from data configurations.
- Every stage has an enemy composition, squad size, and reward.
- Waves spawn in controlled groups instead of overwhelming the browser at once.
- Bosses have distinct attacks and readable telegraphs.
- Power-ups work according to their defined durations and effects.
- Permanent upgrades persist according to the save system.
- The campaign becomes harder without abrupt, unfair spikes.
- The game remains responsive during large enemy waves.
- Stage completion and failure conditions work reliably.
- The final stage unlocks endless mode.

## 10. Implementation Guidelines

1. Inspect the existing codebase before changing anything.
2. Identify the current stage manager, enemy definitions, spawn logic, squad system, weapon system, power-up system, and UI.
3. Preserve existing gameplay and visual style wherever possible.
4. Implement the 30-stage campaign using data-driven configurations.
5. Reuse existing enemy classes and create new types only when needed.
6. Add wave scheduling, boss phases, and reward selection using reusable systems.
7. Add difficulty scaling as configurable parameters rather than scattered constants.
8. Test stages 1, 3, 10, 20, 25, and 30 first, then verify all intermediate stages.
9. Optimize performance before increasing simultaneous enemy counts.
10. Document any assumptions and avoid replacing unrelated project systems.

The design tables are a starting point, not a claim that the balance is final. Tune spawn pacing, active enemy limits, squad durability, and power-up strength through playtesting.

## 11. Adaptations to This Codebase

Decisions taken when the spec was adopted (2026-10-23). They change the existing game, not only add to it:

- **Per-soldier health.** The squad used to share one health bar. Soldiers now have individual HP and can fall: the revive reward, demolitionist blasts and ranged enemies need this (#13).
- **Magazines and reload.** Fire used to be continuous. Soldiers now fire a magazine and reload, so the reload-speed and magazine rewards are meaningful (#14).
- **Two reward systems.** The shootable signs along the bridge edges stay as in-stage power-ups. The rewards in the tables above are granted when a stage is cleared, plus the 3-choice upgrade screen (#17).
- **Save system.** The game had none. Progress, permanent upgrades and the endless-mode unlock are stored in the browser's `localStorage` (#17).
- **Enemy rendering.** Enemy types reuse the instanced body-part meshes, with per-instance color and scale and extra parts only where a type needs them, to keep draw calls flat (#12).
- **Planning.** The campaign is split into one issue per change across Sprints 2–7 (milestones `v0.2.0`–`v0.7.0`) on the "War is War" project board.
