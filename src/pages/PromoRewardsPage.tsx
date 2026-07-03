import React, { useState, useEffect } from "react";
import { 
  Gift, CheckCircle, Clock, ShieldCheck, 
  ArrowRight, Lock, 
  AlertCircle, Info, Users,
  Zap, Trophy, Smartphone, 
  MessageCircle, Sparkles, LayoutGrid,
  Loader2, RefreshCw, Download
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import confetti from "canvas-confetti";
import { useTelegramUser } from "../hooks/useTelegramUser";

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
  // Authentication & Profile Hook
  const { user, loading: authLoading, isAuthenticated } = useTelegramUser();

  // Flow Management
  type FlowStep = "MOBILE" | "OTP" | "VERIFIED" | "PROMO" | "CLAIM" | "SUCCESS";
  const [currentStep, setCurrentStep] = useState<FlowStep>("MOBILE");

  const [loadedPromo, setLoadedPromo] = useState<PromoDetails | null>(null);
  const [promoDetailsLoading, setPromoDetailsLoading] = useState<boolean>(true);
  const [settings, setSettings] = useState<PromoSettings | null>(null);
  const [promoErrorStatus, setPromoErrorStatus] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Verification States
  const [mobileInput, setMobileInput] = useState<string>("");
  const [otpInput, setOtpInput] = useState<string>("");
  const [submittingAuth, setSubmittingAuth] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState<number>(0);
  
  const [promoCodeInput, setPromoCodeInput] = useState<string>("");
  const [verifyingPromo, setVerifyingPromo] = useState<boolean>(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const [claimLoading, setClaimLoading] = useState<boolean>(false);
  const [rewardAmount, setRewardAmount] = useState<number>(0);
  const [claimId, setClaimId] = useState<string>("");
  const [claimTime, setClaimTime] = useState<string>("");
  const [walletBalance, setWalletBalance] = useState<number>(0);

  // Sync step with auth status
  useEffect(() => {
    if (isAuthenticated) {
      if (currentStep === "MOBILE" || currentStep === "OTP" || currentStep === "VERIFIED") {
        setCurrentStep("PROMO");
      }
    }
  }, [isAuthenticated, currentStep]);

  // Initialization
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.expand();
      tg.ready();
    }
  }, []);

  const fetchPromoDetails = async () => {
    setPromoDetailsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/promo/details/${promoId}`);
      const data = await res.json();
      if (data.success && data.promo) {
        setLoadedPromo(data.promo);
      } else {
        setPromoErrorStatus("not_found");
      }
    } catch (err) {
      setApiError("Failed to load promo details.");
    } finally {
      setPromoDetailsLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData || "";
      const res = await fetch(`${API_BASE}/api/promo/status?promoId=${promoId}&initData=${encodeURIComponent(initData)}`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
      }
    } catch (err) {
      console.error("Settings fetch failed", err);
    }
  };

  useEffect(() => {
    if (promoId) {
      fetchPromoDetails();
      fetchSettings();
    }
  }, [promoId]);

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => setResendTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobileInput.trim() || submittingAuth) return;
    setSubmittingAuth(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          mobile: mobileInput.trim(), 
          fingerprint: Math.abs(Date.now()).toString(16) 
        })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentStep("OTP");
        setResendTimer(60);
      } else {
        setAuthError(data.error || "Failed to send OTP.");
      }
    } catch (err) {
      setAuthError("Network error.");
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.length !== 4 || submittingAuth) return;
    setSubmittingAuth(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          mobile: mobileInput.trim(), 
          otp: otpInput, 
          fingerprint: Math.abs(Date.now()).toString(16) 
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.sessionToken) localStorage.setItem("rs_session_token", data.sessionToken);
        setCurrentStep("VERIFIED");
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        // Refresh to let the hook pick up the new session
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setAuthError(data.error || "Invalid code.");
      }
    } catch (err) {
      setAuthError("Network error.");
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleVerifyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCodeInput.trim() || verifyingPromo) return;
    setVerifyingPromo(true);
    setPromoError(null);
    try {
      const tg = (window as any).Telegram?.WebApp;
      const res = await fetch(`${API_BASE}/api/promo/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          promoCode: promoCodeInput.trim(), 
          userId: user?.telegramId,
          promoId: promoId,
          initData: tg?.initData || ""
        })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentStep("CLAIM");
      } else {
        setPromoError(data.error || "Invalid promo code.");
      }
    } catch (err) {
      setPromoError("Network error.");
    } finally {
      setVerifyingPromo(false);
    }
  };

  const launchAdAndClaim = async () => {
    if (claimLoading) return;
    setClaimLoading(true);

    const performClaim = async () => {
      try {
        const tg = (window as any).Telegram?.WebApp;
        const res = await fetch(`${API_BASE}/api/promo/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            promoCode: promoCodeInput.trim(), 
            userId: user?.telegramId,
            randomPageId: promoId,
            initData: tg?.initData || "",
            fingerprint: Math.abs(Date.now()).toString(16)
          })
        });
        const data = await res.json();
        if (data.success) {
          setRewardAmount(data.rewardAmount);
          setClaimId(data.claimId);
          setClaimTime(data.time || new Date().toLocaleString());
          setWalletBalance(data.newBalance || 0);
          setCurrentStep("SUCCESS");
          confetti({ particleCount: 200, spread: 90 });
        } else {
          setPromoError(data.error || "Claim failed.");
        }
      } catch (err) {
        setPromoError("Server error.");
      } finally {
        setClaimLoading(false);
      }
    };

    const zoneId = "11210088";
    const showAd = (window as any)[`show_${zoneId}`];
    if (showAd) {
      showAd().then(performClaim).catch(() => {
        setPromoError("Ad verification failed. Watch full ad to claim.");
        setClaimLoading(false);
      });
    } else {
      performClaim();
    }
  };

  if (promoDetailsLoading || authLoading) return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500 w-12 h-12" /></div>;
  if (promoErrorStatus === "not_found") return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6 text-center"><h2 className="text-2xl font-bold">Promo Not Found</h2></div>;

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white font-sans selection:bg-indigo-500/30">
      <div className="max-w-md mx-auto min-h-screen flex flex-col p-6">
        
        <header className="flex items-center gap-3 py-6">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black">ROYSHARE</h1>
            <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold">REWARDS</span>
          </div>
        </header>

        <main className="flex-grow flex flex-col justify-center py-8">
          <AnimatePresence mode="wait">
            {currentStep === "MOBILE" && (
              <motion.div key="mobile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">
                <div className="space-y-2">
                  <h2 className="text-4xl font-black">Verification</h2>
                  <p className="text-zinc-400 text-lg">Enter your number to continue.</p>
                </div>
                <form onSubmit={handleSendOTP} className="space-y-6">
                  <div className="relative">
                    <Smartphone className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500 w-6 h-6" />
                    <input
                      type="tel"
                      placeholder="Mobile Number"
                      value={mobileInput}
                      onChange={(e) => setMobileInput(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-2xl py-5 pl-14 text-xl font-bold focus:border-indigo-500 outline-none transition-all"
                    />
                  </div>
                  {authError && <p className="text-red-400 text-sm font-medium bg-red-500/10 p-3 rounded-lg border border-red-500/20">{authError}</p>}
                  <button type="submit" disabled={submittingAuth || mobileInput.length < 10} className="w-full bg-indigo-600 py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3 active:scale-[0.98] transition-transform">
                    {submittingAuth ? <Loader2 className="animate-spin" /> : <>SEND OTP CODE <ArrowRight className="w-5 h-5" /></>}
                  </button>
                </form>
              </motion.div>
            )}

            {currentStep === "OTP" && (
              <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-8">
                <div className="space-y-2">
                  <h2 className="text-4xl font-black">Enter Code</h2>
                  <p className="text-zinc-400 text-lg">Code sent to your Telegram bot.</p>
                </div>
                <form onSubmit={handleVerifyOTP} className="space-y-6">
                  <input
                    type="text"
                    placeholder="0000"
                    maxLength={4}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-2xl py-6 text-center text-5xl font-black tracking-[0.4em] focus:border-indigo-500 outline-none transition-all"
                  />
                  {authError && <p className="text-red-400 text-sm font-medium">{authError}</p>}
                  <button type="submit" disabled={submittingAuth || otpInput.length !== 4} className="w-full bg-indigo-600 py-5 rounded-2xl font-black text-lg">VERIFY CODE</button>
                  <button type="button" onClick={() => setCurrentStep("MOBILE")} className="w-full text-zinc-500 font-bold hover:text-white transition-colors">Change Number</button>
                </form>
              </motion.div>
            )}

            {currentStep === "VERIFIED" && (
              <motion.div key="verified" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8 text-center">
                <div className="w-24 h-24 bg-green-500 rounded-full mx-auto flex items-center justify-center shadow-xl shadow-green-500/20">
                  <CheckCircle className="w-12 h-12 text-white" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-black">Verified!</h2>
                  <p className="text-zinc-400">Account identity confirmed.</p>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-4 text-left">
                  <div className="flex justify-between items-center"><span className="text-zinc-500 text-xs font-bold uppercase">User</span><span className="font-bold">{user?.username}</span></div>
                  <div className="flex justify-between items-center"><span className="text-zinc-500 text-xs font-bold uppercase">ID</span><span className="font-mono text-indigo-400">{user?.telegramId}</span></div>
                </div>
                <button onClick={() => setCurrentStep("PROMO")} className="w-full bg-white text-black py-5 rounded-2xl font-black text-lg flex items-center justify-center gap-3">CONTINUE <ArrowRight /></button>
              </motion.div>
            )}

            {currentStep === "PROMO" && (
              <motion.div key="promo" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <div className="text-center space-y-4">
                  <h2 className="text-4xl font-black">Enter Promo</h2>
                  <p className="text-zinc-400 text-lg">Enter the code to unlock your reward.</p>
                </div>
                <form onSubmit={handleVerifyPromo} className="space-y-6">
                  <input
                    type="text"
                    placeholder="PROMO CODE"
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                    className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-2xl py-6 text-center text-2xl font-black tracking-widest outline-none focus:border-indigo-500"
                  />
                  {promoError && <p className="text-red-400 text-sm font-medium">{promoError}</p>}
                  <button type="submit" disabled={verifyingPromo || !promoCodeInput} className="w-full bg-indigo-600 py-5 rounded-2xl font-black text-lg">
                    {verifyingPromo ? <Loader2 className="animate-spin mx-auto" /> : "VERIFY CODE"}
                  </button>
                </form>
              </motion.div>
            )}

            {currentStep === "CLAIM" && (
              <motion.div key="claim" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-10 text-center">
                <div className="space-y-4">
                  <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl mx-auto flex items-center justify-center border border-indigo-500/20"><Zap className="w-10 h-10 text-indigo-400" /></div>
                  <h2 className="text-4xl font-black">Ready to Claim!</h2>
                  <p className="text-zinc-400">Watch a short ad to receive your reward.</p>
                </div>
                <div className="bg-indigo-900/40 p-8 rounded-[40px] border border-indigo-500/20 shadow-2xl shadow-indigo-500/10">
                  <span className="text-indigo-400 uppercase text-xs font-black tracking-widest">Reward Amount</span>
                  <div className="text-6xl font-black mt-2">₹{loadedPromo?.rewardAmount}</div>
                </div>
                <button onClick={launchAdAndClaim} disabled={claimLoading} className="w-full bg-white text-black py-6 rounded-3xl font-black text-xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3">
                  {claimLoading ? <Loader2 className="animate-spin" /> : <>WATCH AD & CLAIM <Sparkles className="w-6 h-6 text-indigo-600" /></>}
                </button>
              </motion.div>
            )}

            {currentStep === "SUCCESS" && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8 text-center">
                <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center shadow-xl shadow-green-500/20"><CheckCircle className="w-10 h-10 text-white" /></div>
                <h2 className="text-4xl font-black">Claimed!</h2>
                <div className="bg-zinc-900 p-8 rounded-3xl text-left space-y-5 border border-zinc-800">
                  <div className="flex justify-between items-center"><span className="text-zinc-500 text-xs font-bold uppercase">Amount</span><span className="text-green-500 font-black text-xl">+ ₹{rewardAmount}</span></div>
                  <div className="flex justify-between items-center"><span className="text-zinc-500 text-xs font-bold uppercase">New Balance</span><span className="font-black text-xl">₹{walletBalance}</span></div>
                  <div className="pt-4 border-t border-zinc-800 flex justify-between items-center"><span className="text-zinc-500 text-xs font-bold uppercase">Claim ID</span><span className="text-xs font-mono text-zinc-400">{claimId}</span></div>
                </div>
                <button onClick={() => window.location.href = "https://t.me/RoyShare_Bot"} className="w-full bg-indigo-600 py-5 rounded-2xl font-black text-lg">RETURN TO BOT</button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="py-10 text-center opacity-30">
          <p className="text-[10px] font-black tracking-[0.2em]">POWERED BY ROYSHARE REWARDS</p>
        </footer>
      </div>
    </div>
  );
};

export default PromoRewardsPage;
