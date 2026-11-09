import { describe, expect, it } from 'vitest';
import { DEFAULT_PRONUNCIATION, parsePronunciations, pronunciationText, validPronunciation } from '../src/core/text/pronunciation';
import { withDefaults } from '../src/core/store/settings';
import { audioKey } from '../src/core/audio/narration';

describe('English speech-only context hints', () => {
  const pairs = [
    ['We go live tonight.', 'We go lyve tonight.'], ['I live in London.', 'I liv in London.'],
    ['Live systems use live-data.', 'lyve systems use lyve-data.'],
    ['Please read this.', 'Please reed this.'], ['I have read this.', 'I have red this.'],
    ['Please lead the team.', 'Please leed the team.'], ['The lead pipes broke.', 'The led pipes broke.'],
    ['Please wind the clock.', 'Please wined the clock.'], ['The wind blew.', 'The wind blew.'],
    ['Please close the door.', 'Please cloze the door.'], ['Stay close to me.', 'Stay clohss to me.'],
    ['Please record it.', 'Please recórd it.'], ['Keep a record.', 'Keep a record.'],
    ['Please present it.', 'Please prezent it.'], ['She is present.', 'She is present.'],
    ['Wait a minute.', 'Wait a min-it.'], ['These minute details matter.', 'These my-noot details matter.'],
    ['Please tear the paper.', 'Please tair the paper.'], ['A tear rolled down.', 'A teer rolled down.'],
    ['She wound the clock.', 'She wownd the clock.'], ['An open wound hurt.', 'An open woond hurt.'],
    ['I object to that.', 'I objèct to that.'], ['An object fell.', 'An object fell.'],
    ['I feel content.', 'I feel contènt.'], ['The content matters.', 'The content matters.'],
    ['Please use it.', 'Please yooz it.'], ['It is in use.', 'It is in yooss.'],
    ['Never desert them.', 'Never dessert them.'], ['The desert is hot.', 'The desert is hot.'],
    ['Please bow before them.', 'Please bough before them.'], ['A bow tie.', 'A boh tie.'],
    ['They had a row.', 'They had a rau.'], ['The front row.', 'The front roh.'],
    ['Leave OT with IT, US and WHO.', 'leeve O. T. with I. T., U. S. and W. H. O.'],
  ];
  it.each(pairs)('%s → %s', (input, output) => expect(pronunciationText(input!)).toBe(output));
  it('leaves ambiguous cases, ordinary pronouns and substrings alone', () => {
    const text = 'Who knows how it works? Let us live better. Record, present, minute, lead, bow, row. Gloves leaveable closely.';
    expect(pronunciationText(text)).toBe(text);
    expect(pronunciationText('live')).toBe('live');
    expect(pronunciationText('read')).toBe('read');
  });
  it('can turn hints off and leaves non-English locale text alone', () => {
    const text = 'Leave live systems to IT.';
    expect(pronunciationText(text, { enabled: false, list: '' })).toBe(text);
    expect(pronunciationText(text, DEFAULT_PRONUNCIATION, 'fr-FR')).toBe(text);
  });
  it('supports literal overrides, longest phrase, punctuation, unicode boundaries and no cascading', () => {
    const p = { enabled: true, list: '# personal list\nlive = LYE-v\nlive systems = production\nOT = letters\nletters = wrong\nC++ = see plus plus' };
    expect(pronunciationText('live systems; live; OT; C++.', p)).toBe('production; LYE-v; letters; see plus plus.');
    expect(pronunciationText('élive liveé relive', p)).toBe('élive liveé relive');
    expect(pronunciationText('Live live', p)).toBe('Live LYE-v');
  });
  it('validates lists and safely defaults invalid saved values', () => {
    for (const list of ['live', 'live =', '= sound', 'live = <phoneme>', 'x = a\nx = b', 'x'.repeat(20001)]) {
      expect(() => parsePronunciations(list)).toThrow();
      expect(validPronunciation({ enabled: true, list })).toBe(false);
    }
    expect(parsePronunciations('')).toEqual(new Map());
    expect(withDefaults({ pronunciation: { enabled: true, list: 'bad' } }).pronunciation).toEqual(DEFAULT_PRONUNCIATION);
    expect(withDefaults(undefined).pronunciation).toEqual(DEFAULT_PRONUNCIATION);
    expect(withDefaults({ schemaVersion: 4 }).pronunciation).toEqual({ enabled: false, list: '' });
  });
  it('changes audio identity only where speech actually changes', async () => {
    const original = 'Leave live systems.';
    expect(await audioKey('kokoro', 'bf_emma', pronunciationText(original))).not.toBe(await audioKey('kokoro', 'bf_emma', original));
    expect(pronunciationText('Hello.')).toBe('Hello.');
  });
});
