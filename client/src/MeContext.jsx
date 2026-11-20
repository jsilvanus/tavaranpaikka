import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api/client.js';

export const ROLE_RANK = { member: 1, keeper: 2, admin: 3 };

const MeContext = createContext({ me: null, loading: true, role: null, refresh: () => {} });

/** Effective role of the signed-in user in the current organization (or null). */
export function effectiveRole(me) {
  if (!me?.user) return null;
  const org = Array.isArray(me.organizations)
    ? me.organizations.find((o) => o.id === me.organizationId)
    : null;
  return org?.role || me.user.role || null;
}

export function hasRole(role, min) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[min] || 99);
}

export function MeProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    return api
      .getMe()
      .then((d) => setMe(d || null))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <MeContext.Provider value={{ me, loading, role: effectiveRole(me), refresh }}>
      {children}
    </MeContext.Provider>
  );
}

export function useMe() {
  return useContext(MeContext);
}
