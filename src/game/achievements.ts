import type { Profile } from '../core/storage';
import type { BiomeId, GameConfig, RunStats } from '../types';
import { SKIN_BY_ID } from '../skins/skins';

const PLANETS: BiomeId[] = ['luna', 'mars', 'titan', 'kepler'];

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string; // single emoji / glyph for UI
  /** Evaluate after a run. */
  check: (run: RunStats, cfg: GameConfig, profile: Profile) => boolean;
  /** Optional progress 0..1 for UI display. */
  progress?: (profile: Profile) => number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first', name: 'First Bite', description: 'Eat your first food.', icon: '🌸', check: (r) => r.foodEaten >= 1 },
  { id: 'len25', name: 'Growing Up', description: 'Reach length 25 in one run.', icon: '〰', check: (r) => r.length >= 25, progress: (p) => clamp01(p.stats.bestLength / 25) },
  { id: 'len50', name: 'Long Story', description: 'Reach length 50 in one run.', icon: '🐍', check: (r) => r.length >= 50, progress: (p) => clamp01(p.stats.bestLength / 50) },
  { id: 'len100', name: 'Ouroboros', description: 'Reach length 100 in one run.', icon: '♾', check: (r) => r.length >= 100, progress: (p) => clamp01(p.stats.bestLength / 100) },
  { id: 'combo4', name: 'Rhythm', description: 'Reach a x4 combo.', icon: '✦', check: (r) => r.maxCombo >= 4, progress: (p) => clamp01(p.stats.bestCombo / 4) },
  { id: 'combo8', name: 'Flow State', description: 'Reach the maximum x8 combo.', icon: '✺', check: (r) => r.maxCombo >= 8, progress: (p) => clamp01(p.stats.bestCombo / 8) },
  { id: 'near10', name: 'Hair\'s Breadth', description: '10 near misses in one run.', icon: '⚡', check: (r) => r.nearMisses >= 10 },
  { id: 'score500', name: 'Apprentice', description: 'Score 500 in a single run.', icon: '①', check: (r) => r.score >= 500 },
  { id: 'score2000', name: 'Adept', description: 'Score 2,000 in a single run.', icon: '②', check: (r) => r.score >= 2000 },
  { id: 'score5000', name: 'Master', description: 'Score 5,000 in a single run.', icon: '③', check: (r) => r.score >= 5000 },
  { id: 'golden3', name: 'Gold Rush', description: 'Eat 3 golden foods in one run.', icon: '✪', check: (r) => r.goldenEaten >= 3 },
  { id: 'ghost', name: 'Phantom', description: 'Pass through yourself while a Ghost.', icon: '👻', check: (r) => r.ghostPasses >= 1 },
  { id: 'power5', name: 'Collector', description: 'Collect 5 power-ups in one run.', icon: '◈', check: (r) => r.powerups >= 5 },
  { id: 'zen5', name: 'Stillness', description: 'Spend 5 minutes in a single Zen run.', icon: '☯', check: (r, c) => c.mode === 'zen' && r.time >= 300 },
  { id: 'rake60', name: 'Rake Master', description: 'Rake 60% of a garden.', icon: '▦', check: (r) => r.pattern >= 0.6 },
  { id: 'time1500', name: 'Against the Clock', description: 'Score 1,500 in Time Attack.', icon: '⏱', check: (r, c) => c.mode === 'timeattack' && r.score >= 1500 },
  { id: 'daily', name: 'Daily Ritual', description: 'Finish a Daily Seed run.', icon: '📅', check: (r, c) => c.mode === 'daily' },
  { id: 'glide', name: 'Free Spirit', description: 'Score 300 in Free Glide.', icon: '🌀', check: (r, c) => c.movement === 'glide' && r.score >= 300 },
  { id: 'grid', name: 'Right Angles', description: 'Score 300 in Classic Grid.', icon: '▞', check: (r, c) => c.movement === 'grid' && r.score >= 300 },
  { id: 'traveller', name: 'Traveller', description: 'Play in 5 different worlds.', icon: '🧭', check: (r, c, p) => p.stats.biomesPlayed.length >= 5, progress: (p) => clamp01(p.stats.biomesPlayed.length / 5) },
  { id: 'cosmos', name: 'Cosmonaut', description: 'Play in all 12 worlds.', icon: '🌌', check: (r, c, p) => p.stats.biomesPlayed.length >= 12, progress: (p) => clamp01(p.stats.biomesPlayed.length / 12) },
  { id: 'beyond', name: 'Beyond Earth', description: 'Play on all four worlds beyond Earth.', icon: '🪐', check: (r, c, p) => PLANETS.every((b) => p.stats.biomesPlayed.includes(b)), progress: (p) => clamp01(PLANETS.filter((b) => p.stats.biomesPlayed.includes(b)).length / 4) },
  { id: 'moonwalker', name: 'Moonwalker', description: 'Score 1,000 on Luna.', icon: '🌕', check: (r, c) => c.biome === 'luna' && r.score >= 1000 },
  { id: 'red_planet', name: 'Red Planet', description: 'Reach length 40 on Mars.', icon: '🔴', check: (r, c) => c.biome === 'mars' && r.length >= 40 },
  { id: 'kepler_score', name: 'Stargazer', description: 'Score 1,500 on Kepler-186f.', icon: '✧', check: (r, c) => c.biome === 'kepler' && r.score >= 1500 },
  { id: 'glow', name: 'Sea of Stars', description: 'Light up 40% of the shore in Vaadhoo.', icon: '✨', check: (r, c) => c.biome === 'vaadhoo' && r.pattern >= 0.4 },
  { id: 'legend', name: 'Living Legend', description: 'Finish a run as a Legend character.', icon: '🐉', check: (r, c) => SKIN_BY_ID[c.skin]?.kind === 'legend' },
  { id: 'svart_score', name: 'Fire Walker', description: 'Score 1,000 in Svartsandur.', icon: '🔥', check: (r, c) => c.biome === 'svartsandur' && r.score >= 1000 },
  { id: 'runs25', name: 'Devotion', description: 'Play 25 runs.', icon: '⟳', check: (r, c, p) => p.stats.runs >= 25, progress: (p) => clamp01(p.stats.runs / 25) },
  { id: 'eat500', name: 'Glutton', description: 'Eat 500 foods in total.', icon: '🍽', check: (r, c, p) => p.stats.foodEaten >= 500, progress: (p) => clamp01(p.stats.foodEaten / 500) },
  { id: 'hour', name: 'Time Well Spent', description: 'Play for one hour in total.', icon: '⌛', check: (r, c, p) => p.stats.playTime >= 3600, progress: (p) => clamp01(p.stats.playTime / 3600) },
];
