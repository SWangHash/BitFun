/**
 * AuxPane — AI Agent scene right pane.
 * Hosts ContentCanvas with tab management for editor views and visualizations.
 *
 * Renamed from panels/ContentPanel. All logic preserved.
 */

import { forwardRef, useEffect, useRef, useImperativeHandle, useCallback } from 'react';
import { ContentCanvas, useCanvasStore } from '../../components/panels/content-canvas';
import {
  switchAgentCanvasWorkspace,
  removeAgentCanvasSnapshot,
} from '../../components/panels/content-canvas/stores';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import type { PanelContent as OldPanelContent } from '../../components/panels/base/types';
import type { PanelContent } from '../../components/panels/content-canvas/types';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { createLogger } from '@/shared/utils/logger';

import './AuxPane.scss';

const log = createLogger('AuxPane');

export interface AuxPaneRef {
  addTab: (content: OldPanelContent) => void;
  switchToTab: (tabId: string) => void;
  findTabByMetadata: (metadata: Record<string, any>) => { tabId: string } | null;
  updateTabContent: (tabId: string, content: OldPanelContent) => void;
  closeAllTabs: () => void;
}

interface AuxPaneProps {
  workspacePath?: string;
  isSceneActive?: boolean;
  terminalResizeSuspended?: boolean;
}

const AuxPane = forwardRef<AuxPaneRef, AuxPaneProps>(
  ({ workspacePath, isSceneActive = true, terminalResizeSuspended = false }, ref) => {
    const { workspace } = useCurrentWorkspace();
    const workspaceId = workspace?.id;

    // Fine-grained selectors so unrelated store changes do not re-render.
    const addTab = useCanvasStore(state => state.addTab);
    const switchToTab = useCanvasStore(state => state.switchToTab);
    const findTabByMetadata = useCanvasStore(state => state.findTabByMetadata);
    const updateTabContent = useCanvasStore(state => state.updateTabContent);
    const closeAllTabs = useCanvasStore(state => state.closeAllTabs);
    const syncSessionOwnedBrowserTabs = useCanvasStore(state => state.syncSessionOwnedBrowserTabs);
    const primaryGroup = useCanvasStore(state => state.primaryGroup);
    const secondaryGroup = useCanvasStore(state => state.secondaryGroup);

    const convertContent = useCallback((oldContent: OldPanelContent): PanelContent => {
      return {
        type: oldContent.type,
        title: oldContent.title,
        data: oldContent.data,
        metadata: oldContent.metadata,
      };
    }, []);

    useImperativeHandle(ref, () => ({
      addTab: (content: OldPanelContent) => {
        addTab(convertContent(content), 'active');
        window.dispatchEvent(new CustomEvent('expand-right-panel'));
      },
      switchToTab: (tabId: string) => {
        if (primaryGroup.tabs.find(t => t.id === tabId)) {
          switchToTab(tabId, 'primary');
          window.dispatchEvent(new CustomEvent('expand-right-panel'));
        } else if (secondaryGroup.tabs.find(t => t.id === tabId)) {
          switchToTab(tabId, 'secondary');
          window.dispatchEvent(new CustomEvent('expand-right-panel'));
        }
      },
      findTabByMetadata: (metadata: Record<string, any>) => {
        const result = findTabByMetadata(metadata);
        return result ? { tabId: result.tab.id } : null;
      },
      updateTabContent: (tabId: string, content: OldPanelContent) => {
        if (primaryGroup.tabs.find(t => t.id === tabId)) {
          updateTabContent(tabId, 'primary', convertContent(content));
        } else if (secondaryGroup.tabs.find(t => t.id === tabId)) {
          updateTabContent(tabId, 'secondary', convertContent(content));
        }
      },
      closeAllTabs: () => {
        closeAllTabs();
      },
    }), [
      addTab,
      switchToTab,
      findTabByMetadata,
      updateTabContent,
      closeAllTabs,
      primaryGroup.tabs,
      secondaryGroup.tabs,
      convertContent,
    ]);

    const prevWorkspaceIdRef = useRef<string | undefined>(undefined);

    const syncAgentCanvasWorkspace = useCallback((next: string | undefined) => {
      const prev = prevWorkspaceIdRef.current;
      if (prev === next) return;

      log.debug('Active workspace changed, swapping agent canvas snapshot', {
        from: prev ?? '(none)',
        to: next ?? '(none)',
      });
      switchAgentCanvasWorkspace(prev ?? null, next ?? null);
      syncSessionOwnedBrowserTabs(flowChatStore.getState().activeSessionId);
      prevWorkspaceIdRef.current = next;
    }, [syncSessionOwnedBrowserTabs]);

    useEffect(() => {
      syncAgentCanvasWorkspace(workspaceId);
    }, [syncAgentCanvasWorkspace, workspaceId]);

    useEffect(() => {
      let previousSessionId: string | null | undefined;
      const sync = (sessionId: string | null) => {
        if (sessionId === previousSessionId) return;
        previousSessionId = sessionId;
        syncSessionOwnedBrowserTabs(sessionId);
      };

      sync(flowChatStore.getState().activeSessionId);
      return flowChatStore.subscribe(state => sync(state.activeSessionId));
    }, [syncSessionOwnedBrowserTabs]);

    useEffect(() => {
      const removeListener = workspaceManager.addEventListener((event) => {
        if (
          event.type === 'workspace:switched'
          || event.type === 'workspace:active-changed'
        ) {
          // WorkspaceManager emits these events synchronously while activation is
          // still in progress. Swap the canvas before callers can open the target
          // session's review tab; the context effect above remains a fallback.
          syncAgentCanvasWorkspace(event.workspace?.id);
        }
        if (event.type === 'workspace:closed') {
          removeAgentCanvasSnapshot(event.workspaceId);
        }
      });
      return () => removeListener();
    }, [syncAgentCanvasWorkspace]);

    const handleInteraction = useCallback(async (itemId: string, userInput: string) => {
      log.debug('Panel interaction', { itemId, userInput });
    }, []);

    const handleBeforeClose = useCallback(async (_content: any) => {
      return true;
    }, []);

    return (
      <div data-bf-component="aux-pane" data-bf-part="root" className="bitfun-aux-pane">
        <ContentCanvas
          workspacePath={workspacePath}
          mode="agent"
          isSceneActive={isSceneActive}
          onInteraction={handleInteraction}
          onBeforeClose={handleBeforeClose}
          terminalResizeSuspended={terminalResizeSuspended}
        />
      </div>
    );
  }
);

AuxPane.displayName = 'AuxPane';

export default AuxPane;
