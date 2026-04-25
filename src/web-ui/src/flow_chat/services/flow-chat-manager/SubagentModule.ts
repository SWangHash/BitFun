/**
 * Routes subagent events to their parent tool cards.
 */

import { FlowChatStore } from '../../store/FlowChatStore';
import { createLogger } from '@/shared/utils/logger';
import { i18nService } from '@/infrastructure/i18n/core/I18nService';
import type { FlowChatContext, FlowTextItem, SubagentTextChunkData, SubagentToolEventData } from './types';
import type { FlowThinkingItem } from '../../types/flow-chat';
import { processToolEvent } from './ToolEventModule';
import type { ToolEventData } from '../EventBatcher';

const log = createLogger('SubagentModule');
const SUBAGENT_WAITING_PLACEHOLDER_FLAG = '_subagentWaitingPlaceholder';

function getSubagentWaitingText(): string {
  return i18nService.getT()('toolCards.taskDetailPanel.waitingForModelResponse', {
    defaultValue: 'Waiting for model response...',
  });
}

function getSubagentTextItemId(parentToolId: string, sessionId: string, roundId: string): string {
  return `subagent-text-${parentToolId}-${sessionId}-${roundId}`;
}

function isSubagentWaitingPlaceholder(item: unknown): boolean {
  return !!(item as any)?.[SUBAGENT_WAITING_PLACEHOLDER_FLAG];
}

function findParentTurnId(parentSession: { dialogTurns: Array<{ id: string; modelRounds: Array<{ items: Array<{ id: string }> }> }> }, parentToolId: string): string | null {
  for (const turn of parentSession.dialogTurns) {
    const hasParentTool = turn.modelRounds.some(round =>
      round.items.some(item => item.id === parentToolId)
    );
    if (hasParentTool) {
      return turn.id;
    }
  }

  return null;
}

/**
 * Show early progress inside the parent Task card before the first subagent token arrives.
 */
export function routeModelRoundStartedToToolCard(
  _context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: {
    sessionId: string;
    turnId: string;
    roundId: string;
  }
): void {
  const store = FlowChatStore.getInstance();
  const parentSession = store.getState().sessions.get(parentSessionId);

  if (!parentSession) {
    log.debug('Parent session not found (Subagent ModelRoundStarted)', { parentSessionId });
    return;
  }

  const parentTurnId = findParentTurnId(parentSession, parentToolId);
  if (!parentTurnId) {
    log.debug('Parent tool DialogTurn not found', { parentSessionId, parentToolId });
    return;
  }

  const itemId = getSubagentTextItemId(parentToolId, data.sessionId, data.roundId);
  const parentTurn = parentSession.dialogTurns.find(turn => turn.id === parentTurnId);
  const existingItem = parentTurn?.modelRounds.some(round =>
    round.items.some(item => item.id === itemId)
  );
  if (existingItem) {
    return;
  }

  const parentTool = store.findToolItem(parentSessionId, parentTurnId, parentToolId);
  const parentTimestamp = parentTool?.timestamp || Date.now();
  const newTextItem: FlowTextItem = {
    id: itemId,
    type: 'text',
    content: getSubagentWaitingText(),
    timestamp: parentTimestamp + 1,
    isStreaming: true,
    status: 'running',
    isMarkdown: false,
    isSubagentItem: true,
    parentTaskToolId: parentToolId,
    subagentSessionId: data.sessionId,
    [SUBAGENT_WAITING_PLACEHOLDER_FLAG]: true,
  } as any;

  store.insertModelRoundItemAfterTool(parentSessionId, parentTurnId, parentToolId, newTextItem);
}

/**
 * Route subagent text chunks to the parent tool card.
 * Supports "text" and "thinking" content types.
 */
