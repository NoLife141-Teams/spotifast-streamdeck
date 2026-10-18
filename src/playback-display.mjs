// Derive every time overlay from the same cached sample. Never read the player
// here; interpolation stops after five seconds when fresh status is unavailable.
export function playbackDisplay(snapshot, elapsedMs = 0) {
  if (!snapshot || !['playing', 'paused'].includes(snapshot.state) || !Number.isFinite(snapshot.position)) return {};
  const elapsed = snapshot.state === 'playing' && Number.isFinite(elapsedMs) ? Math.max(0, Math.min(5000, elapsedMs)) : 0;
  const duration = Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : undefined;
  const positionMs = Math.min(duration ?? Infinity, Math.max(0, snapshot.position) + elapsed);
  return { positionMs, remainingMs: duration === undefined ? undefined : Math.max(0, duration - positionMs), progress: duration === undefined ? undefined : positionMs / duration };
}

export function artworkSettings(settings = {}) {
  return { showText: settings.showText !== false, scrollText: settings.scrollText !== false,
    captionLayout: settings.captionLayout === 'twoLines' ? 'twoLines' : 'compact',
    showRemaining: settings.showRemaining !== false, showElapsed: settings.showElapsed === true, showProgress: settings.showProgress === true };
}

export function playbackOverlays(snapshot, settings, elapsedMs) {
  const display = playbackDisplay(snapshot, elapsedMs);
  return { remainingMs: settings.showRemaining !== false ? display.remainingMs : undefined,
    positionMs: settings.showElapsed === true ? display.positionMs : undefined,
    progress: settings.showProgress === true ? display.progress : undefined };
}
