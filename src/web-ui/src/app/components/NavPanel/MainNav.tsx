/**
 * MainNav — default workspace navigation sidebar.
 *
 * Renders nav sections. When a scene-nav transition
 * is active (`isDeparting=true`), every item/section receives a positional
 * CSS class relative to the anchor item (`anchorNavSceneId`):
 *   - items above the anchor  → `.is-departing-up`   (slide up + fade)
 *   - the anchor item itself  → `.is-departing-anchor` (brief highlight)
 *   - items below the anchor  → `.is-departing-down`  (slide down + fade)
 * This creates the visual "split-open from the clicked item" effect while
 * the outer Grid accordion handles the actual height collapse.
 */

import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, FolderOpen, FolderPlus, History, Check, Bot, Code2, Users } from 'lucide-react';
import { useApp } from '../../hooks/useApp';
import { useSceneManager } from '../../hooks/useSceneManager';
import { useNavSceneStore } from '../../stores/navSceneStore';
import { useSessionModeStore } from '../../stores/sessionModeStore';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { NAV_SECTIONS } from './config';
import type { PanelType } from '../../types';
import type { NavItem as NavItemConfig } from './types';
import type { SceneTabId } from '../SceneBar/types';
import NavItem from './components/NavItem';
import SectionHeader from './components/SectionHeader';
import ToolboxEntry from './components/ToolboxEntry';
import WorkspaceListSection from './sections/workspaces/WorkspaceListSection';
import { useSceneStore } from '../../stores/sceneStore';
import { useMyAgentStore } from '../../scenes/my-agent/myAgentStore';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { WorkspaceKind } from '@/shared/types';

const DEFAULT_MODE_CONFIG_KEY = 'app.session_config.default_mode';
import './NavPanel.scss';

const log = createLogger('MainNav');

type DepartDir = 'up' | 'anchor' | 'down' | null;

/**
 * Build a flat ordered list of (sectionId, itemTab) tuples so we can
 * determine each element's position relative to the anchor item.
 */
function buildFlatItemOrder(): { sectionId: string; tab: PanelType; navSceneId?: SceneTabId }[] {
  const list: { sectionId: string; tab: PanelType; navSceneId?: SceneTabId }[] = [];
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      list.push({ sectionId: section.id, tab: item.tab, navSceneId: item.navSceneId });
    }
  }
  return list;
}

const FLAT_ITEMS = buildFlatItemOrder();

function getAnchorIndex(anchorId: SceneTabId | null): number {
  if (!anchorId) return -1;
  return FLAT_ITEMS.findIndex(i => i.navSceneId === anchorId);
}

interface MainNavProps {
  isDeparting?: boolean;
  anchorNavSceneId?: SceneTabId | null;
}

