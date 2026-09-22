import { h } from '../dom';
import { screenHead, sectionTitle } from '../widgets';
import type { Screen, ScreenCtx } from '../ctx';
import { BIOMES } from '../../biomes/biomes';
import type { BiomeId } from '../../types';
import { logo, VERSION } from './title';

const NOTES: Record<BiomeId, string> = {
  karesansui:
    'Karesansui, the Japanese dry landscape garden, grew from Zen temples such as Ryōan-ji in Kyoto. Monks rake the gravel daily; the lines suggest water, and the act itself is a meditation.',
  erg: 'Erg Chebbi rises at the edge of the Sahara near Merzouga. For centuries Amazigh (Berber) caravans crossed these dunes, reading the wind, the stars and the colour of the sand.',
  lagoon:
    'A motu is a small reef islet ringing a Polynesian lagoon. Navigators voyaged between such islands across thousands of kilometres of open ocean, guided by swells, birds and stars.',
  svartsandur:
    'Iceland’s black sand beaches are made of basalt worn down by the Atlantic. Sagas and folklore often read the land’s fire and ice as living forces to be respected.',
  salar:
    'The Salar de Uyuni is the world’s largest salt flat, high on the Bolivian Altiplano. Aymara and Quechua communities have harvested its salt for generations; in the rainy season it becomes a mirror of the sky.',
};

export function buildCredits(ctx: ScreenCtx): Screen {
  const cultures = h(
    'div',
    { class: 'culture-list' },
    BIOMES.map((b) =>
      h(
        'article',
        { class: 'culture', style: { '--bacc': b.accent } },
        h('div', { class: 'culture-head' }, h('span', { class: 'culture-dot', style: { background: b.cardGradient } }), h('span', { class: 'culture-name' }, b.name), h('span', { class: 'culture-local' }, b.localName), h('span', { class: 'culture-region' }, b.region)),
        h('p', null, NOTES[b.id]),
      ),
    ),
  );

  const el = h(
    'section',
    { class: 'screen screen-credits' },
    h('div', { class: 'scrim scrim-full' }),
    screenHead(ctx, 'Credits', 'With gratitude'),
    h(
      'div',
      { class: 'screen-scroll' },
      h(
        'div',
        { class: 'credits-layout stagger' },
        h(
          'div',
          { class: 'panel credits-hero', style: { '--i': '0' } },
          logo('logo-sm'),
          h('p', { class: 'credits-lead' }, 'Designed & built with Claude'),
          h('p', { class: 'muted' }, 'A love letter to the original Snake, and to the gardens, deserts and shores that inspired each world.'),
        ),
        h('div', { class: 'panel', style: { '--i': '1' } }, sectionTitle('The worlds'), cultures,
          h('p', { class: 'fine' }, 'These worlds are imaginative tributes, not reproductions. We have tried to represent each place and tradition with care and respect.')),
        h(
          'div',
          { class: 'panel', style: { '--i': '2' } },
          sectionTitle('Craft'),
          h('p', null, 'Rendered with ', h('b', null, 'Three.js'), ' and hand-written GLSL; sound with the ', h('b', null, 'Web Audio'), ' API.'),
          h('p', { class: 'gold-line' }, 'Every texture, model and sound is procedural.'),
          h('p', { class: 'muted small' }, 'Type set in Cormorant Garamond and Inter. ', `Serpent Sands ${VERSION}.`),
        ),
      ),
    ),
  );
  return { el, focus: el.querySelector<HTMLElement>('.btn-back') };
}
