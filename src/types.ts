// Shared contracts between simulation, renderer, audio and UI.
// World space: 1 unit = 1 cell, board spans (0,0)-(W,H) on XY, +Z is up out of the sand.

export type EarthBiomeId =
  | 'karesansui' | 'erg' | 'lagoon' | 'svartsandur' | 'salar'
  | 'pinksands' | 'vaadhoo' | 'dallol';
export type PlanetBiomeId = 'luna' | 'mars' | 'titan' | 'kepler';
export type BiomeId = EarthBiomeId | PlanetBiomeId;

/** Scaled snake skins (tube renderer + skin shader). */
export type SnakeSkinId =
  | 'obsidian' | 'coral' | 'emerald' | 'albino' | 'krait' | 'rainbow' | 'viper' | 'ember'
  | 'gaboon' | 'bluecoral' | 'paradise' | 'sunbeam' | 'eyelash' | 'mangrove' | 'nebula' | 'crystal';
/** Special non-snake characters ("Legends") with their own renderers. Same gameplay/hitbox. */
export type CharacterId = 'centipede' | 'eel' | 'dragon' | 'mecha' | 'train' | 'comet';
export type SkinId = SnakeSkinId | CharacterId;
export type GameModeId = 'classic' | 'arcade' | 'zen' | 'timeattack' | 'daily';
export type MovementMode = 'grid' | 'glide';
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type FoodKind = 'normal' | 'golden';
export type PowerupKind = 'slow' | 'ghost' | 'magnet' | 'double' | 'shed';
export type DeathCause = 'wall' | 'self' | 'obstacle';

export interface GameConfig {
  mode: GameModeId;
  movement: MovementMode;
  biome: BiomeId;
  skin: SkinId;
  seed: number;
  boardW: number;
  boardH: number;
}

// ---------------------------------------------------------------- render frame

export interface SnakeRenderState {
  /** Centerline xy pairs from head (index 0) to tail, evenly spaced by `spacing` world units. */
  points: Float32Array;
  /** Number of points (pairs) in use. */
  count: number;
  spacing: number;
  /** Nominal body radius in world units (~0.34). */
  radius: number;
  /** Unit heading of the head. */
  dirX: number;
  dirY: number;
  /** Current speed in cells/s (already scaled by time scale). */
  speed: number;
  /** Signed turn rate, rad/s (+ = counter-clockwise). Useful for leaning / undulation. */
  turnRate: number;
  /** Food bulges travelling down the body: s = distance from head in world units, amount 0..1. */
  bulges: { s: number; amount: number }[];
  alive: boolean;
  /** Seconds since death (0 while alive). */
  deathT: number;
  /** 0..1 how strongly the snake is "interested" (food nearby) – increase tongue flicks. */
  interest: number;
  ghost: boolean;
  skin: SkinId;
  /** Total visible length in world units. */
  length: number;
}

export interface FoodState {
  id: number;
  kind: FoodKind;
  x: number;
  y: number;
  /** Seconds since spawn. */
  age: number;
  /** For golden food: seconds remaining (Infinity otherwise). */
  ttl: number;
}

export interface ObstacleState {
  id: number;
  x: number;
  y: number;
  /** Collision radius in cells. For grid mode obstacles occupy cells listed in `cells`. */
  r: number;
  cells: [number, number][];
  /** Visual variety seed. */
  seed: number;
  /** 0 = static; >0 a moving hazard (arcade), `vx,vy` its velocity. */
  vx: number;
  vy: number;
}

export interface PowerupPickupState {
  id: number;
  kind: PowerupKind;
  x: number;
  y: number;
  age: number;
  ttl: number;
}

export interface ActiveEffects {
  /** 1 = normal, 0.5 = slow time. */
  timeScale: number;
  ghost: number;   // seconds remaining (0 = inactive)
  magnet: number;
  double: number;
  slow: number;
}

export interface RenderFrame {
  /** Seconds of real time since app start. */
  time: number;
  /** Real delta seconds for this frame. */
  dt: number;
  boardW: number;
  boardH: number;
  snake: SnakeRenderState;
  foods: FoodState[];
  obstacles: ObstacleState[];
  powerups: PowerupPickupState[];
  effects: ActiveEffects;
  /** Events that happened since the previous render frame. */
  events: GameEvent[];
  /** 0..1 intensity (combo/length) – can drive light/post effects. */
  intensity: number;
  /** 0..1 amount of camera shake to apply this frame. */
  shake: number;
  paused: boolean;
}

// ---------------------------------------------------------------- events

export type GameEvent =
  | { type: 'start' }
  | { type: 'eat'; x: number; y: number; kind: FoodKind; combo: number; points: number; length: number }
  | { type: 'spawnFood'; x: number; y: number; kind: FoodKind }
  | { type: 'foodExpired'; x: number; y: number }
  | { type: 'powerupSpawn'; x: number; y: number; kind: PowerupKind }
  | { type: 'powerup'; x: number; y: number; kind: PowerupKind }
  | { type: 'powerupEnd'; kind: PowerupKind }
  | { type: 'turn'; x: number; y: number }
  | { type: 'nearMiss'; x: number; y: number; points: number }
  | { type: 'combo'; combo: number }
  | { type: 'comboBreak'; combo: number }
  | { type: 'milestone'; length: number; points: number }
  | { type: 'wrap'; x: number; y: number }
  | { type: 'hit'; x: number; y: number; cause: DeathCause } // time-attack penalty hit
  | { type: 'death'; x: number; y: number; cause: DeathCause }
  | { type: 'timeWarning'; secondsLeft: number }
  | { type: 'timeUp' };

// ---------------------------------------------------------------- hud / results

export interface HudState {
  score: number;
  best: number;
  combo: number;
  /** 0..1 remaining combo window. */
  comboT: number;
  length: number;
  effects: ActiveEffects;
  /** Time attack: seconds remaining, otherwise null. */
  timeLeft: number | null;
  mode: GameModeId;
  pattern: number; // 0..1
}

export interface RunStats {
  score: number;
  length: number;
  maxCombo: number;
  nearMisses: number;
  foodEaten: number;
  goldenEaten: number;
  powerups: number;
  ghostPasses: number;
  time: number;
  pattern: number;
  cause: DeathCause | 'timeup' | 'quit';
}

export interface RunResult {
  config: GameConfig;
  stats: RunStats;
  best: number;
  newBest: boolean;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  xpIntoLevel: number;   // after
  xpForLevel: number;    // after
  unlocks: string[];     // human readable unlock messages
  achievements: string[]; // achievement ids newly earned
}
