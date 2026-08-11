import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Notifications éphémères.
 *
 * Une action asynchrone (chercher des offres, générer un PDF, ouvrir une
 * session) dure assez longtemps pour qu'un simple message final ne suffise
 * pas : `toast.promise` affiche l'attente, puis remplace le même toast par son
 * résultat, sans que l'appelant ait à gérer trois états.
 */

const ToastContext = createContext(null);

const DURATIONS = { success: 4000, info: 5000, error: 8000, loading: 0 }; // 0 = ne s'efface pas seul

const ICONS = {
  success: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="8" opacity=".25" />
      <path d="m6 10.5 2.5 2.5L14 7.5" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="8" opacity=".25" />
      <path d="M10 6v5M10 14h.01" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="8" opacity=".25" />
      <path d="M10 9v5M10 6h.01" />
    </svg>
  ),
  loading: <span className="toast-spinner" aria-hidden="true" />,
};

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    // On marque d'abord la sortie : le retrait réel attend la fin de l'animation.
    setToasts((list) => list.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 260);
  }, []);

  const schedule = useCallback(
    (id, duration) => {
      clearTimeout(timers.current.get(id));
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [dismiss]
  );

  const push = useCallback(
    (type, message, options = {}) => {
      const id = ++nextId;
      const duration = options.duration ?? DURATIONS[type];
      setToasts((list) => [...list.slice(-4), { id, type, message, title: options.title }]);
      schedule(id, duration);
      return id;
    },
    [schedule]
  );

  /** Remplace un toast existant — c'est ce qui fait la transition « en cours » → « fait ». */
  const update = useCallback(
    (id, type, message, options = {}) => {
      const duration = options.duration ?? DURATIONS[type];
      setToasts((list) =>
        list.map((item) =>
          item.id === id ? { ...item, type, message, title: options.title } : item
        )
      );
      schedule(id, duration);
    },
    [schedule]
  );

  const toast = useMemo(() => {
    const api = {
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      info: (message, options) => push('info', message, options),
      loading: (message, options) => push('loading', message, options),
      dismiss,

      /**
       * Suit une promesse du début à la fin sur un seul toast.
       * `success` et `error` peuvent être des fonctions du résultat/de l'erreur.
       */
      async promise(promise, { loading, success, error }) {
        const id = push('loading', loading);
        try {
          const value = await promise;
          update(id, 'success', typeof success === 'function' ? success(value) : success);
          return value;
        } catch (err) {
          update(id, 'error', typeof error === 'function' ? error(err) : error || err.message);
          throw err;
        }
      },
    };
    return api;
  }, [push, update, dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.type}${item.leaving ? ' is-leaving' : ''}`}
            role={item.type === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-icon">{ICONS[item.type]}</span>
            <div className="toast-body">
              {item.title && <strong className="toast-title">{item.title}</strong>}
              <span className="toast-msg">{item.message}</span>
            </div>
            {item.type !== 'loading' && (
              <button className="toast-close" onClick={() => dismiss(item.id)} aria-label="Fermer">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast doit être utilisé dans un <ToastProvider>.');
  return toast;
}
