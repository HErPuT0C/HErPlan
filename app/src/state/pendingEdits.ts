// Editors that keep typed text for a moment before putting it into the project (documents write after a pause
// in typing) register here; every save of the project takes their latest text first (Ctrl+S, exports,
// backups, closing).

const flushers = new Set<() => void>();

export function onFlushEdits(flush: () => void): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

export function flushEdits(): void {
  for (const flush of flushers) flush();
}