const MainNav: React.FC<MainNavProps> = ({
  isDeparting = false,
  anchorNavSceneId = null,
}) => {
  const { state, switchLeftPanelTab } = useApp();
  const { openScene } = useSceneManager();
  const openNavScene = useNavSceneStore(s => s.openNavScene);
  const activeTabId = useSceneStore(s => s.activeTabId);
  const setMyAgentView = useMyAgentStore(s => s.setActiveView);
  const setSelectedAssistantWorkspaceId = useMyAgentStore((s) => s.setSelectedAssistantWorkspaceId);
  const { t } = useI18n('common');
  const {
    currentWorkspace,
    recentWorkspaces,
    openedWorkspacesList,
    assistantWorkspacesList,
    switchWorkspace,
    setActiveWorkspace,
  } = useWorkspaceContext();

  const activeTab = state.layout.leftPanelActiveTab;
  const activeMiniAppId = useMemo(
    () => (typeof activeTabId === 'string' && activeTabId.startsWith('miniapp:') ? activeTabId.slice('miniapp:'.length) : null),
    [activeTabId]
  );

  const anchorIdx = useMemo(() => getAnchorIndex(anchorNavSceneId), [anchorNavSceneId]);

  const getDepartDir = useCallback(
    (flatIdx: number): DepartDir => {
      if (!isDeparting) return null;
      if (anchorIdx < 0) return 'up';
      if (flatIdx < anchorIdx) return 'up';
      if (flatIdx === anchorIdx) return 'anchor';
      return 'down';
    },
    [isDeparting, anchorIdx]
  );

  const getSectionDepartDir = useCallback(
    (sectionId: string): DepartDir => {
      if (!isDeparting) return null;
      if (anchorIdx < 0) return 'up';
      const first = FLAT_ITEMS.findIndex(i => i.sectionId === sectionId);
      const last  = FLAT_ITEMS.length - 1 - [...FLAT_ITEMS].reverse().findIndex(i => i.sectionId === sectionId);
      if (last < anchorIdx) return 'up';
      if (first > anchorIdx) return 'down';
      return null;
    },
    [isDeparting, anchorIdx]
  );

  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const init = new Set<string>();
    NAV_SECTIONS.forEach(s => {
      if (s.defaultExpanded !== false) init.add(s.id);
    });
    return init;
  });
  const workspaceMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuClosing, setWorkspaceMenuClosing] = useState(false);
  const [workspaceMenuPos, setWorkspaceMenuPos] = useState({ top: 0, left: 0 });

  const modeDropdownButtonRef = useRef<HTMLButtonElement | null>(null);
  const modeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [modeDropdownClosing, setModeDropdownClosing] = useState(false);
  const [modeDropdownPos, setModeDropdownPos] = useState({ top: 0, left: 0 });

  const getSectionLabel = useCallback(
    (sectionId: string, fallbackLabel: string | null) => {
      if (!fallbackLabel) return null;
      const keyMap: Record<string, string> = {
        assistants: 'nav.workspaces.groups.assistants',
        workspace: 'nav.sections.workspace',
        'my-agent': 'nav.sections.myAgent',
        toolbox: 'scenes.toolbox',
      };
      const key = keyMap[sectionId];
      return key ? t(key) || fallbackLabel : fallbackLabel;
    },
    [t]
  );

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const closeWorkspaceMenu = useCallback(() => {
    setWorkspaceMenuClosing(true);
    window.setTimeout(() => {
      setWorkspaceMenuOpen(false);
      setWorkspaceMenuClosing(false);
    }, 150);
  }, []);

  const openWorkspaceMenu = useCallback(() => {
    const rect = workspaceMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setWorkspaceMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
    });
    setWorkspaceMenuOpen(true);
    setWorkspaceMenuClosing(false);
  }, []);

  const toggleWorkspaceMenu = useCallback(() => {
    if (workspaceMenuOpen) {
      closeWorkspaceMenu();
      return;
    }
    openWorkspaceMenu();
  }, [closeWorkspaceMenu, openWorkspaceMenu, workspaceMenuOpen]);

  const setSessionMode = useSessionModeStore(s => s.setMode);
  const isAssistantWorkspaceActive = currentWorkspace?.workspaceKind === WorkspaceKind.Assistant;
  const defaultAssistantWorkspace = useMemo(
    () => assistantWorkspacesList.find(workspace => !workspace.assistantId) ?? assistantWorkspacesList[0] ?? null,
    [assistantWorkspacesList]
  );

  const [defaultSessionMode, setDefaultSessionMode] = useState<'code' | 'cowork'>('code');

  useEffect(() => {
    configManager.getConfig<'code' | 'cowork'>(DEFAULT_MODE_CONFIG_KEY).then(mode => {
      if (mode === 'code' || mode === 'cowork') setDefaultSessionMode(mode);
    }).catch(() => {});

    const unwatch = configManager.watch(DEFAULT_MODE_CONFIG_KEY, () => {
      configManager.getConfig<'code' | 'cowork'>(DEFAULT_MODE_CONFIG_KEY).then(mode => {
        if (mode === 'code' || mode === 'cowork') setDefaultSessionMode(mode);
      }).catch(() => {});
    });
    return () => unwatch();
  }, []);

  useEffect(() => {
    openedWorkspacesList.forEach(workspace => {
      void flowChatStore.initializeFromDisk(workspace.rootPath);
    });
  }, [openedWorkspacesList]);

  const closeModeDropdown = useCallback(() => {
    setModeDropdownClosing(true);
    window.setTimeout(() => {
      setModeDropdownOpen(false);
      setModeDropdownClosing(false);
    }, 150);
  }, []);

  const openModeDropdown = useCallback(() => {
    const rect = modeDropdownButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setModeDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
    setModeDropdownOpen(true);
    setModeDropdownClosing(false);
  }, []);

  const toggleModeDropdown = useCallback(() => {
    if (modeDropdownOpen) {
      closeModeDropdown();
      return;
    }
    openModeDropdown();
  }, [closeModeDropdown, openModeDropdown, modeDropdownOpen]);

  const handleSetDefaultMode = useCallback(async (mode: 'code' | 'cowork') => {
    closeModeDropdown();
    setDefaultSessionMode(mode);
    setSessionMode(mode);
    try {
      await configManager.setConfig(DEFAULT_MODE_CONFIG_KEY, mode);
    } catch (err) {
      log.error('Failed to save default session mode', err);
    }
  }, [closeModeDropdown, setSessionMode]);

  const handleCreateAssistantWorkspace = useCallback(async () => {
    closeModeDropdown();
    try {
      await workspaceManager.createAssistantWorkspace();
    } catch (err) {
      log.error('Failed to create assistant workspace', err);
    }
  }, [closeModeDropdown]);

  const handleItemClick = useCallback(
    (tab: PanelType, item: NavItemConfig) => {
      if (item.behavior === 'scene' && item.sceneId) {
        openScene(item.sceneId);
      } else {
        if (item.navSceneId) {
          openNavScene(item.navSceneId);
        }
        switchLeftPanelTab(tab);
      }
    },
    [switchLeftPanelTab, openScene, openNavScene]
  );

  const handleCreateSession = useCallback(async () => {
    openScene('session');
    switchLeftPanelTab('sessions');
    try {
      await flowChatManager.createChatSession(
        { modelName: 'claude-sonnet-4.5' },
        isAssistantWorkspaceActive
          ? 'Claw'
          : defaultSessionMode === 'cowork'
            ? 'Cowork'
            : 'agentic'
      );
    } catch (err) {
      log.error('Failed to create session', err);
    }
  }, [openScene, switchLeftPanelTab, defaultSessionMode, isAssistantWorkspaceActive]);

  const handleOpenProject = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: t('header.selectProjectDirectory') });
      if (selected && typeof selected === 'string') {
        await workspaceManager.openWorkspace(selected);
      }
    } catch (err) {
      log.error('Failed to open project', err);
    }
  }, [t]);

  const handleNewProject = useCallback(() => {
    window.dispatchEvent(new Event('nav:new-project'));
  }, []);

  const handleSwitchWorkspace = useCallback(async (workspaceId: string) => {
    const targetWorkspace = recentWorkspaces.find(item => item.id === workspaceId);
    if (!targetWorkspace) return;
    closeWorkspaceMenu();
    try {
      await switchWorkspace(targetWorkspace);
    } catch (err) {
      log.error('Failed to switch workspace', err);
    }
  }, [closeWorkspaceMenu, recentWorkspaces, switchWorkspace]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (workspaceMenuButtonRef.current?.contains(target)) return;
      if (workspaceMenuRef.current?.contains(target)) return;
      closeWorkspaceMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeWorkspaceMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeWorkspaceMenu, workspaceMenuOpen]);

  useEffect(() => {
    if (!modeDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (modeDropdownButtonRef.current?.contains(target)) return;
      if (modeDropdownRef.current?.contains(target)) return;
      closeModeDropdown();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModeDropdown();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeModeDropdown, modeDropdownOpen]);

  const handleOpenProfile = useCallback(() => {
    const targetAssistantWorkspace =
      isAssistantWorkspaceActive && currentWorkspace?.workspaceKind === WorkspaceKind.Assistant
        ? currentWorkspace
        : defaultAssistantWorkspace;

    if (targetAssistantWorkspace?.id) {
      setSelectedAssistantWorkspaceId(targetAssistantWorkspace.id);
    }

    if (!isAssistantWorkspaceActive && targetAssistantWorkspace) {
      void setActiveWorkspace(targetAssistantWorkspace.id).catch(error => {
        log.warn('Failed to activate default assistant workspace', { error });
      });
    }
    setMyAgentView('profile');
    switchLeftPanelTab('profile');
    openScene('my-agent');
  }, [
    currentWorkspace,
    defaultAssistantWorkspace,
    isAssistantWorkspaceActive,
    openScene,
    setActiveWorkspace,
    setMyAgentView,
    setSelectedAssistantWorkspaceId,
    switchLeftPanelTab,
  ]);

  let flatCounter = 0;

  const workspaceMenuPortal = workspaceMenuOpen ? createPortal(
    <div
      ref={workspaceMenuRef}
      className={`bitfun-nav-panel__workspace-menu${workspaceMenuClosing ? ' is-closing' : ''}`}
      role="menu"
      style={{ top: workspaceMenuPos.top, left: workspaceMenuPos.left }}
    >
      <button
        type="button"
        className="bitfun-nav-panel__workspace-menu-item"
        role="menuitem"
        onClick={() => {
          closeWorkspaceMenu();
          void handleOpenProject();
        }}
      >
        <FolderOpen size={13} />
        <span>{t('header.openProject')}</span>
      </button>
      <button
        type="button"
        className="bitfun-nav-panel__workspace-menu-item"
        role="menuitem"
        onClick={() => {
          closeWorkspaceMenu();
          handleNewProject();
        }}
      >
        <FolderPlus size={13} />
        <span>{t('header.newProject')}</span>
      </button>
      <div className="bitfun-nav-panel__workspace-menu-divider" role="separator" />
      <div className="bitfun-nav-panel__workspace-menu-section-title">
        <History size={12} aria-hidden="true" />
        <span>{t('header.recentWorkspaces')}</span>
      </div>
      {recentWorkspaces.length === 0 ? (
        <div className="bitfun-nav-panel__workspace-menu-empty">
          <span>{t('header.noRecentWorkspaces')}</span>
        </div>
      ) : (
        <div className="bitfun-nav-panel__workspace-menu-workspaces">
          {recentWorkspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className="bitfun-nav-panel__workspace-menu-item bitfun-nav-panel__workspace-menu-item--workspace"
              role="menuitem"
              title={workspace.rootPath}
              onClick={() => { void handleSwitchWorkspace(workspace.id); }}
            >
              <FolderOpen size={13} aria-hidden="true" />
              <span className="bitfun-nav-panel__workspace-menu-item-main">{workspace.name}</span>
              {workspace.id === currentWorkspace?.id ? <Check size={12} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  ) : null;

  const ModeIcon = isAssistantWorkspaceActive
    ? Bot
    : defaultSessionMode === 'cowork'
      ? Users
      : Code2;

  const modeDropdownPortal = modeDropdownOpen ? createPortal(
    <div
      ref={modeDropdownRef}
      className={`bitfun-nav-panel__mode-dropdown${modeDropdownClosing ? ' is-closing' : ''}`}
      role="menu"
      style={{ top: modeDropdownPos.top, left: modeDropdownPos.left }}
    >
      {isAssistantWorkspaceActive ? (
        <button
          type="button"
          className="bitfun-nav-panel__mode-dropdown-item"
          role="menuitem"
          onClick={() => { void handleCreateAssistantWorkspace(); }}
        >
          <Bot size={13} className="bitfun-nav-panel__mode-dropdown-item-icon is-claw" />
          <span className="bitfun-nav-panel__mode-dropdown-item-label">{t('nav.workspaces.actions.newAssistant')}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`bitfun-nav-panel__mode-dropdown-item${defaultSessionMode === 'code' ? ' is-active' : ''}`}
            role="menuitem"
            onClick={() => { void handleSetDefaultMode('code'); }}
          >
            <Code2 size={13} className="bitfun-nav-panel__mode-dropdown-item-icon is-code" />
            <span className="bitfun-nav-panel__mode-dropdown-item-label">{t('nav.sessions.codeSessionMode')}</span>
            {defaultSessionMode === 'code' && <Check size={12} className="bitfun-nav-panel__mode-dropdown-item-check" />}
          </button>
          <button
            type="button"
            className={`bitfun-nav-panel__mode-dropdown-item${defaultSessionMode === 'cowork' ? ' is-active' : ''}`}
            role="menuitem"
            onClick={() => { void handleSetDefaultMode('cowork'); }}
          >
            <Users size={13} className="bitfun-nav-panel__mode-dropdown-item-icon is-cowork" />
            <span className="bitfun-nav-panel__mode-dropdown-item-label">{t('nav.sessions.coworkSessionMode')}</span>
            {defaultSessionMode === 'cowork' && <Check size={12} className="bitfun-nav-panel__mode-dropdown-item-check" />}
          </button>
        </>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div className="bitfun-nav-panel__workspace-toolbar">
        <button
          type="button"
          className="bitfun-nav-panel__workspace-bot"
          onClick={handleOpenProfile}
          aria-label={t('nav.items.persona')}
          title={t('nav.items.persona')}
        >
          <img className="bitfun-nav-panel__workspace-bot-logo" src="/Logo-ICON.png" alt="" />
        </button>
        <div className="bitfun-nav-panel__workspace-create-group">
          <button
            type="button"
            className="bitfun-nav-panel__workspace-create-main"
            onClick={handleCreateSession}
            title={
              isAssistantWorkspaceActive
                ? t('nav.sessions.newClawSession')
                : defaultSessionMode === 'cowork'
                  ? t('nav.sessions.newCoworkSession')
                  : t('nav.sessions.newCodeSession')
            }
          >
            <Plus size={14} />
            <span>{t('nav.sessions.newSession')}</span>
          </button>
          <button
            ref={modeDropdownButtonRef}
            type="button"
            className={`bitfun-nav-panel__workspace-create-mode${modeDropdownOpen ? ' is-active' : ''}`}
            onClick={toggleModeDropdown}
            title={
              isAssistantWorkspaceActive
                ? t('nav.workspaces.actions.newAssistant')
                : defaultSessionMode === 'cowork'
                  ? t('nav.sessions.newCoworkSessionDefault')
                  : t('nav.sessions.newCodeSessionDefault')
            }
            aria-expanded={modeDropdownOpen}
            aria-haspopup="listbox"
          >
            <ModeIcon size={13} />
          </button>
        </div>
      </div>

      <div className="bitfun-nav-panel__sections">
        {NAV_SECTIONS.filter(section => section.id !== 'toolbox').map(section => {
          const isSectionOpen = expandedSections.has(section.id);
          const isCollapsible = !!section.collapsible;
          const showItems     = !isCollapsible || isSectionOpen;
          const sectionDir    = getSectionDepartDir(section.id);
          const sectionDepartCls = sectionDir ? ` is-departing-${sectionDir}` : '';

          const sectionSceneId = section.sceneId;

          return (
            <div key={section.id} className={`bitfun-nav-panel__section${sectionDepartCls}`}>
              {section.label && (
                <SectionHeader
                  label={getSectionLabel(section.id, section.label) ?? section.label}
                  collapsible={isCollapsible}
                  isOpen={isSectionOpen}
                  onToggle={() => toggleSection(section.id)}
                  onSceneOpen={sectionSceneId ? () => openScene(sectionSceneId) : undefined}
                  actions={section.id === 'assistants' ? (
                    <div className="bitfun-nav-panel__workspace-action-wrap">
                      <button
                        type="button"
                        className="bitfun-nav-panel__section-action"
                        aria-label={t('nav.workspaces.actions.newAssistant')}
                        title={t('nav.workspaces.actions.newAssistant')}
                        onClick={() => { void handleCreateAssistantWorkspace(); }}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  ) : section.id === 'workspace' ? (
                    <div className="bitfun-nav-panel__workspace-action-wrap">
                      <button
                        ref={workspaceMenuButtonRef}
                        type="button"
                        className={`bitfun-nav-panel__section-action${workspaceMenuOpen ? ' is-active' : ''}`}
                        aria-label={t('header.openProject')}
                        title={t('header.openProject')}
                        aria-expanded={workspaceMenuOpen}
                        onClick={toggleWorkspaceMenu}
                      >
                        <FolderOpen size={13} />
                      </button>
                    </div>
                  ) : undefined}
                />
              )}

              <div className={`bitfun-nav-panel__collapsible${showItems ? '' : ' is-collapsed'}`}>
                <div className="bitfun-nav-panel__collapsible-inner">
                  <div className="bitfun-nav-panel__items">
                    {section.id === 'assistants' && <WorkspaceListSection variant="assistants" />}
                    {section.id === 'workspace' && <WorkspaceListSection variant="projects" />}
                    {section.items.map(item => {
                      const currentFlatIdx = flatCounter++;
                      const { tab } = item;
                      const dir = getDepartDir(currentFlatIdx);
                      const isActive = tab === 'toolbox'
                        ? activeTabId === 'toolbox'
                        : item.navSceneId
                        ? false
                        : item.sceneId
                          ? item.sceneId === activeTabId
                          : activeTabId === 'session' && tab === activeTab;
                      const displayLabel = item.labelKey ? t(item.labelKey) : (item.label ?? '');
                      const tooltipContent = item.tooltipKey ? t(item.tooltipKey) : undefined;
                      const departCls = dir ? ` is-departing-${dir}` : '';

                      return (
                        <div key={tab} className={`bitfun-nav-panel__item-slot${departCls}`}>
                          <NavItem
                            item={item}
                            displayLabel={displayLabel}
                            tooltipContent={tooltipContent}
                            isActive={isActive}
                            onClick={() => handleItemClick(tab, item)}
                            actionIcon={tab === 'sessions' ? Plus : undefined}
                            actionTitle={
                              tab === 'sessions'
                                ? isAssistantWorkspaceActive
                                  ? t('nav.sessions.newClawSession')
                                  : defaultSessionMode === 'cowork'
                                    ? t('nav.sessions.newCoworkSession')
                                    : t('nav.sessions.newCodeSession')
                                : undefined
                            }
                            onActionClick={tab === 'sessions' ? handleCreateSession : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bitfun-nav-panel__toolbox-footer">
        <ToolboxEntry
          isActive={activeTabId === 'toolbox' || !!activeMiniAppId}
          activeMiniAppId={activeMiniAppId}
          onOpenToolbox={() => openScene('toolbox')}
          onOpenMiniApp={(appId) => openScene(`miniapp:${appId}`)}
        />
      </div>

      {workspaceMenuPortal}
      {modeDropdownPortal}
    </>
  );
};

export default MainNav;
