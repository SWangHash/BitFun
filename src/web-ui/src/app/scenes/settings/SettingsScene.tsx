/**
 * SettingsScene — content-only renderer for the Settings scene.
 *
 * The left-side navigation lives in SettingsNav (rendered by NavPanel via
 * nav-registry). This component only renders the active config content panel
 * driven by settingsStore.activeTab.
 */

import React, { lazy, Suspense } from 'react';
import { useSettingsStore } from './settingsStore';
import './SettingsScene.scss';

const AIModelConfig        = lazy(() => import('../../../infrastructure/config/components/AIModelConfig'));
const SessionConfig        = lazy(() => import('../../../infrastructure/config/components/SessionConfig'));
const AIRulesMemoryConfig  = lazy(() => import('../../../infrastructure/config/components/AIRulesMemoryConfig'));
const McpToolsConfig       = lazy(() => import('../../../infrastructure/config/components/McpToolsConfig'));
// const LspConfig            = lazy(() => import('../../../infrastructure/config/components/LspConfig'));
const EditorConfig         = lazy(() => import('../../../infrastructure/config/components/EditorConfig'));
const BasicsConfig         = lazy(() => import('../../../infrastructure/config/components/BasicsConfig'));
const SettingsScene: React.FC = () => {
  const activeTab = useSettingsStore(s => s.activeTab);

  let Content: React.LazyExoticComponent<React.ComponentType> | null = null;

  switch (activeTab) {
    case 'basics':           Content = BasicsConfig;         break;
    case 'models':           Content = AIModelConfig;        break;
    case 'session-config':   Content = SessionConfig;        break;
    case 'ai-context':       Content = AIRulesMemoryConfig; break;
    case 'mcp-tools':        Content = McpToolsConfig;      break;
    // case 'lsp':              Content = LspConfig;            break;
    case 'editor':           Content = EditorConfig;         break;
  }

  return (
    <div className="bitfun-settings-scene">
      <Suspense fallback={<div className="bitfun-settings-scene__loading" />}>
        {Content && (
          <div key={activeTab} className="bitfun-settings-scene__content-wrapper">
            <Content />
          </div>
        )}
      </Suspense>
    </div>
  );
};

export default SettingsScene;
