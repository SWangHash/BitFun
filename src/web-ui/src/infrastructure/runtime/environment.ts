type TauriInternals = {
  invoke?: unknown;
  metadata?: {
    currentWindow?: {
      label?: string;
    };
  };
};

const getTauriInternals = (): TauriInternals | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
};

export const isTauriRuntime = (): boolean => {
  const internals = getTauriInternals();
  return typeof internals?.invoke === 'function';
};

export const supportsNativeWindowControls = (): boolean => {
  // Tauri window APIs read metadata.currentWindow; browser builds must not call them without it.
  const currentWindow = getTauriInternals()?.metadata?.currentWindow;
  return isTauriRuntime() && typeof currentWindow?.label === 'string';
};

/**
 * OpenHarmony renders the window chrome in its native ArkUI host.  The web
 * view must reserve that space but must not render a second set of buttons or
 * call the desktop/Tauri window APIs for the same action.
 */
export const isOpenHarmonyRuntime = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const fingerprint = `${navigator.userAgent ?? ''} ${navigator.platform ?? ''}`;
  return /(?:openharmony|harmonyos|ohos)/i.test(fingerprint);
};

let ohosHostWindowControlsCache: boolean | null = null;

/**
 * The OpenHarmony host keeps its native minimize/maximize/close buttons
 * visible in the top-right corner of the same strip the web UI draws its own
 * in-app window controls in, so the two sets overlap. Renderers must hide the
 * in-app set and reserve that corner for the host chrome instead.
 */
export const usesHostWindowControls = (): boolean => {
  if (ohosHostWindowControlsCache === null) {
    ohosHostWindowControlsCache = isTauriRuntime() && isOpenHarmonyRuntime();
  }
  return ohosHostWindowControlsCache;
};

export const supportsNativeWindowDragging = supportsNativeWindowControls;

export const isMacOSDesktopRuntime = (): boolean =>
  supportsNativeWindowControls() &&
  typeof navigator !== 'undefined' &&
  typeof navigator.platform === 'string' &&
  navigator.platform.toUpperCase().includes('MAC');

export const isWindowsDesktopRuntime = (): boolean =>
  supportsNativeWindowControls() &&
  typeof navigator !== 'undefined' &&
  (
    (typeof navigator.userAgent === 'string' && navigator.userAgent.toUpperCase().includes('WINDOWS'))
    || (typeof navigator.platform === 'string' && navigator.platform.toUpperCase().includes('WIN'))
  );
