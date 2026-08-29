import { createContext, useContext, useCallback, useState } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((texto, tipo = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, texto, tipo }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3500);
  }, []);

  const toast = {
    ok: (t) => push(t, 'ok'),
    error: (t) => push(t, 'error'),
    info: (t) => push(t, 'info'),
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts">
        {items.map((i) => (
          <div key={i.id} className={`toast toast-${i.tipo}`}>{i.texto}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
