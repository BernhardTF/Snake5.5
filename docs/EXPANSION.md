# Expansion 1: "Beyond the Garden"

This adds 7 worlds (3 exotic places on Earth and 4 worlds beyond Earth), 8 snakes, and
6 Legends: special non-snake characters unlocked at high levels. Gameplay rules and hitboxes do
not change. Every Legend occupies the same footprint as a snake (radius ≈ 0.34 cells) and
follows the same path, so it is purely a new look and sound.

Contracts already in place: `src/types.ts` (the `BiomeId`, `SkinId` and `CharacterId` unions),
`src/biomes/biomes.ts`, `src/skins/skins.ts` (`kind: 'snake' | 'legend'`),
`src/render/characters/contract.ts`, and `IAudioEngine.setCharacter`. Test any locked content
with `?unlock`.

## New worlds

| id | World | Place | Mood / light | Sand and trail behaviour | Food | Obstacles | Surroundings (outside the board) | Music |
|---|---|---|---|---|---|---|---|---|
| `pinksands` | Pink Sands | Harbour Island, Bahamas | Bright tropical noon; dappled sea-grape leaf shadows | Fine rose-pink sand speckled with red foraminifera and shell grit. The trail turns up paler, whiter sand (B channel) that slowly blends back. A turquoise shallows edge along one side, with gentle lapping (no big surges). | Conch pearl (glossy pink pearl on a shell half) | Queen conch shells, sea-grape tufts | Painted clapboard boardwalk in Junkanoo colours | Steel pan and goombay drums, calypso, major key, 104 BPM |
| `vaadhoo` | Vaadhoo | Raa Atoll, Maldives | Moonlit night, deep blue | Dark wet sand. Disturbance wakes bioluminescent plankton, so the trail **glows cyan-blue** (emissive B channel, bloom) and fades over about 12 s. The wave edge sparkles blue when it moves. | Moon shell (pearly spiral, soft glow) | Driftwood, dark coral rock | Night sea with a moon reflection, and a dhoni prow at the edge | Boduberu frame drums (building), soft pads, night ambience |
| `dallol` | Dallol | Danakil, Ethiopia | Harsh white-hot light, acid colours | Acid-yellow sulphur crust with white salt terraces and **emerald/turquoise brine pools** (Voronoi pockets). The trail cracks the crust and shows ochre-orange iron salts; steam wisps rise from fresh cracks. | Salt crystal (white cubic cluster) | Sulphur chimneys and salt pillars | Salt blocks cut by Afar caravans, with camel-rope lashing | Krar (lyre) pluck and kebero drum, tizita pentatonic |
| `luna` | Luna | Mare Tranquillitatis, the Moon | Black sky; hard, unfiltered sun; **no sky ambient**; razor-sharp shadows | Grey regolith with micro-craters and larger soft craters. The trail is **crisp and permanent** (no slump) and very dark, like fresh boot prints. There is no wind. | Helium-3 crystal (icy blue-white, glowing) | Ejecta boulders, a small crater rim ring | **Space**: a starfield and Earth (blue marble with clouds) over the board, like a diorama floating in space | Sparse sine and theremin tones, radio beeps, vast reverb |
| `mars` | Mars | Jezero Crater | Butterscotch haze, low warm sun, long shadows | Ochre-rust dust over dark basalt. The trail **scrapes the rust off and shows dark grey-blue basalt**. Occasional **dust devils** (moving swirl) partly refill trails as they cross. Wind ripples. | Water-ice core (frosty cylinder) | Ventifact rocks, layered mesa chunks | Rusty rocky terrain, and a far rover-track trail | Analog synth pads and arpeggios, 80s sci-fi, minor |
| `titan` | Titan | Shangri-La dunes, Titan | Dim orange haze, low contrast, soft diffuse light | Very dark brown "coffee-ground" hydrocarbon dunes with long linear ridges. A **methane lake shoreline** (black mirror liquid) on one side. A slow **methane drizzle** leaves drop marks and slowly softens trails. | Tholin bloom (orange-brown organic cluster) | Rounded water-ice cobbles | Orange fog, with Saturn's ring faintly visible through the haze | Deep drones, slow, submerged; distant thunder |
| `kepler` | Kepler-186f | Exoplanet "Veyra" | **Twin suns**: 2 light directions giving **2 coloured shadows** (warm and cool); violet dusk | Violet-lilac sand with crystalline sparkle. The trail **shatters surface crystals into glowing magenta/cyan shards** that fade. Alien flora shadows. | Star seed (glowing pod) | Crystal spires, alien fungus caps | Alien flora and bioluminescent fronds; a gas giant in the sky corner | Glassy arpeggios, alien choir, microtonal bells |

