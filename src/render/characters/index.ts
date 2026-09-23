// Registry of Legend character renderers. Owned by the character designer.
import type { CharacterId } from '../../types';
import type { ICharacterView } from './contract';

/** Returns a renderer for the character, or null if not implemented yet (snake is shown instead). */
export function createCharacter(_id: CharacterId): ICharacterView | null {
  return null;
}
