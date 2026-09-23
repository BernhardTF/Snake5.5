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
  pinksands:
    'Harbour Island’s pink sand gets its blush from Foraminifera, tiny single-celled creatures with red-pink shells, mixed with crushed coral. Bahamians celebrate Junkanoo each Boxing Day and New Year with goatskin drums, cowbells and dazzling crêpe-paper costumes.',
  vaadhoo:
    'The glowing shores of the Maldives come from bioluminescent plankton such as dinoflagellates, which flash blue when the water is disturbed. For Maldivian islanders the sea has always been livelihood and road, from pole-and-line tuna fishing to dhoni boats between atolls.',
  dallol:
    'Dallol sits in Ethiopia’s Danakil Depression, more than 100 m below sea level and one of the hottest inhabited places on Earth. Its colours come from sulphur, iron salts and acidic hot springs, and Afar caravans still cut salt slabs by hand and carry them out by camel.',
  luna:
    'The Sea of Tranquillity is a basalt plain where Apollo 11 landed in 1969. With no wind or water, footprints on the Moon can last for millions of years, slowly softened only by micrometeorites.',
  mars:
    'Jezero Crater once held a lake fed by a river delta, which is why NASA’s Perseverance rover went there in 2021 to look for signs of ancient life. Mars is red because its dust is rich in iron oxide, and dust devils regularly sweep its plains.',
  titan:
    'Titan, Saturn’s largest moon, is the only other world known to have stable surface liquids: lakes and seas of methane and ethane. Its dark dunes are thought to be made of organic grains, seen through radar by the Cassini–Huygens mission.',
  kepler:
    'Kepler-186f, found by NASA’s Kepler telescope in 2014, was the first Earth-sized planet discovered in the habitable zone of another star, a red dwarf about 580 light-years away. Its surface is unknown; this world, and its second sun, are pure imagination.',
};

export function buildCredits(ctx: ScreenCtx): Screen {
  const note = (b: (typeof BIOMES)[number]) =>
    h(
      'article',
      { class: `culture${b.realm === 'beyond' ? ' culture-beyond' : ''}`, style: { '--bacc': b.accent } },
      h('div', { class: 'culture-head' }, h('span', { class: 'culture-dot', style: { background: b.cardGradient } }), h('span', { class: 'culture-name' }, b.name), h('span', { class: 'culture-local' }, b.localName), h('span', { class: 'culture-region' }, b.region)),
      h('p', null, NOTES[b.id]),
    );
  const cultures = h(
    'div',
    { class: 'culture-list' },
    h('h3', { class: 'realm-head' }, 'Earth'),
    BIOMES.filter((b) => b.realm === 'earth').map(note),
    h('h3', { class: 'realm-head realm-head-beyond' }, 'Beyond Earth'),
    BIOMES.filter((b) => b.realm === 'beyond').map(note),
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
          h('p', { class: 'muted' }, 'A love letter to the original Snake, and to the gardens, deserts and shores that inspired each world, and to the worlds beyond.'),
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
