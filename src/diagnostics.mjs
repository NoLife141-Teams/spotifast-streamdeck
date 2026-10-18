// Diagnostics are deliberately assembled from an allowlist. Never retain error
// objects, process output, paths, action/device identifiers, or track metadata.
const scopes = new Set(['status', 'command', 'open', 'inspector']);
const unavailableVersion = 'unavailable';
const maxErrors = 5;
const maxTimestamp = 8640000000000000;

const issues = {
  missing: ['executable-missing', 'executableMissing', 'diagnosticActionCheckPath'],
  timeout: ['timeout', 'commandTimeout', 'diagnosticActionRetry'],
  unavailable: ['unavailable', 'unavailable', 'diagnosticActionOpen'],
  signedOut: ['not-signed-in', 'diagnosticNotSignedIn', 'diagnosticActionSignIn'],
  playback: ['no-playback', 'diagnosticNoPlayback', 'diagnosticActionPlay'],
  seek: ['seek-unavailable', 'diagnosticSeekUnavailable', 'diagnosticActionPlay'],
  stale: ['stale-state', 'diagnosticStale', 'diagnosticActionRetry'],
  unconfigured: ['device-unconfigured', 'diagnosticDeviceUnconfigured', 'diagnosticActionSettings'],
  device: ['device-unavailable', 'diagnosticDeviceUnavailable', 'diagnosticActionDevice'],
  response: ['invalid-response', 'unknownResponse', 'diagnosticActionRetry'],
  uri: ['invalid-input', 'invalidUri', 'diagnosticActionSettings'],
  action: ['invalid-action', 'unknownAction', 'diagnosticActionSettings'],
  unsupported: ['unsupported-action', 'unsupportedMultiAction', 'diagnosticActionSettings'],
  busy: ['busy', 'commandQueueBusy', 'diagnosticActionRetry'],
  expired: ['expired', 'commandExpired', 'diagnosticActionRetry'],
  unknown: ['unknown', 'commandFailed', 'diagnosticActionRetry']
};
const messageIssues = new Map([
  ['executableMissing', issues.missing],
  ['commandTimeout', issues.timeout],
  ['unavailable', issues.unavailable],
  ['notSignedIn', issues.signedOut],
  ['diagnosticNotSignedIn', issues.signedOut],
  ['noPlayback', issues.playback],
  ['diagnosticNoPlayback', issues.playback],
  ['deviceUnavailable', issues.device],
  ['seekUnavailable', issues.seek],
  ['seekStale', issues.stale],
  ['deviceStale', issues.stale],
  ['deviceUnconfigured', issues.unconfigured],
  ['devicesInvalid', issues.response],
  ['diagnosticDeviceUnavailable', issues.device],
  ['unknownResponse', issues.response],
  ['incompleteResponse', issues.response],
  ['invalidUri', issues.uri],
  ['unknownAction', issues.action],
  ['unknownRotation', issues.action],
  ['unsupportedMultiAction', issues.unsupported],
  ['commandQueueBusy', issues.busy],
  ['commandExpired', issues.expired],
  ['commandFailed', issues.unknown]
]);

function issue([category, messageKey, actionKey]) {
  return { category, messageKey, actionKey };
}

function property(value, key) {
  try { return value?.[key]; } catch { return undefined; }
}

/** Accept only a small numeric version, optionally from Spotifast's --version. */
export function safeVersion(value) {
  if (typeof value !== 'string' || value.length > 64) return unavailableVersion;
  const match = /^(?:spotifast )?v?(\d{1,5}(?:\.\d{1,5}){0,3})$/.exec(value.trim());
  return match?.[1] ?? unavailableVersion;
}

/** Classify structured, known errors only. Raw messages are never inspected. */
export function diagnosticCategory(error) {
  const known = messageIssues.get(property(error, 'messageKey'));
  if (known) return issue(known);
  if (property(error, 'killed') === true || property(error, 'code') === 'ETIMEDOUT') return issue(issues.timeout);
  return issue(issues.unknown);
}

export function createDiagnostics({ now = Date.now } = {}) {
  let lastSuccess = null;
  const recentErrors = [];
  const scopeFor = scope => scopes.has(scope) ? scope : 'inspector';
  const timestamp = () => {
    let value;
    try { value = now(); } catch { return null; }
    return Number.isSafeInteger(value) && value >= 0 && value <= maxTimestamp ? value : null;
  };

  return {
    recordSuccess(scope) {
      lastSuccess = { scope: scopeFor(scope), at: timestamp() };
    },
    recordError(error, scope) {
      recentErrors.unshift({ scope: scopeFor(scope), at: timestamp(), ...diagnosticCategory(error) });
      recentErrors.length = Math.min(maxErrors, recentErrors.length);
    },
    snapshot({ pluginVersion, hostVersion, upstreamVersion, detected, pathMode, online, hasPlayback } = {}) {
      const found = typeof detected === 'boolean' ? detected : null;
      const connected = online === true;
      const playback = connected && hasPlayback === true;
      const status = found === false ? issues.missing : !connected ? issues.unavailable : !playback ? issues.playback : null;
      return {
        version: 1,
        pluginVersion: safeVersion(pluginVersion),
        hostVersion: safeVersion(hostVersion),
        upstreamVersion: safeVersion(upstreamVersion),
        detection: { found, pathMode: pathMode === 'custom' ? 'custom' : 'automatic' },
        connection: connected ? 'online' : 'offline',
        playback: playback ? 'available' : 'none',
        lastSuccess: lastSuccess ? { ...lastSuccess } : null,
        recentErrors: recentErrors.map(error => ({ ...error })),
        status: status ? issue(status) : null
      };
    }
  };
}
