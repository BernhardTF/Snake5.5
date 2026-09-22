import type { BiomeId, GameModeId, MovementMode, QualityLevel, SkinId } from '../types';

export type QualitySetting = QualityLevel | 'auto';
export type GridTouchScheme = 'swipe' | 'dpad';
export type GlideTouchScheme = 'drag' | 'halves';

export interface Settings {
  version: 1;
  quality: QualitySetting;
  renderScale: number; // 0.5..1 multiplier on top of preset
  bloom: boolean;
  dof: boolean;
  particles: boolean;
  showFps: boolean;
  masterVolume: number; // 0..1
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  gridTouch: GridTouchScheme;
  glideTouch: GlideTouchScheme;
  mouseSteer: boolean;
  haptics: boolean;
  swipeSensitivity: number; // 0.5..2
  reducedMotion: boolean;
  highContrastFood: boolean;
  largeHud: boolean;
  // last used selections
  lastMode: GameModeId;
  lastMovement: MovementMode;
  lastBiome: BiomeId;
  skin: SkinId;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  quality: 'auto',
  renderScale: 1,
  bloom: true,
  dof: true,
  particles: true,
  showFps: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  muted: false,
  gridTouch: 'swipe',
  glideTouch: 'drag',
  mouseSteer: false,
  haptics: true,
  swipeSensitivity: 1,
  reducedMotion: false,
  highContrastFood: false,
  largeHud: false,
  lastMode: 'classic',
  lastMovement: 'grid',
  lastBiome: 'karesansui',
  skin: 'obsidian',
};

export interface LifetimeStats {
  runs: number;
  foodEaten: number;
  goldenEaten: number;
  totalLength: number;
  playTime: number; // seconds
  nearMisses: number;
  deathsWall: number;
  deathsSelf: number;
  deathsObstacle: number;
  bestLength: number;
  bestCombo: number;
  zenTime: number;
  biomesPlayed: BiomeId[];
}

export interface Profile {
  version: 1;
  xp: number;
  /** key = `${mode}|${biome}|${movement}` */
  bests: Record<string, number>;
  /** key = YYYY-MM-DD */
  daily: Record<string, number>;
  achievements: Record<string, number>; // id -> unix ms earned
  stats: LifetimeStats;
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  xp: 0,
  bests: {},
  daily: {},
  achievements: {},
  stats: {
    runs: 0,
    foodEaten: 0,
    goldenEaten: 0,
    totalLength: 0,
    playTime: 0,
    nearMisses: 0,
    deathsWall: 0,
    deathsSelf: 0,
    deathsObstacle: 0,
    bestLength: 0,
    bestCombo: 0,
    zenTime: 0,
    biomesPlayed: [],
  },
};

const SETTINGS_KEY = 'serpent-sands:settings';
const PROFILE_KEY = 'serpent-sands:profile';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw);
    // shallow-merge so newly added fields get defaults
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      const merged: any = { ...structuredClone(fallback), ...parsed };
      if ((fallback as any).stats) merged.stats = { ...structuredClone((fallback as any).stats), ...(parsed.stats ?? {}) };
      return merged;
    }
    return parsed as T;
  } catch {
    return structuredClone(fallback);
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) – keep in memory */
  }
}

type Listener = () => void;

class Store {
  settings: Settings = read(SETTINGS_KEY, DEFAULT_SETTINGS);
  profile: Profile = read(PROFILE_KEY, DEFAULT_PROFILE);
  private listeners = new Set<Listener>();

  saveSettings(patch?: Partial<Settings>) {
    if (patch) Object.assign(this.settings, patch);
    write(SETTINGS_KEY, this.settings);
    this.emit();
  }

  saveProfile() {
    write(PROFILE_KEY, this.profile);
    this.emit();
  }

  resetProgress() {
    this.profile = structuredClone(DEFAULT_PROFILE);
    this.saveProfile();
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const store = new Store();

export function bestKey(mode: GameModeId, biome: BiomeId, movement: MovementMode) {
  return `${mode}|${biome}|${movement}`;
}

export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
