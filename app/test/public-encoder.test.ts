import { expect, it } from 'vitest';
import { encodePreparedAudio } from '../src/core/audio/encode-public';
import type { BookWav } from '../src/core/audio/narration';

it('fails explicitly rather than downloading held encoders in the hosted build', async () => {
  await expect(encodePreparedAudio({} as BookWav, 'mp3', '', [], 128000, async () => {}, new AbortController().signal, () => {}))
    .rejects.toThrow('Compressed export is unavailable');
});
