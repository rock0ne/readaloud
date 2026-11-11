/** Old/imported positions can outlive a shorter document revision. */
export function libraryProgress(ordinal: number | undefined, sentenceCount: number): number {
  if (ordinal === undefined || !Number.isFinite(ordinal) || !Number.isFinite(sentenceCount) || sentenceCount <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((ordinal + 1) / sentenceCount * 100)));
}
