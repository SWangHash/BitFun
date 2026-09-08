import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isTauriRuntime,
  isWindowsDesktopRuntime,
  supportsNativeWindowControls,
  usesHostWindowControls,
} from './environment';

const setTauriInternals = (value: unknown) => {
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: value,
  });
};

describe('runtime environment', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats a plain browser as non-Tauri without native window controls', () => {
    vi.stubGlobal('window', {});

    expect(isTauriRuntime()).toBe(false);
    expect(supportsNativeWindowControls()).toBe(false);
  });

  it('requires current window metadata before enabling native window controls', () => {
    setTauriInternals({ invoke: vi.fn() });

    expect(isTauriRuntime()).toBe(true);
    expect(supportsNativeWindowControls()).toBe(false);
  });

  it('enables native window controls for a complete Tauri window runtime', () => {
    setTauriInternals({
      invoke: vi.fn(),
      metadata: {
        currentWindow: {
          label: 'main',
        },
      },
    });

    expect(isTauriRuntime()).toBe(true);
    expect(supportsNativeWindowControls()).toBe(true);
  });

  it('detects Windows only for a complete Tauri desktop runtime', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    vi.stubGlobal('window', {});
    expect(isWindowsDesktopRuntime()).toBe(false);

    setTauriInternals({
      invoke: vi.fn(),
      metadata: { currentWindow: { label: 'main' } },
    });
    expect(isWindowsDesktopRuntime()).toBe(true);
  });

  it('defers window chrome to the OpenHarmony host only inside a Tauri runtime', async () => {
    const ohosNavigator = { platform: 'OpenHarmony', userAgent: 'OpenHarmony' };
    vi.stubGlobal('navigator', ohosNavigator);

    // Browser build on the OHOS webview: no host-owned Tauri window to defer to.
    vi.stubGlobal('window', {});
    const { usesHostWindowControls: browserOhos } = await import('./environment');
    expect(browserOhos()).toBe(false);

    vi.resetModules();

    // Complete Tauri window runtime on OHOS: the native ArkUI chrome owns the
    // top-right buttons, so the web UI must not draw its own set.
    setTauriInternals({
      invoke: vi.fn(),
      metadata: { currentWindow: { label: 'main' } },
    });
    const { usesHostWindowControls: ohosTauri } = await import('./environment');
    expect(ohosTauri()).toBe(true);

    vi.resetModules();

    // Windows desktop runtime keeps the in-app controls.
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows' });
    const { usesHostWindowControls: windowsTauri } = await import('./environment');
    expect(windowsTauri()).toBe(false);
  });
});
