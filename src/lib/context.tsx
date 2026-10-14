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
export const useApp = () => useContext(AppContext)!;
