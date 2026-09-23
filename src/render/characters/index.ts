// Registry of Legend character renderers. Owned by the character designer.
import type { CharacterId } from '../../types';
import type { ICharacterView } from './contract';
import { CentipedeView } from './centipede';
import { EelView } from './eel';

/** Returns a renderer for the character, or null if not implemented yet (snake is shown instead). */
export function createCharacter(id: CharacterId): ICharacterView | null {
  switch (id) {
    case 'centipede': return new CentipedeView();
    case 'eel': return new EelView();
    default: return null;
  }
}
