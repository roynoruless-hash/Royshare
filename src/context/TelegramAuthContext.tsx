import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User, TelegramAuthResponse } from "../types";
import { API_BASE } from "../config/api";

interface TelegramAuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  verifyAuth: () => Promise<void>;
  completeProfile: (details: Partial<User>) => Promise<void>;
}

const TelegramAuthContext = createContext<TelegramAuthContextType | undefined>(undefined);

export const TelegramAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const verifyAuth = async () => {
    const tg = (window as any).Telegram?.WebApp;
    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("userId");
    
    // If no Telegram object AND no queryUserId in query param, we are not in a Mini App context
    if (!tg && !queryUserId) {
      setLoading(false);
      return;
    }

    const initData = tg?.initData;

    // Fallback: If we have queryUserId but no initData, use the direct user retrieval API
    if (!initData && queryUserId) {
      setLoading(true);
      setError(null);
      try {
        if (tg) {
          tg.ready();
          tg.expand();
        }
        const response = await fetch(`${API_BASE}/api/user/profile/${queryUserId}`);
        const data = await response.json();
        if (data.success && data.user) {
          setUser(data.user);
        } else {
          throw new Error(data.error || "User not found in database");
        }
      } catch (err: any) {
        console.error("[TelegramAuthContext] Fallback auth error:", err);
        setError(err.message || "Failed to load user profile");
      } finally {
        setLoading(false);
      }
      return;
    }

    // If no initData and no queryUserId, skipping verification
    if (!initData) {
      console.log("[TelegramAuthContext] No initData found, skipping verification");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      tg.ready();
      tg.expand();

      const response = await fetch(`${API_BASE}/api/auth/telegram-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });

      const data: TelegramAuthResponse = await response.json();

      if (data.success && data.user) {
        setUser(data.user);
      } else {
        throw new Error(data.error || "Authentication failed");
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message || "Failed to authenticate with Telegram");
    } finally {
      setLoading(false);
    }
  };

  const completeProfile = async (details: Partial<User>) => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/user/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, details }),
      });

      const data = await response.json();
      if (data.success && data.user) {
        setUser(data.user);
      } else {
        throw new Error(data.error || "Failed to complete profile");
      }
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    verifyAuth();
  }, []);

  return (
    <TelegramAuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated: !!user,
        verifyAuth,
        completeProfile,
      }}
    >
      {children}
    </TelegramAuthContext.Provider>
  );
};

export const useTelegramAuth = () => {
  const context = useContext(TelegramAuthContext);
  if (context === undefined) {
    throw new Error("useTelegramAuth must be used within a TelegramAuthProvider");
  }
  return context;
};
