import { createContext, useContext } from 'react';

/** Presentation capabilities only; the server independently enforces every operation. */
export const WorkspaceAccess = createContext<{ deployed: boolean; permissions: Record<string, string[]> }>({
  deployed: false, permissions: {},
});
export const useWorkspaceAccess = () => useContext(WorkspaceAccess);
