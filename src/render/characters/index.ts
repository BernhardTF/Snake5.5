// Registry of Legend character renderers. Owned by the character designer.
import type { CharacterId } from '../../types';
import type { ICharacterView } from './contract';
import { CentipedeView } from './centipede';
import { EelView } from './eel';
import { DragonView } from './dragon';
import { MechaView } from './mecha';
import { TrainView } from './train';
import { CometView } from './comet';

/** Returns a renderer for the character, or null if not implemented yet (snake is shown instead). */
export function createCharacter(id: CharacterId): ICharacterView | null {
  switch (id) {
    case 'centipede': return new CentipedeView();
    case 'eel': return new EelView();
    case 'dragon': return new DragonView();
    case 'mecha': return new MechaView();
    case 'train': return new TrainView();
    case 'comet': return new CometView();
    default: return null;
  }
}
