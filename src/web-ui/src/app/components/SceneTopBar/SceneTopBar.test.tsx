// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SceneTopBar from './SceneTopBar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sceneState = vi.hoisted(() => ({ openTabs: [{}] as unknown[], selectTab: vi.fn(), closeTab: vi.fn() }));
const startDragging = vi.hoisted(() => vi.fn(async () => {}));
const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/app/components/SceneTopBar/SceneTopBar.scss'),
  'utf8',
);

const runtimeState = vi.hoisted(() => ({ usesHostWindowControls: false }));

vi.mock('@/app/components/WindowControls', () => ({ WindowControls: () => <button>Window controls</button> }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging }) }));
vi.mock('@/infrastructure/runtime', () => ({
  isTauriRuntime: () => false,
  isOpenHarmonyRuntime: () => false,
  supportsNativeWindowDragging: () => false,
  usesHostWindowControls: () => runtimeState.usesHostWindowControls,
}));
vi.mock('../../stores/sceneStore', () => ({ useSceneStore: (selector: (state: typeof sceneState) => unknown) => selector(sceneState) }));
vi.mock('../SceneBar/SceneBar', async () => {
  const { TabGroup } = await import('@openbitfun/ui');
  return {
    default: () => <TabGroup
      value="0"
      onValueChange={sceneState.selectTab}
      items={sceneState.openTabs.map((_, index) => ({
        value: String(index),
        label: <span>Scene {index}</span>,
        endAction: <button onClick={sceneState.closeTab} aria-label={`Close scene ${index}`}>
          <svg><path d="M0 0L1 1" /></svg>
        </button>,
      }))}
    />,
  };
});
vi.mock('./SceneChrome', () => ({
  SceneChromeHost: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>
    <button><svg><path d="M0 0L1 1" /></svg>Scene action</button>
    <input aria-label="Scene search" />
    <div contentEditable suppressContentEditableWarning><span>Editable title</span></div>
  </div>,
}));

describe('SceneTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__TAURI_INTERNALS__', {
      invoke: vi.fn(),
      metadata: { currentWindow: { label: 'main' } },
    });
    sceneState.openTabs = [{}];
  });

  afterEach(() => vi.unstubAllGlobals());

  it('extends the Toolbar divider through both side gaps on the same pixel row', () => {
    expect(stylesheet).not.toContain('border-block-end: 0;');
    expect(stylesheet).toContain(
      'inset-block-end: calc(0px - var(--openbitfun-border-width-default));',
    );
    expect(stylesheet).toContain('width: var(--openbitfun-space-4);');
    expect(stylesheet).toContain('inset-inline-end: 100%;');
    expect(stylesheet).toContain('inset-inline-start: 100%;');
  });

  it('composes the public Toolbar without changing scene actions or window interaction boundaries', () => {
    sceneState.openTabs = [{}];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const maximize = vi.fn();
    try {
      act(() => root.render(<SceneTopBar onMinimize={vi.fn()} onMaximize={maximize} onClose={vi.fn()} />));
      const toolbar = host.querySelector('[data-openbitfun-component="toolbar"]')!;
      expect(toolbar.getAttribute('data-openbitfun-part')).toBe('topBar');
      expect(toolbar.getAttribute('data-size')).toBe('md');
      expect(toolbar.getAttribute('data-bordered')).toBe('true');
      expect(toolbar.querySelector(':scope > [data-openbitfun-part="leading"] [role="tablist"]')).not.toBeNull();
      const trailing = toolbar.querySelector(':scope > [data-openbitfun-part="trailing"]')!;
      const actions = trailing.querySelector('[data-openbitfun-part="sceneActions"]')!;
      const divider = trailing.querySelector('.openbitfun-scene-top-bar__actions-divider')!;
      const controls = trailing.querySelector('[data-openbitfun-part="controls"]')!;
      expect(actions.nextElementSibling).toBe(divider);
      expect(divider.getAttribute('data-openbitfun-part')).toBe('separator');
      expect(divider.getAttribute('aria-hidden')).toBe('true');
      expect(divider.nextElementSibling).toBe(controls);
      expect(controls.querySelector('button')).not.toBeNull();
      expect(stylesheet).toContain('&__actions:empty + &__actions-divider');
      act(() => toolbar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(maximize).toHaveBeenCalledOnce();
      act(() => toolbar.querySelector('[data-openbitfun-part="sceneActions"] button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(maximize).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('removes the divider when no scene tabs are open', () => {
    sceneState.openTabs = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => root.render(<SceneTopBar />));
      expect(host.querySelector('[data-openbitfun-component="toolbar"]')?.getAttribute('data-bordered'))
        .toBe('false');
    } finally {
      act(() => root.unmount());
      host.remove();
      sceneState.openTabs = [{}];
    }
  });

  it('reserves the host chrome corner instead of in-app controls on the OpenHarmony host', () => {
    runtimeState.usesHostWindowControls = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      // Mirrors the AppLayout OHOS wiring: maximize stays for the double-click
      // gesture while minimize/close are withheld from the in-app chrome.
      act(() => root.render(<SceneTopBar onMaximize={vi.fn()} />));
      const toolbar = host.querySelector('[data-openbitfun-component="toolbar"]')!;
      expect(toolbar.querySelector('[data-openbitfun-part="hostControls"]')).not.toBeNull();
      expect(toolbar.querySelector('[data-openbitfun-part="controls"]')).toBeNull();
      expect(stylesheet).toContain('&--host');
      expect(stylesheet).toContain('width: 128px;');
    } finally {
      runtimeState.usesHostWindowControls = false;
      act(() => root.unmount());
      host.remove();
    }
  });
});
