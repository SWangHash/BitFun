import { describe, expect, it } from 'vitest';
import type { ConnectionResult, RemoteConnectStatus } from '../api/service-api/RemoteConnectAPI';
import { remoteNetworkMethod, selectRemoteNetworkConnection } from './remoteConnectionState';

const officialRelay = 'https://remote.openbitfun.com/relay';
const customRelay = 'https://relay.example.test/remote/a';

function status(overrides: Partial<RemoteConnectStatus> = {}): RemoteConnectStatus {
  return {
    is_connected: false,
    pairing_state: 'waiting_for_scan',
    active_method: `CustomServer { url: "${customRelay}" }`,
    peer_device_name: null,
    peer_user_id: null,
    bot_connected: null,
    bot_verbose_mode: false,
    ...overrides,
  };
}

function invitation(relay = customRelay): ConnectionResult {
  return {
    method: { custom_server: { url: relay } },
    qr_data: null,
    qr_svg: null,
    qr_url: `https://mobile.example.test/#/pair?relay=${encodeURIComponent(relay)}`,
    bot_pairing_code: null,
    bot_link: null,
    pairing_state: 'waiting_for_scan',
  };
}

describe('remote connection presentation facts', () => {
  it('keeps a live account route connected after the unused QR room is removed', () => {
    const selected = selectRemoteNetworkConnection(status({
      pairing_state: 'idle',
      active_method: null,
      account_control_connected: true,
      account_control_relay_url: customRelay,
    }));
    expect(selected).toMatchObject({
      connected: true,
      roomConnected: false,
      accountConnected: true,
      method: 'custom_server',
      invitationAccountConnected: false,
    });
  });

  it('only marks the QR connected when its exact relay matches the live account route', () => {
    const account = status({ account_control_connected: true, account_control_relay_url: customRelay });
    expect(selectRemoteNetworkConnection(account, invitation()).invitationAccountConnected).toBe(true);
    const otherPath = selectRemoteNetworkConnection(account, invitation('https://relay.example.test/remote/b'));
    expect(otherPath.connected).toBe(true);
    expect(otherPath.invitationAccountConnected).toBe(false);
    expect(selectRemoteNetworkConnection(account, invitation(officialRelay)).invitationAccountConnected).toBe(false);
    expect(selectRemoteNetworkConnection(account, invitation('wss://relay.example.test/remote/a/')).invitationAccountConnected).toBe(true);
  });

  it('accepts real Rust enum results and restored Debug methods without depending on string identity', () => {
    expect(remoteNetworkMethod({ lan: { ip: '192.168.1.2' } })).toBe('lan');
    expect(remoteNetworkMethod({ custom_server: { url: customRelay } })).toBe('custom_server');
    expect(remoteNetworkMethod('open_bit_fun_server')).toBe('openbitfun_server');
    expect(remoteNetworkMethod('OpenBitFunServer')).toBe('openbitfun_server');
    const account = status({ account_control_connected: true });
    expect(selectRemoteNetworkConnection(account, invitation()).invitationAccountConnected).toBe(true);
    expect(selectRemoteNetworkConnection(account, { ...invitation(), qr_url: null }).invitationAccountConnected).toBe(true);
    expect(selectRemoteNetworkConnection(account, {
      ...invitation(), method: account.active_method!, qr_url: null,
    }).invitationAccountConnected).toBe(true);
    expect(selectRemoteNetworkConnection(status({
      active_method: 'OpenBitFunServer', account_control_connected: true,
    }), { ...invitation(officialRelay), method: 'open_bit_fun_server' }).invitationAccountConnected).toBe(true);
  });

  it('does not guess a match when a new host reports an unknown or invalid account relay', () => {
    for (const url of [null, 'invalid', 'https://user:password@relay.example.test/remote/a']) {
      expect(selectRemoteNetworkConnection(status({
        account_control_connected: true, account_control_relay_url: url,
      }), invitation()).invitationAccountConnected).toBe(false);
    }
    expect(selectRemoteNetworkConnection(status({ account_control_connected: true }), {
      ...invitation(), qr_url: 'https://mobile.example.test/#/pair',
    }).invitationAccountConnected).toBe(false);
  });

  it('keeps room truth independent from account expiry and ignores stale legacy connectivity when a pairing state exists', () => {
    expect(selectRemoteNetworkConnection(status({ is_connected: true })).connected).toBe(false);
    expect(selectRemoteNetworkConnection(status({ pairing_state: 'connected', account_control_connected: false }))).toMatchObject({
      connected: true, roomConnected: true, accountConnected: false,
    });
    expect(selectRemoteNetworkConnection(status({ account_control_connected: false }), invitation())).toMatchObject({
      connected: false, roomConnected: false, invitationAccountConnected: false,
    });
    const legacy = status({ is_connected: true });
    delete (legacy as Partial<RemoteConnectStatus>).pairing_state;
    expect(selectRemoteNetworkConnection(legacy).roomConnected).toBe(true);
  });
});
