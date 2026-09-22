# SERPENT SANDS — Game Specification

*A 2026 re-imagining of Snake. Working repo name: Snake5.5.*

## 1. Vision

Classic Snake rules, presented as a tactile, living diorama. The camera looks straight down on a
tray of real-looking sand. The snake is a lit 3D creature that presses a groove into the ground, and
the groove stays. Every run leaves a drawing. Each world has its own culture, light, sound and
sand physics, so a run in the Sahara feels different from a run in a Kyoto rock garden.

Pillars:

1. **Tactile realism.** Sand that deforms, keeps its shape, slumps, and is erased by wind or waves.
   The snake has weight, shadow, sheen and a living animation.
2. **Instant, fair, precise.** Input goes straight to the simulation. The grid mode is
   frame-exact. Nothing visual changes the outcome.
3. **One more run.** Short runs, combos, near-miss bonuses, daily seeds, unlocks, and scores that
   are easy to read.
4. **Calm by default, intense on demand.** Zen mode has no death. Arcade mode builds pressure
   through the music and the camera.

## 2. Platforms and delivery

- Browser game, installable as a **PWA** (works offline, launches fullscreen, handles both
  orientations).
- Targets: desktop Chrome, Edge, Firefox and Safari; Android Chrome; iOS Safari 17 and later.
- 60 fps on a mid-range 2023 phone at the *Medium* preset, and at *High/Ultra* on desktop.
- Scores, profile and settings are stored **locally only** (`localStorage`, versioned schema).

## 3. Camera and presentation

- Orthographic, **top-down**, framed by a border that fits the biome's culture (wood, cedar,
  bamboo, basalt or woven textile).
- The board fills the screen. Its short side is 18 cells and its long side scales with the aspect
  ratio (clamped to 18–38). The layout is chosen when a run starts, so portrait and landscape both
  work.
- A subtle camera shake on death and big combos (can be turned off with *Reduced motion*).
- Tilt-shift depth-of-field blur at the screen edges gives a miniature, diorama feel.

## 4. Movement modes (chosen per run)

| Mode | Rules |
|---|---|
| **Classic Grid** | Four directions. Turns happen at cell centres. Up to 2 turns can be queued. The head moves at a continuous speed in cells/s, so it is smooth and not stepped. Collisions are checked per cell. Speed rises with length. |
| **Free Glide** | Analog steering: the heading is an angle with a capped turn rate. Collisions are distance-based (head against body samples, skipping the neck, and against walls and obstacles). Speed rises gently with length. |

In both modes the body follows the exact path the head took. That keeps collisions fair. Visual
undulation is applied on top and never affects collision.

## 5. Game modes

| Mode | Summary | Death |
|---|---|---|
| **Classic** | Eat, grow, and survive as long as possible. Standard obstacles for the biome. | Walls, self, obstacles |
| **Arcade** | Power-ups, golden food, moving hazards, faster speed curve, big combos. | Yes |
| **Zen** | No death. Walls wrap and you pass through yourself. No score pressure; only "pattern" and length are tracked. Ambient music only. | None |
| **Time Attack** | 120 seconds, maximise score. Extra food on the board, and each golden food adds +5 s. | Walls/self cost −10 s and a respawn |
| **Daily Seed** | Arcade rules on a fixed 22×22 board seeded by the UTC date (same for everyone that day). One personal best is stored per day. | Yes |

### Scoring

- Food: `base × combo`. Base values: normal 10, golden 50.
- **Combo**: eating again within the combo window (4 s, shown as a ring on the HUD) raises the
  multiplier ×1 → ×8. The window shrinks slightly as the combo grows.
- **Near miss**: passing within 0.6 cells of an obstacle or your own body (walls are excluded — riding the edge would farm points) at speed gives +5 ×
  combo, with a soft chime. Each obstacle or body segment can trigger it at most once per second.
- **Length milestones** at every 10 segments give a bonus.
- **Pattern score** (all modes, the main score in Zen): the fraction of the board your trail has
  "raked".

### Power-ups (Arcade, Daily)

| Power-up | Effect | Duration |
|---|---|---|
| **Slow Time** | 0.5× world speed; the music drops to half speed with a low-pass filter | 6 s |
| **Ghost** | Pass through yourself; the snake turns translucent | 6 s |
| **Magnet** | Pulls food toward you | 8 s |
| **Double** | ×2 score | 10 s |
| **Shed** | Shed the last 30% of your tail (leaves a skin husk on the sand) | instant |

## 6. Biomes (culture and mood)

Each biome defines its sand material, pattern, trail physics, light, props, food, frame, particles
and music.

