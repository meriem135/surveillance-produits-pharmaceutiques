import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

const API_URL = '/api/v1';

/** Échéance du JWT en millisecondes (null si illisible ou sans `exp`). */
function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function readStoredUser(): User | null {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return null;
      }
    }
    const stored = localStorage.getItem('user');
    return stored ? (JSON.parse(stored) as User) : null;
  } catch {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return null;
  }
}

export interface User {
  id: number;
  email: string;
  username: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  avatar_url: string | null;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(!!localStorage.getItem('token') && !localStorage.getItem('user'));

  useEffect(() => {
    if (!token || user) {
      setIsLoading(false);
      return;
    }
    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      })
      .then((text) => text ? JSON.parse(text) : null)
      .then((u) => {
        if (!u) throw new Error();
        setUser(u);
        localStorage.setItem('user', JSON.stringify(u));
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch {
      throw new Error('Impossible de joindre le serveur. Vérifiez que le backend est démarré.');
    }
    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
    if (!res.ok) {
      throw new Error((data.detail as string) || `Erreur de connexion (HTTP ${res.status})`);
    }
    const accessToken = data.access_token as string;
    const userData = data.user as User;
    if (!accessToken || !userData) {
      throw new Error("Réponse du serveur invalide. Le backend a peut-être besoin d'être redémarré.");
    }
    localStorage.setItem('token', accessToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  // Fin de session : déconnexion à l'expiration du JWT…
  useEffect(() => {
    if (!token) return;
    const exp = tokenExpiry(token);
    if (exp === null) return;
    const delay = exp - Date.now();
    const id = window.setTimeout(logout, Math.max(0, Math.min(delay, 2 ** 31 - 1)));
    return () => window.clearTimeout(id);
  }, [token, logout]);

  // …ou dès qu'un appel authentifié à l'API est refusé (401 : jeton révoqué,
  // secret changé au redémarrage du backend, compte désactivé).
  useEffect(() => {
    if (!token) return;
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      const url = requestUrl(input);
      if (res.status === 401 && url.includes('/api/') && !url.includes('/auth/login')) {
        logout();
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, updateUser, isAuthenticated: !!user && !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
