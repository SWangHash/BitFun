/**
 * Peer-aware workspace directory picker.
 * - Local: native `@tauri-apps/plugin-dialog`
 * - Peer Device Mode: in-app browser listing the peer filesystem via HostInvoke
 */

import { isPeerDeviceModeActive } from './peerModeFlag';
import { usePeerDirectoryPickerStore } from './peerDirectoryPickerStore';
import { workspaceAPI } from '@/infrastructure/api';

export interface PickWorkspaceDirectoryOptions {
  title: string;
  defaultPath?: string;
}

export async function pickWorkspaceDirectory(
  options: PickWorkspaceDirectoryOptions,
): Promise<string | null> {
  if (!isPeerDeviceModeActive()) {
    // Platform-dispatched picker: native dialog on desktop, OHOS system
    // DocumentViewPicker on HarmonyOS.
    const selected = await workspaceAPI.open_oh_file_dialog({
      directory: true,
      multiple: false,
      title: options.title,
      defaultPath: options.defaultPath,
    });
    return typeof selected === 'string' && selected.length > 0 ? selected : null;
  }

  return usePeerDirectoryPickerStore.getState().show(options);
}
