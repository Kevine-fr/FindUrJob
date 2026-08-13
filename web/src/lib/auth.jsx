import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

/**
 * Qui est connecté.
 *
 * La session vit dans un cookie `httpOnly` : le JavaScript ne peut pas la lire,
 * donc on ne devine pas l'état — on le demande au serveur au démarrage. Tant
 * que la réponse n'est pas là, l'application n'affiche rien de définitif, sinon
 * elle montrerait l'écran de connexion à quelqu'un qui est déjà connecté.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  // Vrai tant qu'aucun compte n'existe : la première visite propose alors la
  // création du compte administrateur plutôt qu'une connexion.
  const [setupNeeded, setSetupNeeded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { user: courant, setupNeeded: installation } = await api.auth.me();
      setUser(courant);
      setSetupNeeded(Boolean(installation));
    } catch {
      // API injoignable : on reste déconnecté plutôt que de bloquer sur un écran vide.
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      ready,
      setupNeeded,
      isAdmin: user?.role === 'admin',

      async login(email, password) {
        const { user: connecte } = await api.auth.login(email, password);
        setUser(connecte);
        setSetupNeeded(false);
        return connecte;
      },

      async register(body) {
        const { user: cree } = await api.auth.register(body);
        setUser(cree);
        setSetupNeeded(false);
        return cree;
      },

      async logout() {
        await api.auth.logout().catch(() => {});
        setUser(null);
      },

      async updateAccount(body) {
        const { user: maj } = await api.auth.update(body);
        setUser(maj);
        return maj;
      },

      refresh,
    }),
    [user, ready, setupNeeded, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un <AuthProvider>.');
  return context;
}
