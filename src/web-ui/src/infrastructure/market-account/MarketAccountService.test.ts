// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarketAccountService,
  type MarketAccountChangedEvent,
  type MarketAccountServiceDependencies,
  type MarketAccountSyncPort,
} from './MarketAccountService';

class FakeSyncPort implements MarketAccountSyncPort {
  readonly published: MarketAccountChangedEvent[] = [];
  private readonly listeners = new Set<(event: MarketAccountChangedEvent) => void>();

  publish(event: MarketAccountChangedEvent): void {
    this.published.push(event);
  }

  subscribe(listener: (event: MarketAccountChangedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: MarketAccountChangedEvent): void {
    this.listeners.forEach(listener => listener(event));
  }
}

const profile = {
  user: { githubId: 42, login: 'octocat', avatarUrl: 'https://example.com/avatar.png' },
  isAdmin: false,
};

function setup() {
  const syncPort = new FakeSyncPort();
  const api = {
    me: vi.fn<() => Promise<typeof profile | null>>().mockResolvedValue(null),
    authStart: vi.fn().mockResolvedValue({
      transactionId: 'transaction-1',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      expiresAt: 100,
      pollIntervalSeconds: 1,
    }),
    authPoll: vi.fn().mockResolvedValue('authorized' as const),
    logout: vi.fn().mockResolvedValue(undefined),
    onAccountChanged: vi.fn(() => () => undefined),
  };
  const dependencies: MarketAccountServiceDependencies = {
    api,
    openExternal: vi.fn().mockResolvedValue(undefined),
    syncPort,
    now: () => 0,
    sleep: vi.fn().mockResolvedValue(undefined),
    sourceId: 'window-a',
  };
  const service = new MarketAccountService(dependencies);
  return { api, dependencies, service, syncPort };
}

const activeServices: MarketAccountService[] = [];

afterEach(() => {
  activeServices.splice(0).forEach(service => service.dispose());
});

describe('MarketAccountService', () => {
  it('uses the MiniApp desktop OAuth flow, keeps tokens out of the renderer, and shares identity', async () => {
    const { api, dependencies, service, syncPort } = setup();
    activeServices.push(service);
    await service.initialize();
    api.me.mockResolvedValue(profile);

    await expect(service.signIn()).resolves.toEqual(profile);

    expect(dependencies.openExternal).toHaveBeenCalledWith(
      'https://github.com/login/oauth/authorize',
    );
    expect(api.authPoll).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: 'transaction-1',
    }));
    expect(api.authPoll.mock.calls[0][0]).not.toHaveProperty('transactionSecret');
    expect(service.getSnapshot()).toMatchObject({
      resolved: true,
      status: 'signed-in',
      me: profile,
    });
    expect(syncPort.published).toEqual([
      expect.objectContaining({ kind: 'identity-changed', sourceId: 'window-a' }),
    ]);
  });

  it('leaves the waiting state on a poll failure and allows another sign-in', async () => {
    const { api, service } = setup();
    activeServices.push(service);
    await service.initialize();
    api.authPoll.mockRejectedValueOnce(new Error('The market request timed out.'));

    await expect(service.signIn()).rejects.toMatchObject({ code: 'failed' });
    expect(service.getSnapshot()).toMatchObject({ status: 'signed-out', lastError: { code: 'failed' } });

    api.me.mockResolvedValue(profile);
    await expect(service.signIn()).resolves.toEqual(profile);
    expect(api.authStart).toHaveBeenCalledTimes(2);
  });

  it('stops waiting for an unknown authorization status', async () => {
    const { api, service } = setup();
    activeServices.push(service);
    api.authPoll.mockResolvedValueOnce('consumed');

    await expect(service.signIn()).rejects.toMatchObject({ code: 'failed' });
    expect(api.authPoll).toHaveBeenCalledOnce();
    expect(service.getSnapshot().status).toBe('signed-out');
  });

  it('does not poll a transaction that expired during the wait', async () => {
    const { api, dependencies, service } = setup();
    activeServices.push(service);
    let now = 0;
    dependencies.now = () => now;
    dependencies.sleep = async () => { now = 100_000; };

    await expect(service.signIn()).rejects.toMatchObject({ code: 'expired' });
    expect(api.authPoll).not.toHaveBeenCalled();
    expect(service.getSnapshot().status).toBe('signed-out');
  });

  it('refreshes from another window and broadcasts logout from the shared vault', async () => {
    const { api, service, syncPort } = setup();
    activeServices.push(service);
    await service.initialize();
    api.me.mockResolvedValue(profile);

    syncPort.emit({ kind: 'identity-changed', eventId: 'remote-1', sourceId: 'window-b' });
    await vi.waitFor(() => expect(service.getSnapshot().me).toEqual(profile));

    await service.logout();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({ status: 'signed-out', me: null });
    expect(syncPort.published.at(-1)).toEqual(expect.objectContaining({
      kind: 'identity-changed',
      sourceId: 'window-a',
    }));
  });
});
