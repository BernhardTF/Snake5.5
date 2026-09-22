import type { BiomeId } from '../types';

/** Transient, non-persisted info about the current run (read by UI). */
export const runtime: { runBiome: BiomeId | null } = { runBiome: null };
