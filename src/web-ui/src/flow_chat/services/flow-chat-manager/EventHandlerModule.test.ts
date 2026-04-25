import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { normalizeSubagentParentInfo } from './subagentParentInfo';
import { shouldProcessEvent } from './EventHandlerModule';
import { stateMachineManager } from '../../state-machine';
import { SessionExecutionState } from '../../state-machine/types';

describe('normalizeSubagentParentInfo', () => {
  it('normalizes snake_case subagent parent metadata from backend events', () => {
    expect(
      normalizeSubagentParentInfo({
        subagent_parent_info: {
          session_id: 'parent',
          dialog_turn_id: 'turn',
          tool_call_id: 'tool',
        },
      }),
    ).toEqual({
      sessionId: 'parent',
      dialogTurnId: 'turn',
      toolCallId: 'tool',
    });
  });

  it('keeps camelCase subagent parent metadata intact', () => {
    expect(
      normalizeSubagentParentInfo({
        subagentParentInfo: {
          sessionId: 'parent',
          dialogTurnId: 'turn',
          toolCallId: 'tool',
        },
      }),
    ).toEqual({
      sessionId: 'parent',
      dialogTurnId: 'turn',
      toolCallId: 'tool',
    });
  });
});

describe('shouldProcessEvent', () => {
  const mockSessionId = 'test-session';
  const mockTurnId = 'test-turn';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stateMachineManager.clear();
  });

  it('returns false for data event when no state machine exists', () => {
    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'data', 'TextChunk'),
    ).toBe(false);
  });

  it('returns true for state_sync event even when no state machine exists', () => {
    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'state_sync', 'SessionStateChanged'),
    ).toBe(true);
  });

  it('returns true for control event when state is IDLE', () => {
    vi.spyOn(stateMachineManager, 'get').mockReturnValue({
      getCurrentState: () => SessionExecutionState.IDLE,
      getContext: () => ({ currentDialogTurnId: mockTurnId }),
    } as any);

    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'control', 'DialogTurnStarted'),
    ).toBe(true);
  });

  it('returns false for control event when state is PROCESSING', () => {
    vi.spyOn(stateMachineManager, 'get').mockReturnValue({
      getCurrentState: () => SessionExecutionState.PROCESSING,
      getContext: () => ({ currentDialogTurnId: mockTurnId }),
    } as any);

    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'control', 'DialogTurnStarted'),
    ).toBe(false);
  });

  it('returns false for data event when state is not streaming', () => {
    vi.spyOn(stateMachineManager, 'get').mockReturnValue({
      getCurrentState: () => SessionExecutionState.IDLE,
      getContext: () => ({ currentDialogTurnId: mockTurnId }),
    } as any);

    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'data', 'TextChunk'),
    ).toBe(false);
  });

  it('returns false for data event when turn ID mismatches', () => {
    vi.spyOn(stateMachineManager, 'get').mockReturnValue({
      getCurrentState: () => SessionExecutionState.PROCESSING,
      getContext: () => ({ currentDialogTurnId: 'different-turn' }),
    } as any);

    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'data', 'TextChunk'),
    ).toBe(false);
  });

  it('returns true for data event when all conditions match', () => {
    vi.spyOn(stateMachineManager, 'get').mockReturnValue({
      getCurrentState: () => SessionExecutionState.PROCESSING,
      getContext: () => ({ currentDialogTurnId: mockTurnId }),
    } as any);

    expect(
      shouldProcessEvent(mockSessionId, mockTurnId, 'data', 'TextChunk'),
    ).toBe(true);
  });
});
