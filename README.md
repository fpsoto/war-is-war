# War is War

A 3D horde shooter that runs in the browser, built with [Three.js](https://threejs.org/).
Your squad holds a bridge above the clouds and fires automatically while hundreds of
enemies march towards it. Shoot the signs along the edges to recruit soldiers and
grab power-ups.

**▶ Play it here: https://fpsoto.github.io/war-is-war/**

Works on desktop, tablets and phones (portrait and landscape).

## How to play

| Input | Action |
|---|---|
| Drag (mouse or finger) | Move the squad left / right |
| `◀` `▶` or `A` `D` | Move the squad left / right |
| `Space` / `Enter` | Confirm on menus |

Firing is automatic. Every enemy that reaches your squad, or slips past it, costs health.

### Stages

1. **100 soldiers** marching in a tight formation.
2. **500 soldiers** filling the bridge wall to wall.
3. **500 soldiers and a giant**: a club-wielding brute about 3.6× the size of a soldier
   walks in the middle of the horde. It soaks bullets and crushes the squad if it reaches it.

Clearing a stage takes you to the next one, and you keep any soldiers you recruited.

### Power-ups

Signs travel down both edges of the bridge. Shoot one until its bar is empty to collect it:

| Sign | Effect |
|---|---|
| **+1 SOLDIER** | Another soldier joins the squad (max 8) |
| **x2 FIRE RATE** | Double fire rate for 8 s |
| **+30 HEALTH** | Restores health |
| **PIERCE** | Bullets go through up to 4 enemies for 6 s |

## Running locally

There is no build step. Three.js is loaded from the jsDelivr CDN through an
[import map](https://developer.mozilla.org/docs/Web/HTML/Element/script/type/importmap).
ES modules do not load from `file://`, so serve the folder over HTTP:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open the printed URL. Handy URL parameters:

- `?level=2` or `?level=3` jumps straight to a stage.
- `?play` skips the start screen.

## Project structure

```
index.html             HUD, overlays and responsive CSS; loads Three.js via an import map
game.js                the whole game: scene, squad, enemies, boss, bullets, power-ups, loop
docs/level-design.md   the 30-stage campaign design
.github/               issue and PR templates, CI and the release workflow
.nojekyll              tells GitHub Pages to serve the files as-is
```

## Tuning

All the balance knobs live at the top of `game.js`:

- `CFG`: road size, bullet speed and range, player health, the distance at which the horde breaks formation.
- `LEVELS`: enemy count, formation, speed, HP, starting squad size, fire rate, contact damage and boss stats per stage.
- `POWERUPS`: label, colours, hits needed and spawn weight of each sign.

## How it stays fast

The game has to animate 500+ enemies at 60 fps, including on phones:

- **Instancing.** Enemies are not individual meshes. Each body part (torso, head, arms, legs)
  is a single `InstancedMesh`, so the whole horde takes 6 draw calls per render pass. The walk cycle is applied by
  writing one matrix per part per enemy.
- **Struct-of-arrays state.** Per-enemy data lives in typed arrays (`E.x`, `E.z`, `E.hp`, …).
  Bullets and particles use fixed-size pools built the same way. Nothing is allocated in the
  game loop, so there are no garbage-collection pauses.
- **Swept collisions.** Bullets move about one unit per frame. Hits are tested against the
  segment each bullet covered during the frame, so fast bullets can't pass through enemies.
  When several targets overlap, the one closest to the player is hit, so front ranks shield
  the ones behind.
- **Local separation only.** Enemies push each other apart (O(k²)) only after they break
  formation near the squad. Further away, the grid spacing keeps them apart.
- **Procedural assets.** Every texture (road, clouds, signs) is drawn on a canvas at runtime.
  The game ships no image files.
- **Responsive camera.** The camera distance is computed from the horizontal field of view,
  so the full width of the road fits on any aspect ratio.

## Roadmap

The game is growing into a 30-stage campaign with 12 enemy types, boss fights, upgrades and an
endless mode. The full design is in [docs/level-design.md](docs/level-design.md). The work is
planned sprint by sprint in the "War is War" GitHub Project, with milestones `v0.2.0` to `v0.7.0`.

## Development workflow

Every change is tracked as a GitHub issue that belongs to a sprint and a version milestone.
The full working agreements are in [CLAUDE.md](CLAUDE.md). In short:

```
issue (#N, Feature/Bug template, milestone, sprint)
  └─ branch feature/N-name from develop ── commits "refs #N"
       └─ PR into develop ("Closes #N" + Summary + Test plan)
            └─ merge → the issue closes with the PR's summary

end of sprint:
  develop ── release/X.Y.Z ── PR "Release X.Y.Z" into main ── merge
                                                               └─ release.yml:
                                                                  deploy to GitHub Pages
                                                                  verify the live version
                                                                  GitHub Release vX.Y.Z + zip
                                                                  close milestone vX.Y.Z
                                                                  back-merge PR into develop
```

- **Branches:** `main` holds only releases, `develop` is the integration branch, and every change gets its own branch from `develop`.
- **Sprints:** 2 weeks, Thursday to Wednesday, tracked in the "War is War" GitHub Project.
- **Versions:** semver, with `0.x` for pre-production and `1.0.0` for the first public launch. The release branch name is the only place a version is written.

## Deployment

GitHub Pages is built from GitHub Actions, and only the release workflow deploys. The live game
changes only when a release is merged into `main`. Its start screen shows the released version,
read from the `version.json` that the release writes.
