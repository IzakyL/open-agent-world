import { create } from 'zustand';

/** Window selection is transient; the layout lives in the Legion's config. */
export const useLegionWorkspace = create<{
  activeId?: string; open: (id: string) => void; close: () => void;
}>(set => ({
  open: activeId => set({ activeId }), close: () => set({ activeId: undefined }),
}));
