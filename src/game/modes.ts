import type { GameModeId, MovementMode } from '../types';

export interface ModeRules {
  death: boolean;          // collisions end the run
  wrap: boolean;           // walls wrap around
  selfPass: boolean;       // can pass through own body
  powerups: boolean;
  golden: boolean;
  hazards: boolean;        // moving obstacles
  timeLimit: number | null;
  foodCount: number;       // simultaneous normal food
  obstacleDensity: number; // obstacles per 100 cells
  speedBase: Record<MovementMode, number>;
  speedPerLen: Record<MovementMode, number>;
  speedMax: Record<MovementMode, number>;
  combo: boolean;
}

const base: ModeRules = {
  death: true,
  wrap: false,
  selfPass: false,
  powerups: false,
  golden: false,
  hazards: false,
  timeLimit: null,
  foodCount: 1,
  obstacleDensity: 0.9,
  speedBase: { grid: 6.2, glide: 5.0 },
  speedPerLen: { grid: 0.055, glide: 0.035 },
  speedMax: { grid: 11.5, glide: 8.5 },
  combo: true,
};

export const MODES: Record<GameModeId, ModeRules> = {
  classic: { ...base },
  arcade: {
    ...base,
    powerups: true,
    golden: true,
    hazards: true,
    foodCount: 2,
    obstacleDensity: 1.0,
    speedBase: { grid: 7.0, glide: 5.6 },
    speedPerLen: { grid: 0.07, glide: 0.045 },
    speedMax: { grid: 13, glide: 9.5 },
  },
  zen: {
    ...base,
    death: false,
    wrap: true,
    selfPass: true,
    foodCount: 3,
    obstacleDensity: 0.6,
    speedBase: { grid: 5.2, glide: 4.2 },
    speedPerLen: { grid: 0, glide: 0 },
    speedMax: { grid: 5.2, glide: 4.2 },
    combo: false,
  },
  timeattack: {
    ...base,
    golden: true,
    timeLimit: 120,
    foodCount: 3,
    obstacleDensity: 0.7,
    speedBase: { grid: 7.2, glide: 5.8 },
    speedPerLen: { grid: 0.04, glide: 0.03 },
    speedMax: { grid: 12, glide: 9 },
  },
  daily: {
    ...base,
    powerups: true,
    golden: true,
    hazards: true,
    foodCount: 2,
    obstacleDensity: 1.1,
    speedBase: { grid: 7.0, glide: 5.6 },
    speedPerLen: { grid: 0.07, glide: 0.045 },
    speedMax: { grid: 13, glide: 9.5 },
  },
};

export const MODE_INFO: Record<GameModeId, { name: string; glyph: string; blurb: string }> = {
  classic: { name: 'Classic', glyph: '◯', blurb: 'Eat, grow, survive. The timeless ritual.' },
  arcade: { name: 'Arcade', glyph: '✦', blurb: 'Power-ups, golden food and rolling hazards.' },
  zen: { name: 'Zen', glyph: '☯', blurb: 'No death. Walls wrap. Rake the garden in peace.' },
  timeattack: { name: 'Time Attack', glyph: '⏱', blurb: 'Two minutes. Golden food buys time.' },
  daily: { name: 'Daily Seed', glyph: '☀', blurb: 'One board for everyone today. Arcade rules.' },
};