export function routeTextChunkToToolCard(
  _context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: SubagentTextChunkData
): void {
  const store = FlowChatStore.getInstance();
  const parentSession = store.getState().sessions.get(parentSessionId);
  
  if (!parentSession) {
    log.debug('Parent session not found (Subagent TextChunk)', { parentSessionId });
    return;
  }

  const parentTurnId = findParentTurnId(parentSession, parentToolId);
  if (!parentTurnId) {
    log.debug('Parent tool DialogTurn not found', { parentSessionId, parentToolId });
    return;
  }
  
  const isThinking = data.contentType === 'thinking';
  const itemPrefix = isThinking ? 'subagent-thinking' : 'subagent-text';
  // Format: subagent-{type}-{parentToolId}-{sessionId}-{roundId}
  const itemId = isThinking
    ? `${itemPrefix}-${parentToolId}-${data.sessionId}-${data.roundId}`
    : getSubagentTextItemId(parentToolId, data.sessionId, data.roundId);
  
  const isThinkingEnd = isThinking && !!data.isThinkingEnd;
  const textContent = data.text;
  
  const parentTurn = parentSession.dialogTurns.find(turn => turn.id === parentTurnId);
  let existingItem: FlowTextItem | FlowThinkingItem | null = null;
  
  if (parentTurn) {
    for (const round of parentTurn.modelRounds) {
      const found = round.items.find(item => item.id === itemId);
      if (found) {
        existingItem = found as FlowTextItem | FlowThinkingItem;
        break;
      }
    }
  }
  
  if (existingItem) {
    const wasWaitingPlaceholder = isSubagentWaitingPlaceholder(existingItem);
    const existingContent = wasWaitingPlaceholder ? '' : existingItem.content;
    const content = existingContent + textContent;

    if (isThinkingEnd) {
      store.updateModelRoundItem(parentSessionId, parentTurnId, itemId, {
        content,
        isStreaming: false,
        isCollapsed: true,
        status: 'completed',
        timestamp: Date.now(),
        [SUBAGENT_WAITING_PLACEHOLDER_FLAG]: false,
      } as any);
      
    } else {
      store.updateModelRoundItem(parentSessionId, parentTurnId, itemId, {
        content,
        isStreaming: true,
        isMarkdown: !isThinking,
        status: 'streaming',
        timestamp: Date.now(),
        [SUBAGENT_WAITING_PLACEHOLDER_FLAG]: false,
      } as any);
    }
  } else {
    // Keep subagent item timestamps right after the parent tool.
    const parentTool = store.findToolItem(parentSessionId, parentTurnId, parentToolId);
    const parentTimestamp = parentTool?.timestamp || Date.now();
    
    if (isThinking) {
      const newThinkingItem: import('../../types/flow-chat').FlowThinkingItem = {
        id: itemId,
        type: 'thinking',
        content: textContent,
        timestamp: parentTimestamp + 1,
        isStreaming: !isThinkingEnd,
        isCollapsed: isThinkingEnd,
        status: isThinkingEnd ? 'completed' : 'streaming',
        isSubagentItem: true,
        parentTaskToolId: parentToolId,
        subagentSessionId: data.sessionId
      } as any;
      
      store.insertModelRoundItemAfterTool(parentSessionId, parentTurnId, parentToolId, newThinkingItem);
    } else {
      const newTextItem: FlowTextItem = {
        id: itemId,
        type: 'text',
        content: textContent,
        timestamp: parentTimestamp + 1,
        isStreaming: true,
        status: 'streaming',
        isMarkdown: true,
        isSubagentItem: true,
        parentTaskToolId: parentToolId,
        subagentSessionId: data.sessionId
      };
      
      store.insertModelRoundItemAfterTool(parentSessionId, parentTurnId, parentToolId, newTextItem);
    }
  }
}

/**
 * Route subagent tool events to the parent tool card.
 */
export function routeToolEventToToolCard(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: SubagentToolEventData,
  onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void
): void {
  const store = FlowChatStore.getInstance();
  const parentSession = store.getState().sessions.get(parentSessionId);
  
  if (!parentSession) {
    log.debug('Parent session not found (Subagent ToolEvent)', { parentSessionId });
    return;
  }

  let parentTurnId: string | null = null;
  for (const turn of parentSession.dialogTurns) {
    const hasParentTool = turn.modelRounds.some(round => 
      round.items.some(item => item.id === parentToolId)
    );
    if (hasParentTool) {
      parentTurnId = turn.id;
      break;
    }
  }
  
  if (!parentTurnId) {
    log.debug('Parent tool DialogTurn not found', { parentSessionId, parentToolId });
    return;
  }
  
  const { toolEvent } = data;
  
  // Keep subagent item timestamps right after the parent tool.
  const parentTool = store.findToolItem(parentSessionId, parentTurnId, parentToolId);
  const parentTimestamp = parentTool?.timestamp || Date.now();
  
  processToolEvent(context, parentSessionId, parentTurnId, toolEvent, {
    isSubagent: true,
    parentToolId: parentToolId,
    subagentSessionId: data.sessionId,
    parentTimestamp: parentTimestamp
  }, onTodoWriteResult);
}

/**
 * Internal TextChunk routing for batch processing.
 */
export function routeTextChunkToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  chunkData: {
    sessionId: string;
    turnId: string;
    roundId: string;
    text: string;
    contentType: string;
    isThinkingEnd?: boolean;
  }
): void {
  routeTextChunkToToolCard(context, parentSessionId, parentToolId, chunkData);
}

/**
 * Internal ModelRoundStarted routing for batch/direct event processing.
 */
export function routeModelRoundStartedToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  roundData: {
    sessionId: string;
    turnId: string;
    roundId: string;
  }
): void {
  routeModelRoundStartedToToolCard(context, parentSessionId, parentToolId, roundData);
}

/**
 * Internal ToolEvent routing for batch processing.
 */
export function routeToolEventToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  eventData: ToolEventData,
  onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void
): void {
  routeToolEventToToolCard(context, parentSessionId, parentToolId, eventData, onTodoWriteResult);
}
