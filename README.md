# Serpent Sands

*Snake, re-imagined.* A 2026 remake of Snake in which the board is a living sand diorama, seen
from above. The snake is a lit 3D creature that presses a lasting groove into the sand. There are
five worlds, and each has its own culture, light, sand behaviour and music.

| World | Place | What the sand does |
|---|---|---|
| **Karesansui** | Kyoto, Japan | Raked gravel and stones with ripple rings; trails are permanent |
| **Erg Chebbi** | Sahara, Morocco | Wind ripples; the wind slowly erases your trail |
| **Motu Lagoon** | Polynesia | Wet sunset sand; waves roll in and wash trails away |
| **Svartsandur** | Iceland | Black volcanic sand; your trail cracks the crust and exposes glowing embers |
| **Salar** | Bolivia | Salt-crust polygons under a mirror film; wet trails dry over time |

## Features
- **Movement**: *Classic Grid* (four directions, corner forgiveness, input buffering) or
  *Free Glide* (analog steering).
- **Modes**: Classic, Arcade (power-ups, golden food, rolling hazards), Zen (no death, wrapping
  walls), Time Attack (120 s), and Daily Seed (the same board for everyone each day).
- **Scoring**: combos up to ×8, near-miss bonuses, length milestones, and a *pattern* score for
  how much of the garden you've raked.
- **Power-ups**: Slow Time, Ghost, Magnet, Double, Shed Skin.
- **Progression**: levels, 24 achievements, 8 unlockable snakes, and per-mode, per-world records
  with lifetime statistics.
- **Graphics**: GPU sand-deformation simulation, a procedural snake and props, soft contact
  shadows, leaf and cloud shadows, bloom, tilt-shift, colour grading, and quality presets that can
  switch automatically.
- **Audio**: fully procedural (Web Audio), with a generative score per world that builds with
  your combo.
- **Controls**: keyboard, gamepad, touch (swipe / D-pad / drag / left-right halves), optional
  mouse steering, and haptics on supported devices.
- **Installable PWA**, playable offline.

## Controls
| | Grid | Glide | Menus |
|---|---|---|---|
| Keyboard | Arrows / WASD | ←/→ steer, ↑/↓ point up/down | Arrows, Enter, Esc |
| Gamepad | D-pad / stick | Stick = heading, bumpers/triggers steer | D-pad, A, B, Start |
| Touch | Swipe (or D-pad option) | Drag to steer (or tap left/right halves) | Tap |

Esc / P / Start pauses the game.

## Development
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation unit tests (vitest)
npm run build      # typecheck + production build into dist/
```

Dev harnesses (these work with `npm run dev`):
- `/?dev=render&biome=erg&ff=900&path=grid`: the renderer with a scripted snake.
- `/?dev=snake&mode=skins`: snake and props preview.
- `/?dev=audio` and `/?dev=audio&selftest=1`: audio bench and offline self-test.
- `/?dev=ui&screen=title`: every UI screen, driven by a mock host.
- `/?unlock`: unlocks every world and snake (for demos).

QA scripts (headless Chromium): `scripts/e2e.mjs`, `scripts/matrix.mjs`, `scripts/shot.mjs`,
`scripts/audio-check.mjs`.

## Architecture
See [`docs/SPEC.md`](docs/SPEC.md) and [`docs/PLAN.md`](docs/PLAN.md).

- `src/game/`: a pure, deterministic simulation.
- `src/render/`: Three.js with WebGL2 and GLSL.
- `src/audio/`: Web Audio synthesis.
- `src/ui/`: DOM screens.
- `src/input/`: unified input handling.
- `src/app/`: the glue between them.

## Deploy
`.github/workflows/deploy.yml` runs the tests and builds on every push to `main` and `claude/**`,
but only deploys to GitHub Pages from `main` or a manual workflow run. To deploy, enable Pages
(source: GitHub Actions) in the repository settings.