| # | Biome | Culture | Mood / light | Sand and trail behaviour | Food | Obstacles | Music |
|---|---|---|---|---|---|---|---|
| 1 | **Karesansui** | Kyoto, Japan | Calm late-afternoon gold; maple and bamboo leaf shadows | Fine pale granite; raked parallel lines; zen stones with raked ripple rings; trail is permanent and sharp | Sakura blossom (ripple rings around it) | Moss-edged stones | Koto pluck plus shakuhachi breath, *In* scale, slow, sparse |
| 2 | **Erg Chebbi** | Sahara, Morocco / Amazigh | Hot amber light, long shadows, heat haze | Orange dune sand; wind ripples; **wind slowly erases trails**; drifting sand particles | Golden dates | Sandstone boulders, dry acacia shadow | Oud pluck plus bendir frame drum, *Hijaz* maqam |
| 3 | **Motu Lagoon** | Polynesia | Warm pink sunset over the ocean | Wet dark sand with specular sheen and wave-ripple marks; **waves periodically wash a band and erase trails**; foam lines | Hibiscus flower | Coral heads, coconuts | Slack-key-style guitar plus log drum, major pentatonic, surf ambience |
| 4 | **Svartsandur** | Iceland | Blue night with aurora glow | Black volcanic sand with basalt grit; **the trail cracks the crust and exposes glowing embers** that cool over time; embers rise | Ember crystal | Hexagonal basalt columns | Bowed drones plus deep hum, Aeolian mode, sparse bells |
| 5 | **Salar** | Andes, Bolivia | Bright, cold high-altitude morning | Salt flat: hexagonal crust polygons and a thin water film reflecting the sky; **the trail leaves a dark wet trace that dries over time** | Kantuta flower | Salt mounds, cacti | Quena and siku panpipe plus charango pluck, minor pentatonic |

Unlocks: Karesansui is available from the start. The others unlock at profile level 2, 3, 5 and
7. Levels come from XP, and XP = run score / 10 plus bonuses. The curve is tuned so the first
unlock arrives after one good run.

## 7. The snake

- **Body**: a procedural 3D tube rebuilt every frame along the path (up to 400 samples). Radius
  profile: rounded snout, wide head, slimmer neck, full body, long taper to the tail.
- **Material**: procedural scales (overlapping rounded scales, with larger belly scutes along the
  sides), a pattern per skin, fresnel sheen, faint light passing through the thin edges, and a
  specular that varies across the scales.
- **Animation**:
  - Sideways S-wave undulation. It grows with speed and fades toward the head in grid mode.
  - The head leads into turns.
  - Blinking; tongue flicks (more often near food).
  - A bulge travels down the body after each meal.
  - When dying, the body writhes briefly (verlet chain with impulses), then goes still and the
    screen desaturates.
- **Shadow**: a soft contact shadow rendered from the sun direction onto the sand. Rocks and food
  cast shadows too.
- **Skins** (unlocked by achievements and levels): Obsidian Gold (default, like the reference),
  Coral Snake, Emerald Tree Python, Albino Ghost, Sea Krait, Rainbow Boa (iridescent), Desert
  Horned Viper, Ember Serpent (emissive).

## 8. Sand technology

- **Deformation map**: a GPU render target (half-float, 512² to 1024² by quality) covering the
  board plus margins.
  - R = height offset (groove is negative, berm is positive).
  - G = disturbance (0–1: how much of the original pattern is erased).
  - B = biome-specific channel (moisture, heat or ember).
  - A = age.
- **Stamp pass** (each frame): capsule stamps along the head's movement since the last frame. The
  profile is a groove with a raised berm, and the displaced sand is pushed to the sides. Eating
  leaves a small crater, and death stamps the whole body.
- **Relax pass**: slump diffusion. Then the biome rule runs: permanent (Kyoto), wind erosion
  (Sahara), a wave band wash (Lagoon), ember cooling (Iceland) or drying (Salar).
- **Sand shader**:
  - Height = biome pattern × (1 − disturbance) + deformation.
  - Normals come from finite differences.
  - Lighting: wrapped Lambert, a cavity ambient-occlusion term, grain normal detail, sparkles,
    wet specular, sky tint, emissive embers.
  - The contact shadow is sampled from a snake-shadow render target.
  - The leaf-shadow texture is animated by wind.
- **Post-processing**: bloom (embers, sparkles, aurora), tilt-shift blur, colour grade per biome,
  vignette, film grain, and a desaturate/pulse on death.

## 9. Audio

- Everything is synthesised with the Web Audio API. There are no sample files, which keeps the game
  small and offline-friendly.
- Buses: master, music and SFX, through a compressor and a generated reverb.
- **SFX**:
  - Eat: a plucked note on the biome's instrument, its pitch climbing through the scale with the
    combo.
  - Golden spawn; power-up pickup and expiry; near miss; turn swish.
  - A continuous **slither loop** of filtered noise that follows speed and turning.
  - Death thud with a reverse swell; UI hover, click and back sounds; achievement fanfare.