Unlock levels: `pinksands` L8, `vaadhoo` L10, `dallol` L12, `luna` L14, `mars` L16, `titan` L19,
`kepler` L22. The world-select screen groups worlds into **Earth** and **Beyond Earth**.

## New snakes (scaled tube skins)

| id | Name | Look |
|---|---|---|
| `gaboon` | Gaboon | Gaboon viper: tan and buff geometric hourglasses and diamonds, dark brown, a pale head with a dark centre line; a broad, very triangular head. |
| `bluecoral` | Blue Coral | Midnight-navy body with electric-blue side stripes. Head and tail **glow red-coral** (a gradient along the length). |
| `paradise` | Paradise | Black scales edged with lime green, and a row of orange-red "stars" down the spine. |
| `sunbeam` | Sunbeam | Glossy black-brown with **strong oil-slick iridescence** (the strongest iridescence of any skin). |
| `eyelash` | Eyelash | Banana-gold with dark freckles, and **scaled lashes/horns above the eyes** (head geometry). |
| `mangrove` | Mangrove | Lacquer-black with thin, crisp sulphur-yellow rings; yellow chin. |
| `nebula` | Nebula | **Animated cosmic interior**: deep violet with drifting nebula clouds and twinkling stars, as if the body were a window into space; slight emissive. |
| `crystal` | Crystal | **Transparent glass body**: refraction, a fresnel rim, internal facets and light caustics; the sand is visible through it. |

## Legends (special characters)

All Legends are drawn along `frame.snake.points` inside the same footprint. Each has an idle
animation, a death reaction, a ghost look, and a way to show the swallow bulge.

| id | Name | Unlock | Look and motion |
|---|---|---|---|
| `centipede` | Centipede | L13 | Segmented armoured amber and brown plates, with **2 legs per segment animated in a travelling gait wave**. Antennae, forcipules at the head, and trailing cerci at the tail. It does not undulate. |
| `eel` | Volt Eel | L15 | A smooth, slick, finned body with a long ventral fin rippling along the length, a blunt head and small eyes. **Electric arcs crackle along the body** (emissive, bloom), and flash bright on eat. |
| `dragon` | Lóng | L18 | A Chinese celestial dragon: a jade-green scaled body, a spiky dorsal ridge, a flowing red and gold mane at the neck, a head with **antler horns, long golden whiskers (barbels) that trail**, and 4 small clawed legs spaced along the body. The tail ends in a flame tuft. A cloud-wisp particle trail. |
| `mecha` | Mecha | L21 | A serpent automaton: brushed-titanium armoured segments with visible gaps, glowing cyan servo joints, a mechanical head with a scanning visor light, and exhaust vents with a faint heat haze. Segments articulate rigidly. |
| `train` | Express | L25 | A **steam locomotive head** (boiler, smokestack puffing smoke, cowcatcher, brass bands, crimson cab) followed by **carriages**, one per ~2 cells of length, with couplings, windows and wheels that spin with speed. Each carriage follows the path like cars on a track. It whistles on eat (audio). |
| `comet` | Comet | L28 | A blazing **icy nucleus** at the head, and the body rendered as an **additive glowing plasma/ice tail** (cyan to white to violet) with sparkling particles. The tail tapers and flickers. There is no solid body, but it still casts a faint glow onto the sand. |

## Audio additions
- A generative score, ambience bed, reverb character, slither timbre and pluck lead for each of the
  7 new worlds (see the Music column above).
- Locomotion loops and signature sounds per Legend, through `setCharacter`:

  | Legend | Loop and signature sounds |
  |---|---|
  | Centipede | Rapid chitin patter |
  | Volt Eel | Electric hum and crackle |
  | Lóng | Wind whoosh and a soft chime |
  | Mecha | Servo whine and hydraulic hiss |
  | Express | A chuff synced to speed; a whistle on eat and a bell on combo |
  | Comet | A roaring whoosh and a sparkle |

## UI additions
- **World select**: 12 worlds grouped by Earth and Beyond Earth, each showing its lock state and
  realm.
- **Collection screen** (currently *Snakes*): tabs for **Snakes (16)** and **Legends (6)**. Legend
  cards get a distinct premium treatment and a short lore line.
- New achievements and unlock toasts ("Legend unlocked: …").
- Credits: culture and science notes for the new worlds.
