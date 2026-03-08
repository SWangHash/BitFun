import React, { useState, useCallback, useRef, useEffect } from 'react';
import PairingPage from './pages/PairingPage';
import WorkspacePage from './pages/WorkspacePage';
import SessionListPage from './pages/SessionListPage';
import ChatPage from './pages/ChatPage';
import { RelayHttpClient } from './services/RelayHttpClient';
import { RemoteSessionManager } from './services/RemoteSessionManager';
import { ThemeProvider } from './theme';
import './styles/index.scss';

type Page = 'pairing' | 'workspace' | 'sessions' | 'chat';
type NavDirection = 'push' | 'pop' | null;

const NAV_PUSH_DURATION = 350;
const NAV_POP_DURATION = 250;

function getNavClass(
  targetPage: Page,
  currentPage: Page,
  navDir: NavDirection,
  isAnimating: boolean,
): string {
  if (!isAnimating) return '';
  const isEntering = currentPage === targetPage;
  if (isEntering) {
    return navDir === 'push' ? 'nav-push-enter' : 'nav-pop-enter';
  }
  return navDir === 'push' ? 'nav-push-exit' : 'nav-pop-exit';
}

const AppContent: React.FC = () => {
  const [page, setPage] = useState<Page>('pairing');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string>('Session');
  const [chatAutoFocus, setChatAutoFocus] = useState(false);
  const clientRef = useRef<RelayHttpClient | null>(null);
  const sessionMgrRef = useRef<RemoteSessionManager | null>(null);

  const [navDir, setNavDir] = useState<NavDirection>(null);
  const [prevPage, setPrevPage] = useState<Page | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const navigateTo = useCallback((target: Page, direction: NavDirection) => {
    setPage(prev => {
      setPrevPage(prev);
      return target;
    });
    setNavDir(direction);
    clearTimeout(timerRef.current);
    const duration = direction === 'pop' ? NAV_POP_DURATION : NAV_PUSH_DURATION;
    timerRef.current = setTimeout(() => {
      setPrevPage(null);
      setNavDir(null);
    }, duration);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handlePaired = useCallback(
    (client: RelayHttpClient, sessionMgr: RemoteSessionManager) => {
      clientRef.current = client;
      sessionMgrRef.current = sessionMgr;
      setPage('sessions');
    },
    [],
  );

  const handleOpenWorkspace = useCallback(() => {
    navigateTo('workspace', 'push');
  }, [navigateTo]);

  const handleWorkspaceReady = useCallback(() => {
    navigateTo('sessions', 'pop');
  }, [navigateTo]);

  const handleSelectSession = useCallback((sessionId: string, sessionName?: string, isNew?: boolean) => {
    setActiveSessionId(sessionId);
    setActiveSessionName(sessionName || 'Session');
    setChatAutoFocus(!!isNew);
    navigateTo('chat', 'push');
  }, [navigateTo]);

  const handleBackToSessions = useCallback(() => {
    navigateTo('sessions', 'pop');
    setTimeout(() => setActiveSessionId(null), NAV_POP_DURATION);
  }, [navigateTo]);

  const isAnimating = navDir !== null;
  const currentPage: Page = page;

  const shouldShow = (p: Page) => currentPage === p || (isAnimating && prevPage === p);

  return (
    <div className="mobile-app">
      {page === 'pairing' && <PairingPage onPaired={handlePaired} />}
      {shouldShow('workspace') && sessionMgrRef.current && (
        <div className={`nav-page ${getNavClass('workspace', currentPage, navDir, isAnimating)}`}>
          <WorkspacePage
            sessionMgr={sessionMgrRef.current}
            onReady={handleWorkspaceReady}
          />
        </div>
      )}
      {shouldShow('sessions') && sessionMgrRef.current && (
        <div className={`nav-page ${getNavClass('sessions', currentPage, navDir, isAnimating)}`}>
          <SessionListPage
            sessionMgr={sessionMgrRef.current}
            onSelectSession={handleSelectSession}
            onOpenWorkspace={handleOpenWorkspace}
          />
        </div>
      )}
      {shouldShow('chat') && sessionMgrRef.current && activeSessionId && (
        <div className={`nav-page ${getNavClass('chat', currentPage, navDir, isAnimating)}`}>
          <ChatPage
            sessionMgr={sessionMgrRef.current}
            sessionId={activeSessionId}
            sessionName={activeSessionName}
            onBack={handleBackToSessions}
            autoFocus={chatAutoFocus}
          />
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <AppContent />
  </ThemeProvider>
);

export default App;
