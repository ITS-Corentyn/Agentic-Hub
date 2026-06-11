import { reactive } from 'vue';
import { api } from '../api';

interface MeUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

export const auth = reactive({
  loaded: false,
  authActive: false,
  user: null as MeUser | null,

  /** Peut effectuer des mutations (admin/member, ou auth désactivée). */
  get canWrite(): boolean {
    if (!this.authActive) return true;
    return !!this.user && (this.user.role === 'admin' || this.user.role === 'member');
  },
  get isAdmin(): boolean {
    if (!this.authActive) return true;
    return this.user?.role === 'admin';
  },
  get needsLogin(): boolean {
    return this.authActive && !this.user;
  },
  get isPending(): boolean {
    return this.authActive && this.user?.role === 'pending';
  },
});

export async function loadAuth(): Promise<void> {
  try {
    const r = await api.me();
    auth.authActive = r.authActive;
    auth.user = r.user;
  } catch {
    auth.authActive = false;
    auth.user = null;
  }
  auth.loaded = true;
}
