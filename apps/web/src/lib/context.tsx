import { createContext, useContext } from "react";
import type { Challenge, Session } from "./contracts";

export interface AppState {
  session: Session | null;
  setSession: (session: Session | null) => void;
  challenges: Challenge[];
  busy: boolean;
  transact: <T>(action: () => Promise<T>) => Promise<T>;
  toast: (message: string) => void;
}
export const AppContext = createContext<AppState | null>(null);
export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppContext.Provider.");
  return context;
}
