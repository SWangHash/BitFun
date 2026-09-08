import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flowChatState: {
    activeSessionId: null as string | null,
    sessions: new Map<string, unknown>(),
  },
  sceneState: {
    openScene: vi.fn(),
  },
  switchChatSession: vi.fn(),
}));

vi.mock('@/app/services/AppManager', () => ({
  appManager: { updateLayout: vi.fn() },
}));

vi.mock('@/app/stores/sceneStore', () => ({
  useSceneStore: {
    getState: () => mocks.sceneState,
  },
}));

vi.mock('../store/FlowChatStore', () => ({
  flowChatStore: {
    getState: () => mocks.flowChatState,
  },
}));

vi.mock('./FlowChatManager', () => ({
  flowChatManager: { switchChatSession: mocks.switchChatSession },
}));

vi.mock('./storeSync', () => ({
  syncSessionToModernStore: vi.fn(),
}));

import { openMainSession } from './sessionActivation';
import { syncSessionToModernStore } from './storeSync';

describe('openMainSession resource activation', () => {
  beforeEach(() => {
    mocks.flowChatState.activeSessionId = null;
    mocks.flowChatState.sessions = new Map();
    vi.clearAllMocks();
    mocks.switchChatSession.mockReset();
  });

  it('does not open a scene for a missing or removed session', async () => {
    await openMainSession('missing');
    expect(mocks.sceneState.openScene).not.toHaveBeenCalled();
    expect(mocks.switchChatSession).not.toHaveBeenCalled();
  });

  it('opens an existing selected session and synchronizes its presentation', async () => {
    mocks.flowChatState.activeSessionId = 'active';
    mocks.flowChatState.sessions.set('active', { sessionId: 'active' });

    await openMainSession('active');

    expect(syncSessionToModernStore).toHaveBeenCalledWith('active');
    expect(mocks.sceneState.openScene).toHaveBeenCalledWith('session');
  });

  it('waits for successful activation before opening the scene', async () => {
    mocks.flowChatState.sessions.set('target', { sessionId: 'target' });
    mocks.switchChatSession.mockImplementation(async () => {
      expect(mocks.sceneState.openScene).not.toHaveBeenCalled();
      mocks.flowChatState.activeSessionId = 'target';
    });

    await openMainSession('target');

    expect(mocks.sceneState.openScene).toHaveBeenCalledWith('session');
  });

  it('does not reopen a session removed while activation was pending', async () => {
    mocks.flowChatState.sessions.set('target', { sessionId: 'target' });
    mocks.switchChatSession.mockImplementation(async () => {
      mocks.flowChatState.activeSessionId = 'target';
      mocks.flowChatState.sessions.delete('target');
    });

    await openMainSession('target');

    expect(mocks.sceneState.openScene).not.toHaveBeenCalled();
    expect(syncSessionToModernStore).not.toHaveBeenCalled();
  });

  it('does not open a scene when activation fails', async () => {
    mocks.flowChatState.sessions.set('target', { sessionId: 'target' });
    mocks.switchChatSession.mockRejectedValue(new Error('Host unavailable'));

    await expect(openMainSession('target')).rejects.toThrow('Host unavailable');
    expect(mocks.sceneState.openScene).not.toHaveBeenCalled();
  });
});