- **Music**: a generative sequencer per biome (scale, tempo, instruments) with 3 intensity layers
  driven by combo and length. Slow Time applies half-speed plus a low-pass filter.
- The audio context starts on the first user gesture (a browser requirement). The volumes and a
  mute toggle are saved.

## 10. Controls

| Platform | Classic Grid | Free Glide | Menus |
|---|---|---|---|
| Keyboard | Arrows / WASD | ←/→ or A/D steer (↑ boosts, optional) | Arrows, Enter, Esc |
| Gamepad | D-pad / left stick | Left stick angle = target heading | D-pad, A, B, Start = pause |
| Touch | **Swipe** anywhere (default), or a **D-pad overlay** option | **Drag-steer**: drag from anywhere and the snake turns toward the drag direction (default), or **left/right half taps** | Tap |
| Mouse | — | Optional: the head follows the pointer | Click |

- The pause button is always visible on the HUD. The game auto-pauses when the tab is hidden.
- Haptics on eat and death via `navigator.vibrate` (Android; the setting can be toggled).

## 11. Screens and UI

- **Title / attract**: the game logo over a live, AI-controlled snake moving through the current
  biome. Buttons: Play, Snakes, Achievements, Records, Settings, Credits.
- **Play setup**: mode cards, a biome carousel (with lock state and a live preview behind it), and
  a movement toggle (Grid / Glide). Start.
- **HUD**:
  - Score (with a count-up tween) and a combo ring with a multiplier.
  - Length, best score, and power-up timers.
  - A pause button, and in Time Attack a timer.
  - Pop-up floating score text.
- **Pause**: Resume, Restart, Settings, Quit.
- **Game over**:
  - Score, best, and a NEW BEST badge.
  - Stats: length, max combo, near misses, time, pattern %.
  - XP gained with a level bar, and unlock toasts.
  - Buttons: Retry (the default focus), Menu, **Save picture of your garden** (PNG via Web Share
    or a download).
- **Snakes (skins)**: a grid of cards with a live preview and unlock conditions.
- **Achievements**: 24 achievements with progress.
- **Records**: best scores per mode × biome × movement; the daily best; lifetime stats.
- **Settings**:
  - Graphics: Auto / Low / Medium / High / Ultra, render scale, bloom, DOF, particles, FPS
    counter.
  - Audio: master, music and SFX volumes, mute.
  - Controls: touch scheme per movement mode, haptics, swipe sensitivity.
  - Accessibility: reduced motion, high-contrast food, larger HUD, colour-safe palettes.
  - Data: reset progress.
- **Credits.**
- Style: warm paper and ink with a gold accent. Menus are frosted panels over the live scene.
  Keyboard and gamepad focus rings, and touch targets of at least 44 px.

## 12. Progression

- XP → levels 1–30 → unlock biomes (at L2, 3, 5 and 7) and skins.
- **Achievements** (examples):
  - First Bite, Length 25/50/100, Combo ×4/×8.
  - 10 near misses in one run.
  - Play every biome; beat the daily seed.
  - Zen 5 minutes; "Rake Master" (60% pattern coverage); Time Attack 1500.
  - Ghost through yourself; eat 3 golden foods in one run.
- Lifetime stats: runs, food eaten, total length, play time, deaths by cause.

## 13. Performance and quality tiers

| Preset | Deform RT | Render scale | Post | Particles |
|---|---|---|---|---|
| Low | 384² | 0.6 | none | 25% |
| Medium | 512² | 0.8 | vignette + grade | 50% |
| High | 768² | 1.0 | + bloom | 100% |
| Ultra | 1024² | 1.0 × DPR up to 2 | + tilt-shift DOF, grain | 150% |

*Auto* starts at Medium on mobile and High on desktop. It steps down if frame time stays above
20 ms for 3 seconds, and steps up if it stays below 12 ms for 10 seconds. It never changes quality
during a run once the first 5 seconds have passed.

## 14. Decision log

- **Renderer: Three.js `WebGLRenderer` with GLSL `ShaderMaterial`s** instead of the proposed
  `WebGPURenderer` with TSL. The game's look depends on a render-to-texture sand simulation and
  hand-tuned shaders. The WebGL2 path is the most mature and debuggable for that, runs on every
  target including older iOS, and works in the headless Chromium used for automated visual QA.
  The rendering code is isolated in `src/render/`, so a WebGPU port later stays possible.
- **Physics: custom** (path-following body with a verlet chain used when dying). A physics engine
  does not help with snake locomotion and would add hundreds of KB.
- **UI: plain TypeScript DOM components.** A menu this size doesn't need a framework.
- **Audio: fully procedural.** No licensed assets, tiny download, and each biome sounds distinct.
