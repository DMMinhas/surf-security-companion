import { create } from 'zustand';
import type { Claims } from '../lib/oidc';

interface SessionState {
  claims: Claims | null;
  setClaims: (claims: Claims | null) => void;
  hasRole: (...roles: string[]) => boolean;
  isReadOnly: () => boolean;
}

export const useSession = create<SessionState>((set, get) => ({
  claims: null,
  setClaims: (claims) => set({ claims }),
  hasRole: (...roles) => {
    const current = get().claims?.roles ?? [];
    return roles.some((r) => current.includes(r));
  },
  isReadOnly: () => {
    const current = get().claims?.roles ?? [];
    return current.length > 0 && current.every((r) => r === 'AUDITOR' || r === 'EXECUTIVE_OBSERVER');
  },
}));
