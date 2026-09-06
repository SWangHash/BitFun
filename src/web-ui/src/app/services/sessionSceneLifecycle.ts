import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { startAutoSync } from '@/flow_chat/services/storeSync';
import { useSceneStore } from '../stores/sceneStore';

/**
 * The Session scene is a view of the selected session, not a session itself.
 * Reconcile at the shell lifetime so removal from any source also retires the
 * tab and its navigation history, even while another scene is visible.
 * A metadata-only or failed session still exists and must remain recoverable.
 */
export function startSessionSceneLifecycle(): () => void {
  const stopProjectionSync = startAutoSync();
  const reconcile = () => {
    if (flowChatStore.getActiveSession()) return;

    const sceneState = useSceneStore.getState();
    if (sceneState.openTabs.some(tab => tab.id === 'session')) {
      sceneState.closeScene('session');
    }
  };

  const unsubscribeSessions = flowChatStore.subscribe(reconcile);
  const unsubscribeScenes = useSceneStore.subscribe(reconcile);
  reconcile();

  return () => {
    unsubscribeSessions();
    unsubscribeScenes();
    stopProjectionSync();
  };
}
