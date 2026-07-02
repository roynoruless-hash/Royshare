import React, { useState, useEffect } from "react";
import { 
  Gift, CheckCircle, Clock, ShieldCheck, 
  ArrowRight, Lock, 
  AlertCircle, Info, Users,
  Zap, Trophy, Smartphone, 
  MessageCircle, Sparkles, LayoutGrid,
  Loader2, RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import confetti from "canvas-confetti";

const API_BASE = "";

interface PromoSettings {
  name: string;
  promoCode: string;
  rewardAmount: number;
  totalBudget: number;
  maxUsers: number;
  expiryMinutes: number;
  enabled: boolean;
  tgChannelEnabled: boolean;
  tgGroupEnabled: boolean;
  expiryEnabled: boolean;
  requireAccessCode: boolean;
}

interface PromoDetails {
  name: string;
  rewardAmount: number;
  totalBudget: number;
  budgetUsed: number;
  maxUsers: number;
  usedCount: number;
  startDate: string;
  startTime: string;
  expiryDate: string;
  expiryTime: string;
  enabled: boolean;
  requireAccessCode: boolean;
  pageId: string;
  status?: string;
  autoPostChannel?: boolean;
  autoPostGroup?: boolean;
}

interface PromoRewardsPageProps {
  promoId?: string;
}

const PromoRewardsPage: React.FC<PromoRewardsPageProps> = ({ promoId }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [telegramId, setTelegramId] = useState<string>("");
  const [settings, setSettings] = useState<PromoSettings | null>(null);
  const [loadedPromo, setLoadedPromo] = useState<PromoDetails | null>(null);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [sessionExpiry, setSessionExpiry] = useState<string | null>(null);
  const [timeLeftStr, setTimeLeftStr] = useState<string>("");
  const [isExpired, setIsExpired] = useState<boolean>(false);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [promoDetailsLoading, setPromoDetailsLoading] = useState<boolean>(true);
  const [promoErrorStatus, setPromoErrorStatus] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const [accessCodeInput, setAccessCodeInput] = useState<string>("");
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [showUnlockSuccess, setShowUnlockSuccess] = useState<boolean>(false);

  const [redeeming, setRedeeming] = useState<boolean>(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<boolean>(false);
  const [rewardAmount, setRewardAmount] = useState<number>(0);
  
  const [claimHistory, setClaimHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Initialize URL user parameters and load settings
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("userId");
    
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.expand();
      tg.ready();
      // Apply Telegram Theme Colors
      if (tg.setHeaderColor) tg.setHeaderColor('#1c1c1c');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0f0f0f');
    }

    const tgUserId = tg?.initDataUnsafe?.user?.id;
    const resolvedId = queryUserId || (tgUserId ? String(tgUserId) : null);

    if (resolvedId) {
      setUserId(resolvedId);
    } else {
      setLoading(false);
    }
  }, []);

  // Fetch Promo Details if promoId is provided from route
  useEffect(() => {
    if (!promoId) {
      setPromoErrorStatus("not_found");
      setPromoDetailsLoading(false);
      return;
    }

    const fetchPromoDetails = async () => {
      setPromoDetailsLoading(true);
      setPromoErrorStatus(null);
      setApiError(null);
      
      // Safety timeout to prevent infinite loading
      const timeoutId = setTimeout(() => {
        setPromoDetailsLoading(false);
        setApiError("Request timed out. Please try again.");
      }, 10000);

      try {
        const res = await fetch(`${API_BASE}/api/promo/details/${promoId}`);
        clearTimeout(timeoutId);

        if (res.status === 404) {
          setPromoErrorStatus("not_found");
          return;
        }
        
        if (!res.ok) {
          throw new Error(`Server returned status ${res.status}`);
        }

        const data = await res.json();
        if (data.success && data.promo) {
          setLoadedPromo(data.promo);
          if (data.promo.status && data.promo.status !== "active") {
            setPromoErrorStatus(data.promo.status);
          }
        } else {
          setPromoErrorStatus("not_found");
        }
      } catch (err: any) {
        console.error("Fetch Promo Details Error:", err);
        setApiError(err.message || "Failed to load promo rewards details.");
      } finally {
        setPromoDetailsLoading(false);
        clearTimeout(timeoutId);
      }
    };

    fetchPromoDetails();
  }, [promoId]);

  const fetchStatusAndSettings = async () => {
    if (!userId) return;
    setLoading(true);
    setApiError(null);

    const timeoutId = setTimeout(() => {
      setLoading(false);
      if (!loadedPromo) setApiError("Connection timed out.");
    }, 12000);

    try {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData || "";
      
      const res = await fetch(`${API_BASE}/api/promo/status?userId=${userId}&promoId=${promoId}&initData=${encodeURIComponent(initData)}`);
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `API returned HTTP status ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setUsername(data.user?.name || data.user?.username || "User");
        setTelegramId(data.user?.telegramId || "");
        
        if (data.unlocked) {
          setIsUnlocked(true);
          if (data.session) {
            setSessionExpiry(data.session.expiresAt);
          }
        } else {
          setIsUnlocked(false);
        }
      } else {
        throw new Error(data.error || "Failed to load status");
      }
    } catch (err: any) {
      console.error("API Error (fetchStatusAndSettings):", err);
      // Only set error if we don't have promo details yet
      if (!loadedPromo) {
        setApiError(err.message || "Failed to load promo rewards status.");
      }
    } finally {
      setLoading(false);
      clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    if (userId) {
      fetchStatusAndSettings();
    }
  }, [userId]);

  // Load claims history
  const fetchClaimHistory = async () => {
    if (!userId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/promo/claims?userId=${userId}`);
      const data = await res.json();
      if (data.success) {
        setClaimHistory(data.claims || []);
      }
    } catch (err) {
      console.error("Error fetching claim history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (isUnlocked && userId) {
      fetchClaimHistory();
    }
  }, [isUnlocked, userId]);

  // Ticking Countdown timer
  useEffect(() => {
    if (!isUnlocked || !sessionExpiry || !settings?.expiryEnabled) {
      return;
    }

    const interval = setInterval(() => {
      const targetTime = new Date(sessionExpiry).getTime();
      const now = new Date().getTime();
      const diff = targetTime - now;

      if (diff <= 0) {
        clearInterval(interval);
        setTimeLeftStr("00:00:00");
        setIsExpired(true);
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        const hStr = hours.toString().padStart(2, '0');
        const mStr = minutes.toString().padStart(2, '0');
        const sStr = seconds.toString().padStart(2, '0');
        setTimeLeftStr(`${hStr}:${mStr}:${sStr}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isUnlocked, sessionExpiry, settings]);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCodeInput.trim() || !userId || unlocking) return;

    setUnlocking(true);
    setUnlockError(null);

    try {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData || "";

      const res = await fetch(`${API_BASE}/api/promo/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accessCode: accessCodeInput.trim(), promoId, initData })
      });
      const data = await res.json();

      if (data.success) {
        setShowUnlockSuccess(true);
        setSessionExpiry(data.expiresAt);
        setTimeout(() => {
          setIsUnlocked(true);
          setAccessCodeInput("");
          setShowUnlockSuccess(false);
          fetchStatusAndSettings();
        }, 1500);
      } else {
        setUnlockError(data.error || "Invalid Access Code. Please try again.");
      }
    } catch (err) {
      console.error("Unlock error:", err);
      setUnlockError("Network error. Please try again later.");
    } finally {
      setUnlocking(false);
    }
  };

  const handleRedeemSubmit = async () => {
    if (!userId || redeeming || isExpired) return;

    setRedeeming(true);
    setRedeemError(null);

    try {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData || "";

      const res = await fetch(`${API_BASE}/api/promo/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId, 
          randomPageId: promoId,
          initData,
          accessCode: "session" 
        })
      });
      const data = await res.json();

      if (data.success) {
        setRewardAmount(data.rewardAmount);
        setRedeemSuccess(true);
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#22c55e', '#3b82f6', '#f59e0b']
        });
        fetchClaimHistory();
      } else {
        setRedeemError(data.error || "Claim failed. Please check rules.");
      }
    } catch (err) {
      console.error("Redeem error:", err);
      setRedeemError("Network error. Please try again.");
    } finally {
      setRedeeming(false);
    }
  };

  const LoadingSpinner = () => (
    <div className="flex flex-col items-center justify-center p-12 space-y-4">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="w-12 h-12 text-blue-500" />
      </motion.div>
      <p className="text-gray-400 font-medium animate-pulse">Initializing campaign...</p>
    </div>
  );

  const ErrorView = ({ message, type = "error" }: { message: string, type?: "error" | "not_found" | "expired" }) => (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl text-center space-y-6 max-w-md mx-auto"
    >
      <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center ${
        type === "not_found" ? "bg-orange-500/20 text-orange-500" : "bg-red-500/20 text-red-500"
      }`}>
        {type === "not_found" ? <LayoutGrid className="w-10 h-10" /> : <AlertCircle className="w-10 h-10" />}
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">
          {type === "not_found" ? "Promo Not Found" : "Something Went Wrong"}
        </h2>
        <p className="text-gray-400 leading-relaxed">{message}</p>
      </div>
      <button 
        onClick={() => window.location.reload()}
        className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-4 rounded-2xl transition-all flex items-center justify-center gap-2"
      >
        <RefreshCw className="w-5 h-5" />
        Try Again
      </button>
    </motion.div>
  );

  if (promoDetailsLoading) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <LoadingSpinner />
      </div>
    );
  }

  if (promoErrorStatus === "not_found") {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <ErrorView type="not_found" message="This promo link is invalid or has been removed." />
      </div>
    );
  }

  if (promoErrorStatus === "expired" || promoErrorStatus === "budget_finished" || promoErrorStatus === "claim_limit_reached") {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <ErrorView 
          type="expired" 
          message={
            promoErrorStatus === "expired" 
              ? "Sorry, this promo campaign has officially ended." 
              : promoErrorStatus === "budget_finished" 
                ? "Campaign concluded: The allocated reward budget has been fully claimed."
                : "Campaign concluded: All available reward slots have been filled."
          } 
        />
      </div>
    );
  }

  if (promoErrorStatus === "disabled") {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <ErrorView message="This promo is currently disabled by the administrator." />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <ErrorView message="Telegram authentication failed. Please open this app inside Telegram." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white font-sans selection:bg-blue-500/30">
      <div className="max-w-md mx-auto min-h-screen flex flex-col p-4 md:p-6">
        
        <header className="flex items-center justify-between py-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Gift className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none">Promo Rewards</h1>
              <span className="text-xs text-gray-500">Official Mini App</span>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800">
            <ShieldCheck className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-300">Secure</span>
          </div>
        </header>

        <main className="flex-grow space-y-6">
          
          <AnimatePresence mode="wait">
            {!isUnlocked ? (
              <motion.div
                key="locked"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="space-y-6"
              >
                <div className="bg-zinc-900 rounded-[32px] p-8 border border-zinc-800 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[60px] -mr-16 -mt-16 rounded-full" />
                  
                  <div className="relative text-center space-y-6">
                    <div className="w-20 h-20 mx-auto bg-zinc-800 rounded-[24px] flex items-center justify-center border border-zinc-700 shadow-inner">
                      <Lock className="w-10 h-10 text-blue-400" />
                    </div>
                    
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold">Access Protected</h2>
                      <p className="text-gray-400 text-sm">Enter the code from the Telegram post to unlock this reward.</p>
                    </div>

                    <form onSubmit={handleUnlockSubmit} className="space-y-4">
                      <div className="relative group">
                        <input
                          type="text"
                          placeholder="Enter Access Code"
                          value={accessCodeInput}
                          onChange={(e) => setAccessCodeInput(e.target.value.toUpperCase())}
                          className="w-full bg-black border border-zinc-800 rounded-2xl py-4 px-6 text-center text-xl font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all group-hover:border-zinc-700"
                        />
                      </div>
                      
                      {unlockError && (
                        <motion.p 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-red-400 text-sm font-medium bg-red-400/10 py-2 rounded-lg"
                        >
                          {unlockError}
                        </motion.p>
                      )}

                      <button
                        type="submit"
                        disabled={unlocking || !accessCodeInput.trim()}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                      >
                        {unlocking ? <Loader2 className="w-5 h-5 animate-spin" /> : "Unlock Now"}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="bg-zinc-900/40 rounded-2xl p-4 border border-zinc-800 flex items-start gap-3">
                  <Info className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Access codes are unique to each campaign and can be found in the description of our official Telegram posts.
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="unlocked"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 pb-20"
              >
                <div className="bg-zinc-900 rounded-[32px] overflow-hidden border border-zinc-800 shadow-2xl relative">
                  <div className="bg-gradient-to-br from-blue-600/20 via-blue-900/20 to-zinc-900 p-8 border-b border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-blue-500/20 text-blue-400 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        LIVE CAMPAIGN
                      </div>
                      {settings?.expiryEnabled && (
                        <div className="flex items-center gap-2 text-orange-400 font-mono text-sm bg-orange-400/10 px-3 py-1 rounded-full border border-orange-400/20">
                          <Clock className="w-4 h-4" />
                          {timeLeftStr}
                        </div>
                      )}
                    </div>
                    <h2 className="text-3xl font-extrabold text-white mb-2">{loadedPromo?.name || "Active Reward"}</h2>
                    <p className="text-gray-400 text-sm">Follow the rules below to claim your reward instantly.</p>
                  </div>

                  <div className="p-8 space-y-8">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-black/40 p-4 rounded-2xl border border-zinc-800/50 space-y-1">
                        <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">REWARD AMOUNT</span>
                        <div className="text-2xl font-black text-green-500">₹{loadedPromo?.rewardAmount}</div>
                      </div>
                      <div className="bg-black/40 p-4 rounded-2xl border border-zinc-800/50 space-y-1">
                        <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">AVAILABLE SLOTS</span>
                        <div className="text-2xl font-black text-white">
                          {loadedPromo?.maxUsers ? `${Math.max(0, loadedPromo.maxUsers - loadedPromo.usedCount)}` : "∞"}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-xs font-bold text-zinc-500 tracking-widest uppercase">CAMPAIGN RULES</h3>
                      <div className="space-y-3">
                        {settings?.tgChannelEnabled && (
                          <div className="flex items-center gap-4 bg-zinc-800/50 p-4 rounded-2xl border border-zinc-700/30">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                              <MessageCircle className="w-5 h-5" />
                            </div>
                            <div className="flex-grow">
                              <div className="text-sm font-bold">Join Official Channel</div>
                              <div className="text-[10px] text-zinc-500 font-medium">MUST BE A MEMBER</div>
                            </div>
                            <div className="text-green-500"><CheckCircle className="w-5 h-5" /></div>
                          </div>
                        )}
                        <div className="flex items-center gap-4 bg-zinc-800/50 p-4 rounded-2xl border border-zinc-700/30">
                          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20">
                            <Users className="w-5 h-5" />
                          </div>
                          <div className="flex-grow">
                            <div className="text-sm font-bold">One Claim per ID</div>
                            <div className="text-[10px] text-zinc-500 font-medium">ANTI-SPAM ACTIVE</div>
                          </div>
                          <div className="text-green-500"><CheckCircle className="w-5 h-5" /></div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {redeemError && (
                        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                          <p className="text-sm text-red-400 font-medium">{redeemError}</p>
                        </div>
                      )}

                      {!redeemSuccess ? (
                        <button
                          onClick={handleRedeemSubmit}
                          disabled={redeeming || isExpired}
                          className={`w-full group relative py-5 rounded-2xl font-black text-lg transition-all overflow-hidden ${
                            isExpired 
                              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                              : "bg-white text-black hover:bg-zinc-100 active:scale-[0.97]"
                          }`}
                        >
                          <div className="relative z-10 flex items-center justify-center gap-3">
                            {redeeming ? (
                              <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                              <>
                                <Zap className={`w-6 h-6 ${isExpired ? 'text-zinc-500' : 'text-blue-600'}`} />
                                {isExpired ? "CAMPAIGN EXPIRED" : "CLAIM REWARD NOW"}
                                <ArrowRight className="w-5 h-5 opacity-50 group-hover:translate-x-1 transition-transform" />
                              </>
                            )}
                          </div>
                        </button>
                      ) : (
                        <motion.div 
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="bg-green-500/10 border border-green-500/20 p-6 rounded-[24px] text-center space-y-4"
                        >
                          <div className="w-16 h-16 mx-auto bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30">
                            <CheckCircle className="w-10 h-10 text-white" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="text-xl font-bold text-white">Reward Claimed!</h3>
                            <p className="text-green-400 font-medium">₹{rewardAmount} has been added to your balance.</p>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-zinc-500 tracking-widest uppercase">YOUR RECENT CLAIMS</h3>
                    <button 
                      onClick={fetchClaimHistory}
                      className="text-blue-500 text-xs font-bold hover:underline"
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="space-y-3">
                    {historyLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 text-zinc-700 animate-spin" />
                      </div>
                    ) : claimHistory.length > 0 ? (
                      claimHistory.map((claim, idx) => (
                        <motion.div 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          key={idx}
                          className="bg-zinc-900/60 p-4 rounded-2xl border border-zinc-800/50 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500">
                              <Trophy className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="text-sm font-bold">{claim.promoName}</div>
                              <div className="text-[10px] text-zinc-500">{claim.date} at {claim.time}</div>
                            </div>
                          </div>
                          <div className="text-green-500 font-black text-sm">+₹{claim.rewardAmount}</div>
                        </motion.div>
                      ))
                    ) : (
                      <div className="text-center py-12 bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-800">
                        <p className="text-zinc-600 text-sm">No recent claims found.</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </main>

        <footer className="py-8 text-center space-y-4">
          <div className="flex items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-1 opacity-40">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-[8px] font-bold uppercase tracking-tighter">Verified</span>
            </div>
            <div className="flex flex-col items-center gap-1 opacity-40">
              <Smartphone className="w-5 h-5" />
              <span className="text-[8px] font-bold uppercase tracking-tighter">Mini App</span>
            </div>
            <div className="flex flex-col items-center gap-1 opacity-40">
              <Zap className="w-5 h-5" />
              <span className="text-[8px] font-bold uppercase tracking-tighter">Instant</span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 font-medium">
            Powered by Telegram Reward Engine v3.0 • Secure claim verified by Telegram Identity
          </p>
        </footer>

      </div>

      <AnimatePresence>
        {showUnlockSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 p-10 rounded-[40px] text-center space-y-6 shadow-2xl"
            >
              <div className="w-24 h-24 mx-auto bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/40">
                <ShieldCheck className="w-12 h-12 text-white" />
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-black text-white">Unlocked!</h3>
                <p className="text-gray-400 font-medium">Access granted. Redirecting to reward...</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PromoRewardsPage;
