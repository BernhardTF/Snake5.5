import { BIOMES } from '../biomes/biomes';
import { SKINS } from '../skins/skins';
import type { Profile } from '../core/storage';
import type { BiomeId, SkinId } from '../types';

export const MAX_LEVEL = 30;

/** Total XP required to *reach* level n (level 1 = 0 XP). */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  // gentle early curve: L2 = 40, L3 = 110, L5 = 330, L7 = 640 ...
  return Math.round(40 * (n - 1) + 15 * (n - 1) * (n - 2));
}

export function levelFromXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
  return l;
}

export function levelProgress(xp: number) {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = level >= MAX_LEVEL ? base : xpForLevel(level + 1);
  return { level, into: xp - base, need: Math.max(1, next - base) };
}

/** Allow `?unlock` in the URL to unlock everything (for demos / testing). */
const UNLOCK_ALL = typeof location !== 'undefined' && /[?&]unlock\b/.test(location.search);

export function isBiomeUnlocked(profile: Profile, id: BiomeId): boolean {
  if (UNLOCK_ALL) return true;
  const b = BIOMES.find((x) => x.id === id)!;
  return levelFromXp(profile.xp) >= b.unlockLevel;
}

export function isSkinUnlocked(profile: Profile, id: SkinId): boolean {
  if (UNLOCK_ALL) return true;
  const s = SKINS.find((x) => x.id === id)!;
  if (s.unlockAchievement) return !!profile.achievements[s.unlockAchievement];
  return levelFromXp(profile.xp) >= s.unlockLevel;
}

/** Human readable unlocks gained moving from levelBefore -> levelAfter. */
export function unlocksBetween(levelBefore: number, levelAfter: number): string[] {
  const out: string[] = [];
  for (const b of BIOMES) if (b.unlockLevel > levelBefore && b.unlockLevel <= levelAfter) out.push(`World unlocked: ${b.name}`);
  for (const s of SKINS) if (s.unlockLevel > 0 && s.unlockLevel > levelBefore && s.unlockLevel <= levelAfter) out.push(`${s.kind === 'legend' ? 'Legend' : 'Snake'} unlocked: ${s.name}`);
  return out;
}
