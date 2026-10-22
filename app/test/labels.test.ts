import { describe, expect, it } from 'vitest';
import { pickerLabel } from '../src/ui/components/VoicePicker';
import { parseHash } from '../src/ui/routes';
import type { Voice } from '../src/core/types';

const voice = (v: Partial<Voice>): Voice => ({ id: 'x', engineId: 'webspeech', name: 'x', lang: 'en-GB', quality: 'neural', offline: false, ...v });

describe('voice picker labels (RA-3)', () => {
  it('marks voices that send the text away as online', () => {
    expect(pickerLabel(voice({ name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)' }))).toBe('Sonia (United Kingdom) · online');
    expect(pickerLabel(voice({ name: 'Microsoft Hazel - English (United Kingdom)', quality: 'standard', offline: true }))).toBe('Hazel (United Kingdom)');
    expect(pickerLabel(voice({ engineId: 'kokoro', name: 'Emma (woman, United Kingdom)', offline: true }))).toBe('Emma (woman, United Kingdom)');
  });
});

describe('routes', () => {
  it('opens the licences page (ADR-38)', () => {
    expect(parseHash('#/licences')).toEqual({ name: 'licences' });
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
  });
});
