"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createContext, useCallback, useContext, useState } from "react";

import { IconAlert, IconCheck } from "@/components/icons";

type Toast = { id: number; message: string; tone: "good" | "bad" };

const ToastContext = createContext<{
  push: (message: string, tone?: Toast["tone"]) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const reduce = useReducedMotion();

  const push = useCallback((message: string, tone: Toast["tone"] = "good") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              layout={!reduce}
              key={t.id}
              className={`toast toast--${t.tone}`}
              initial={reduce ? false : { opacity: 0, y: 30, scale: 0.95 }}
              animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
              exit={
                reduce
                  ? undefined
                  : { opacity: 0, y: 15, scale: 0.92, transition: { duration: 0.2 } }
              }
              transition={{ type: "spring", stiffness: 450, damping: 32 }}
            >
              {t.tone === "good" ? <IconCheck /> : <IconAlert />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
