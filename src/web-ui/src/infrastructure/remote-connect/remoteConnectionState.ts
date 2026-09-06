import type { ConnectionResult, RemoteConnectionMethod, RemoteConnectStatus } from '../api/service-api/RemoteConnectAPI';

export type RemoteNetworkMethod = 'lan' | 'ngrok' | 'openbitfun_server' | 'custom_server';

const OFFICIAL_RELAY_URL = 'https://remote.openbitfun.com/relay';

export function remoteNetworkMethod(method: RemoteConnectionMethod | null | undefined): RemoteNetworkMethod | null {
  if (typeof method === 'object' && method !== null) {
    if ('lan' in method) return 'lan';
    if ('custom_server' in method) return 'custom_server';
    return null;
  }
  const value = typeof method === 'string' ? method.toLowerCase() : undefined;
  if (value?.startsWith('lan')) return 'lan';
  if (value?.startsWith('ngrok')) return 'ngrok';
  if (value?.startsWith('openbitfunserver') || value === 'openbitfun_server' || value === 'open_bit_fun_server') return 'openbitfun_server';
  if (value?.startsWith('customserver') || value === 'custom_server') return 'custom_server';
  return null;
}

function normalizeRelayUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function relayUrlFromMethod(method: RemoteConnectionMethod | null | undefined): string | null {
  if (remoteNetworkMethod(method) === 'openbitfun_server') return OFFICIAL_RELAY_URL;
  if (typeof method === 'object' && method !== null && 'custom_server' in method) {
    return normalizeRelayUrl(method.custom_server.url);
  }
  // Restored invitations have no QR payload. The existing status method is
  // Rust's Debug shape, which retains the exact custom relay URL.
  const encodedUrl = typeof method === 'string' ? method.match(/url:\s*("(?:[^"\\]|\\.)*")/)?.[1] : null;
  if (!encodedUrl) return null;
  try {
    return normalizeRelayUrl(JSON.parse(encodedUrl));
  } catch {
    return null;
  }
}

function invitationRelayUrl(invitation: ConnectionResult): string | null {
  if (invitation.qr_url) {
    try {
      const hash = new URL(invitation.qr_url).hash;
      const query = hash.slice(hash.indexOf('?') + 1);
      return normalizeRelayUrl(new URLSearchParams(query).get('relay'));
    } catch {
      return null;
    }
  }
  return relayUrlFromMethod(invitation.method);
}

/** Presentation facts only. Account control never completes or disconnects a QR room. */
export function selectRemoteNetworkConnection(
  status: RemoteConnectStatus | null | undefined,
  invitation?: ConnectionResult | null,
) {
  const roomConnected = status?.pairing_state === 'connected'
    || (status?.pairing_state == null && status?.is_connected === true);
  const accountConnected = status?.account_control_connected === true;
  const roomMethod = remoteNetworkMethod(status?.active_method);
  // Older hosts scoped this boolean to the active room's relay. Recover only
  // that exact URL; a matching method name alone cannot identify a relay.
  const accountRelayUrl = status?.account_control_relay_url === undefined
    ? relayUrlFromMethod(status?.active_method)
    : normalizeRelayUrl(status.account_control_relay_url);
  const accountMethod: RemoteNetworkMethod | null = accountConnected && accountRelayUrl
    ? accountRelayUrl === OFFICIAL_RELAY_URL ? 'openbitfun_server' : 'custom_server'
    : null;
  const invitationRelay = invitation ? invitationRelayUrl(invitation) : null;
  const invitationAccountConnected = accountConnected && invitationRelay !== null
    && invitationRelay === accountRelayUrl;

  return {
    connected: roomConnected || accountConnected,
    roomConnected,
    accountConnected,
    roomMethod,
    accountMethod,
    accountRelayUrl,
    method: roomConnected ? roomMethod : accountConnected ? accountMethod : roomMethod,
    invitationAccountConnected,
  };
}
