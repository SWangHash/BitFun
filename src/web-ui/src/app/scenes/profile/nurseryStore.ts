import { create } from 'zustand';

export type NurseryPage = 'gallery' | 'template' | 'assistant';

interface NurseryStoreState {
  page: NurseryPage;
  activeWorkspaceId: string | null;
  openGallery: () => void;
  openTemplate: () => void;
  openAssistant: (workspaceId: string) => void;
}

export const useNurseryStore = create<NurseryStoreState>((set) => ({
  page: 'gallery',
  activeWorkspaceId: null,
  openGallery: () => set({ page: 'gallery', activeWorkspaceId: null }),
  openTemplate: () => set({ page: 'template', activeWorkspaceId: null }),
  openAssistant: (workspaceId) => set({ page: 'assistant', activeWorkspaceId: workspaceId }),
}));
