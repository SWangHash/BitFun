// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { useModernFlowChatStore } from '@/flow_chat/store/modernFlowChatStore';
import type { Session } from '@/flow_chat/types/flow-chat';
import { activateSurface, LOCAL_SURFACE_ID } from '@/infrastructure/peer-device/deviceSurface';
import { useSceneStore } from '../stores/sceneStore';
import { startSessionSceneLifecycle } from './sessionSceneLifecycle';

function session(sessionId: string, overrides: Partial<Session> = {}): Session {
  return {
    sessionId,
    title: sessionId,
    dialogTurns: [],
    status: 'idle',
    config: {},
    createdAt: 1,
    lastActiveAt: 1,
    error: null,
    workspacePath: '/workspace/project',
    ...overrides,
  };
}

function select(sessions: Session[], activeSessionId: string | null): void {
  flowChatStore.setState(previous => ({
    ...previous,
    sessions: new Map(sessions.map(value => [value.sessionId, value])),
    activeSessionId,
  }));
}

describe('Session scene resource lifetime with real stores', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    activateSurface(LOCAL_SURFACE_ID);
    select([], null);
    useModernFlowChatStore.getState().clear();
    useSceneStore.getState().resetForPeerSwitch();
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    activateSurface(LOCAL_SURFACE_ID);
    select([], null);
    useModernFlowChatStore.getState().clear();
    useSceneStore.getState().resetForPeerSwitch();
  });

  it('removes the last session tab, projection and navigation history together', () => {
    select([session('last')], 'last');
    useSceneStore.getState().openScene('session');
    stop = startSessionSceneLifecycle();

    flowChatStore.removeSession('last', { nextActiveSessionId: null });

    expect(flowChatStore.getState().sessions.size).toBe(0);
    expect(useSceneStore.getState()).toMatchObject({
      openTabs: [], activeTabId: null, navHistory: [], navCursor: -1,
    });
    expect(useModernFlowChatStore.getState()).toMatchObject({
      activeSession: null, virtualItems: [], visibleTurnInfo: null,
    });
  });

  it('returns to another open tab when the selected session disappears', () => {
    select([session('active')], 'active');
    useSceneStore.getState().openScene('settings');
    useSceneStore.getState().openScene('session');
    stop = startSessionSceneLifecycle();

    flowChatStore.removeSession('active');

    expect(useSceneStore.getState().activeTabId).toBe('settings');
    expect(useSceneStore.getState().openTabs.map(tab => tab.id)).toEqual(['settings']);
    useSceneStore.getState().goBack();
    useSceneStore.getState().goForward();
    expect(useSceneStore.getState().activeTabId).toBe('settings');
    expect(useSceneStore.getState().navHistory).not.toContain('session');
  });

  it('retires a hidden session scene after workspace removal without changing the visible tab', () => {
    select([session('active')], 'active');
    useSceneStore.getState().openScene('session');
    useSceneStore.getState().openScene('settings');
    stop = startSessionSceneLifecycle();

    flowChatStore.removeSessionsForWorkspace({ rootPath: '/workspace/project' });

    expect(useSceneStore.getState().activeTabId).toBe('settings');
    expect(useSceneStore.getState().openTabs.map(tab => tab.id)).toEqual(['settings']);
  });

  it('keeps a valid replacement selection when another session is removed', () => {
    select([session('removed'), session('retained')], 'retained');
    useSceneStore.getState().openScene('session');
    stop = startSessionSceneLifecycle();

    flowChatStore.removeSession('removed');

    expect(useSceneStore.getState().activeTabId).toBe('session');
    expect(useModernFlowChatStore.getState().activeSession?.sessionId).toBe('retained');
  });

  it.each(['metadata-only', 'hydrating', 'failed'] as const)(
    'keeps a %s record recoverable even with no rendered turns', historyState => {
      const retained = session('history', {
        isHistorical: true, historyState, remoteConnectionId: 'offline-ssh',
      });
      select([retained], retained.sessionId);
      useSceneStore.getState().openScene('session');
      stop = startSessionSceneLifecycle();

      expect(useSceneStore.getState().activeTabId).toBe('session');
      expect(useModernFlowChatStore.getState().activeSession).toBe(retained);
    },
  );

  it('reconciles orphan tabs and stale presentation when the shell remounts', () => {
    const stale = session('stale');
    useModernFlowChatStore.getState().setActiveSession(stale);
    useSceneStore.getState().openScene('session');

    stop = startSessionSceneLifecycle();

    expect(useSceneStore.getState().activeTabId).toBeNull();
    expect(useModernFlowChatStore.getState().activeSession).toBeNull();
    // A late navigation callback cannot leave the orphan tab open either.
    useSceneStore.getState().openScene('session');
    expect(useSceneStore.getState().openTabs).toEqual([]);
  });

  it('closes a dangling selection without deleting other session records', () => {
    const retained = session('retained');
    select([retained], 'missing');
    useSceneStore.getState().openScene('session');
    stop = startSessionSceneLifecycle();

    expect(useSceneStore.getState().activeTabId).toBeNull();
    expect(flowChatStore.getState().sessions.get('retained')).toBe(retained);
  });

  it('preserves sessions on the source device when switching to an empty surface', () => {
    const local = session('local-session');
    select([local], local.sessionId);
    useSceneStore.getState().openScene('session');
    stop = startSessionSceneLifecycle();

    activateSurface('empty-peer-lifecycle-test');
    expect(useSceneStore.getState().activeTabId).toBeNull();
    expect(useModernFlowChatStore.getState().activeSession).toBeNull();

    activateSurface(LOCAL_SURFACE_ID);
    expect(flowChatStore.getActiveSession()).toBe(local);
    expect(useModernFlowChatStore.getState().activeSession).toBe(local);
    expect(useSceneStore.getState().openTabs).toEqual([]);
    useSceneStore.getState().openScene('session');
    expect(useSceneStore.getState().activeTabId).toBe('session');
  });

  it('allows a newly established session to open after the empty state', () => {
    stop = startSessionSceneLifecycle();
    select([session('created')], 'created');
    expect(useSceneStore.getState().openTabs).toEqual([]);

    useSceneStore.getState().openScene('session');
    expect(useSceneStore.getState().activeTabId).toBe('session');
    expect(useModernFlowChatStore.getState().activeSession?.sessionId).toBe('created');
  });

  it('clears previous visible-turn metadata when selecting another session', () => {
    select([session('first')], 'first');
    stop = startSessionSceneLifecycle();
    useModernFlowChatStore.getState().setVisibleTurnInfo({
      turnIndex: 2, totalTurns: 3, userMessage: 'old', turnId: 'old-turn', visibleTurnIds: ['old-turn'],
    });

    select([session('second')], 'second');

    expect(useModernFlowChatStore.getState().visibleTurnInfo).toBeNull();
  });

  it('stops observing both stores when the shell unmounts', () => {
    stop = startSessionSceneLifecycle();
    stop();
    stop = undefined;

    useSceneStore.getState().openScene('session');
    select([session('later')], 'later');

    expect(useSceneStore.getState().activeTabId).toBe('session');
    expect(useModernFlowChatStore.getState().activeSession).toBeNull();
  });
});
