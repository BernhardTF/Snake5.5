# SERPENT SANDS — Build Plan

## Architecture

```
src/
  main.ts                 boot: storage → renderer → audio → ui → app
  app/App.ts              state machine (title / setup / playing / paused / over), glue
  app/Attract.ts          AI snake for the title-screen background
  core/                   loop, rng, events, math, storage (settings/profile), quality
  game/                   PURE simulation (no DOM/three): Sim, GridMover, GlideMover,
                          modes, scoring, spawner, powerups, progression, achievements
  input/                  keyboard, gamepad, touch (swipe/dpad/drag/halves), mouse
  render/                 Three.js: GameRenderer, sand (deform sim + shaders), snake view,
                          props (food/obstacles/powerups), particles, post-fx, frames
  audio/                  AudioEngine: buses, synth voices, sfx, generative music
  ui/                     DOM screens, HUD, widgets, styles.css
  biomes/                 biome definitions (data only)
  skins/                  skin definitions (data only)
  types.ts                shared contracts (RenderFrame, GameEvent, configs)
```

### Data flow per frame

```
input → intents ─┐
                 ▼
     Sim.step(fixed 120 Hz, dt×timeScale)  ──► GameEvent[]
                 │                               │
                 ▼                               ├─► AudioEngine.handleEvents
      Sim.renderFrame() : RenderFrame            ├─► UI (hud, popups, toasts)
                 │                               └─► progression / achievements
                 ▼
      GameRenderer.render(frame)
```

The simulation is deterministic given a seed and an input stream, and it has unit tests. The
renderer only reads `RenderFrame`.

### World space
- 1 world unit = 1 cell. The board spans `(0,0)` to `(W,H)` on the XY plane. **+Z points up out
  of the sand, toward the camera.**
- The orthographic camera looks down −Z. The sun is a normalised vec3 with z > 0.

## Phases

| Phase | Deliverable | Owner |
|---|---|---|
| 0 | Spec, plan, scaffold (Vite/TS/three/vitest), shared contracts, biome/skin data | lead |
| 1a | Simulation: movers, modes, scoring, power-ups, spawner, progression, achievements, tests | lead |
| 1b | Sand renderer: deform sim, 5 biome sand shaders, frame borders, shadow RT, leaf-shadow texture, post-fx, particles, quality tiers | agent **render-sand** |
| 1c | Snake and props views: tube mesh, head/eyes/tongue, 8 skins, bulge/death, food ×5, obstacles ×5, power-up pickups | agent **render-snake** |
| 1d | Audio engine: buses, reverb, synth voices, SFX, 5 generative biome scores, slither loop | agent **audio** |
| 1e | UI: all screens, HUD, widgets, styles, focus and gamepad navigation | agent **ui** |
| 1f | Input: keyboard, gamepad, touch schemes, haptics | lead |
| 2 | Integration: App state machine, attract mode, settings application, PWA, icons | lead |
| 3 | Visual QA via headless Chromium screenshots of every biome/screen, perf pass, tuning | lead + agents |
| 4 | Review pass (bugs), README, GitHub Pages workflow, push | lead + reviewer agent |

## Acceptance checklist
- [ ] `npm run build`, `npm test` and `npm run typecheck` all pass
- [ ] Every screen is reachable and works with mouse, keyboard, gamepad and touch
- [ ] All 5 biomes render distinct sand, trails, props, food and music
- [ ] Grid and Glide modes are both playable in all 5 game modes
- [ ] Scores, settings, unlocks and achievements persist across reloads
- [ ] Installable PWA that works offline
- [ ] Quality tiers switch without a reload; auto quality adapts
