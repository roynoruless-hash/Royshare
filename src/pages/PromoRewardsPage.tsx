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
  // Flow Management
  type FlowStep = "MOBILE" | "OTP" | "VERIFIED" | "PROMO" | "CLAIM" | "SUCCESS";
  const [currentStep, setCurrentStep] = useState<FlowStep>("MOBILE");

  const [userId, setUserId] = useState<string | null>(null);
  const [loadedPromo, setLoadedPromo] = useState<PromoDetails | null>(null);
  const [promoDetailsLoading, setPromoDetailsLoading] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [settings, setSettings] = useState<PromoSettings | null>(null);
  const [promoErrorStatus, setPromoErrorStatus] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Verification States
  const [mobileInput, setMobileInput] = useState<string>("");
  const [otpInput, setOtpInput] = useState<string>("");
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedUser, setVerifiedUser] = useState<any>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(localStorage.getItem("rs_session_token"));
  const [resendTimer, setResendTimer] = useState<number>(0);
  
  const [promoCodeInput, setPromoCodeInput] = useState<string>("");
  const [verifyingPromo, setVerifyingPromo] = useState<boolean>(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const [claimLoading, setClaimLoading] = useState<boolean>(false);
  const [rewardAmount, setRewardAmount] = useState<number>(0);
  const [claimId, setClaimId] = useState<string>("");
  const [claimTime, setClaimTime] = useState<string>("");
  const [walletBalance, setWalletBalance] = useState<number>(0);

  // Device Fingerprint
  const getFingerprint = () => {
    const data = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset()
    ].join("|");
    // Simple hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  };

  const [fingerprint] = useState<string>(getFingerprint());

  // ... (Initialization and Fetching)
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.expand();
      tg.ready();
      if (tg.setHeaderColor) tg.setHeaderColor('#1c1c1c');
      if (tg.setBackgroundColor) tg.setBackgroundColor('#0f0f0f');
    }
  }, []);

  const fetchPromoDetails = async () => {
    setPromoDetailsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/promo/details/${promoId}`);
      if (res.status === 404) {
        setPromoErrorStatus("not_found");
        return;
      }
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

  const checkSession = async () => {
    const token = localStorage.getItem("rs_session_token");
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/check-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, fingerprint })
        });
        const data = await res.json();
        if (data.success && data.user) {
          setVerifiedUser(data.user);
          setUserId(String(data.user.telegramId));
          setCurrentStep("PROMO");
        } else {
          if (data.newDevice) {
            setAuthError("⚠ New Device Detected. Please verify again.");
          }
          localStorage.removeItem("rs_session_token");
        }
      } catch (err) {
        console.error("Session check failed", err);
      }
    }
  };

  useEffect(() => {
    if (!promoId) {
      setPromoErrorStatus("not_found");
      setPromoDetailsLoading(false);
      return;
    }

    checkSession();
    fetchPromoDetails();
  }, [promoId]);

  const fetchStatusAndSettings = async () => {
    setLoading(true);
    setApiError(null);

    try {
      const tg = (window as any).Telegram?.WebApp;
      const initData = tg?.initData || "";
      
      const res = await fetch(`${API_BASE}/api/promo/status?promoId=${promoId}&initData=${encodeURIComponent(initData)}`);

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `API returned HTTP status ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        if (data.user && data.user.isVerified) {
          setVerifiedUser(data.user);
        }
      } else {
        throw new Error(data.error || "Failed to load status");
      }
    } catch (err: any) {
      console.error("API Error (fetchStatusAndSettings):", err);
      if (!loadedPromo) {
        setApiError(err.message || "Failed to load promo rewards status.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndSettings();
  }, [promoId, userId]);

  useEffect(() => {
    let interval: any;
    if (resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mobileInput.trim() || authLoading || resendTimer > 0) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: mobileInput.trim(), fingerprint })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentStep("OTP");
        setResendTimer(60);
      } else {
        if (data.lockoutMinutes) {
          setAuthError(`❌ Account locked. Try again in ${data.lockoutMinutes} minutes.`);
        } else {
          setAuthError(data.error || "Failed to send OTP.");
        }
      }
    } catch (err) {
      setAuthError("Network error. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.length !== 4 || authLoading) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: mobileInput.trim(), otp: otpInput, fingerprint })
      });
      const data = await res.json();
      if (data.success) {
        if (data.sessionToken) {
          localStorage.setItem("rs_session_token", data.sessionToken);
          setSessionToken(data.sessionToken);
        }
        setVerifiedUser(data.user);
        setUserId(String(data.user.telegramId));
        setCurrentStep("VERIFIED");
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#8b5cf6', '#a78bfa', '#c4b5fd']
        });
      } else {
        setAuthError(data.error || "Invalid verification code.");
      }
    } catch (err) {
      setAuthError("Network error.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCodeInput.trim() || verifyingPromo) return;
    setVerifyingPromo(true);
    setPromoError(null);
    try {
      const res = await fetch(`${API_BASE}/api/promo/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          promoCode: promoCodeInput.trim(), 
          userId: verifiedUser?.telegramId,
          pageId: promoId 
        })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentStep("CLAIM");
      } else {
        setPromoError(data.error || "Invalid promo code or requirements not met.");
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

    const claimOnBackend = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/promo/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            promoCode: promoCodeInput.trim(), 
            userId: verifiedUser?.telegramId,
            pageId: promoId,
            fingerprint
          })
        });
        const data = await res.json();
        if (data.success) {
          setRewardAmount(data.rewardAmount);
          setClaimId(data.claimId);
          setClaimTime(data.time || new Date().toLocaleString());
          setWalletBalance(data.newBalance || 0);
          setCurrentStep("SUCCESS");
          // Fireworks
          const duration = 3 * 1000;
          const end = Date.now() + duration;
          const frame = () => {
            confetti({
              particleCount: 2,
              angle: 60,
              spread: 55,
              origin: { x: 0 },
              colors: ['#8b5cf6', '#a78bfa']
            });
            confetti({
              particleCount: 2,
              angle: 120,
              spread: 55,
              origin: { x: 1 },
              colors: ['#8b5cf6', '#a78bfa']
            });
            if (Date.now() < end) requestAnimationFrame(frame);
          };
          frame();
        } else {
          setPromoError(data.error || "Claim failed.");
        }
      } catch (err) {
        setPromoError("Server error during claim.");
      } finally {
        setClaimLoading(false);
      }
    };

    // Monetag Integration
    const zoneId = "11210088";
    const showAd = (window as any)[`show_${zoneId}`];
    if (showAd) {
      showAd()
        .then(() => {
          console.log("[MONETAG] Ad finished successfully");
          claimOnBackend();
        })
        .catch((e: any) => {
          console.error("[MONETAG] Ad error/skipped:", e);
          setPromoError("Ad verification failed. Please watch the full ad to claim.");
          setClaimLoading(false);
        });
    } else {
      console.warn("[MONETAG] Ad script not found, proceeding (DEV MODE)");
      claimOnBackend();
    }
  };

  const LoadingSpinner = () => (
    <div className="flex flex-col items-center justify-center p-12 space-y-4">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="w-12 h-12 text-indigo-500" />
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
          {type === "not_found" ? "Promo Not Found" : message === "Please open this page from Telegram Mini App" ? "Access Denied" : "Something Went Wrong"}
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

  if (apiError) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <ErrorView message={apiError} />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
        <ErrorView message="Please open this page from Telegram Mini App" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white font-sans selection:bg-blue-500/30">
      <div className="max-w-md mx-auto min-h-screen flex flex-col p-4 md:p-6">
        
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight leading-none">ROYSHARE</h1>
              <span className="text-[10px] font-bold text-indigo-400 tracking-[0.2em] uppercase">REWARDS</span>
            </div>
          </div>
          {currentStep !== "MOBILE" && currentStep !== "SUCCESS" && (
            <button 
              onClick={() => setCurrentStep("MOBILE")}
              className="text-zinc-500 hover:text-white transition-colors text-xs font-bold"
            >
              RESET
            </button>
          )}
        </header>

        <main className="flex-grow flex flex-col justify-center py-8">
          <AnimatePresence mode="wait">
            {currentStep === "MOBILE" && (
              <motion.div
                key="mobile"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h2 className="text-4xl font-black text-white leading-tight">Mobile Verification</h2>
                  <p className="text-zinc-400 text-lg">Enter your number to continue to rewards.</p>
                </div>

                <form onSubmit={handleSendOTP} className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase ml-1">Phone Number</label>
                    <div className="relative group">
                      <Smartphone className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-500 group-focus-within:text-indigo-400 transition-colors" />
                      <input
                        type="tel"
                        placeholder="e.g. 9876543210"
                        value={mobileInput}
                        onChange={(e) => setMobileInput(e.target.value.replace(/\D/g, ''))}
                        className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-[24px] py-5 pl-14 pr-6 text-xl font-bold focus:outline-none focus:border-indigo-500/50 transition-all placeholder:text-zinc-700"
                      />
                    </div>
                  </div>

                  {authError && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <p className="text-sm text-red-400 font-medium">{authError}</p>
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading || mobileInput.length < 10 || resendTimer > 0}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:hover:bg-indigo-600 text-white font-black py-5 rounded-[24px] shadow-xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                  >
                    {authLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                      <>
                        {resendTimer > 0 ? `RESEND IN ${resendTimer}s` : "SEND OTP CODE"}
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
            )}

            {currentStep === "OTP" && (
              <motion.div
                key="otp"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="space-y-2">
                  <h2 className="text-4xl font-black text-white leading-tight">Enter Code</h2>
                  <p className="text-zinc-400 text-lg">We sent a 4-digit code to your Telegram bot.</p>
                </div>

                <form onSubmit={handleVerifyOTP} className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase ml-1">4-Digit OTP</label>
                    <input
                      type="text"
                      placeholder="0000"
                      maxLength={4}
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-[24px] py-6 text-center text-5xl font-black tracking-[0.4em] focus:outline-none focus:border-indigo-500/50 transition-all placeholder:text-zinc-700"
                    />
                  </div>

                  {authError && (
                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <p className="text-sm text-red-400 font-medium">{authError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading || otpInput.length !== 4}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white font-black py-5 rounded-[24px] transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                  >
                    {authLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "VERIFY CODE"}
                  </button>

                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      disabled={resendTimer > 0}
                      onClick={handleSendOTP}
                      className="w-full text-white font-bold text-sm hover:text-indigo-400 transition-colors disabled:text-zinc-600"
                    >
                      {resendTimer > 0 ? `Resend code in ${resendTimer}s` : "Resend OTP Code"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentStep("MOBILE")}
                      className="w-full text-zinc-500 font-bold text-xs hover:text-white transition-colors"
                    >
                      Change Mobile Number
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {currentStep === "VERIFIED" && (
              <motion.div
                key="verified"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="space-y-8 text-center"
              >
                <div className="relative inline-block">
                  <div className="w-24 h-24 bg-green-500 rounded-full mx-auto flex items-center justify-center shadow-2xl shadow-green-500/20">
                    {verifiedUser?.photoUrl ? (
                      <img src={verifiedUser.photoUrl} alt="Profile" className="w-full h-full rounded-full object-cover border-4 border-green-500/50" referrerPolicy="no-referrer" />
                    ) : (
                      <CheckCircle className="w-12 h-12 text-white" />
                    )}
                  </div>
                  <div className="absolute -bottom-2 -right-2 bg-green-500 text-white p-1.5 rounded-full border-4 border-[#0f0f0f]">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-4xl font-black text-white">✅ Verified Successfully</h2>
                  <p className="text-zinc-400 text-lg">Account identity confirmed.</p>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 rounded-[32px] p-6 space-y-4">
                  <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl">
                    <span className="text-zinc-500 font-bold text-xs">NAME</span>
                    <span className="text-white font-bold">{verifiedUser?.firstName || verifiedUser?.username}</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl">
                    <span className="text-zinc-500 font-bold text-xs">USERNAME</span>
                    <span className="text-indigo-400 font-bold">@{verifiedUser?.username || "no_username"}</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl">
                    <span className="text-zinc-500 font-bold text-xs">TELEGRAM ID</span>
                    <span className="font-mono text-indigo-400 font-bold">{verifiedUser?.telegramId}</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl">
                    <span className="text-zinc-500 font-bold text-xs">MOBILE</span>
                    <span className="font-bold text-white">{verifiedUser?.mobile}</span>
                  </div>
                </div>

                <button
                  onClick={() => setCurrentStep("PROMO")}
                  className="w-full bg-white text-black font-black py-5 rounded-[24px] shadow-xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  CONTINUE
                  <ArrowRight className="w-5 h-5" />
                </button>
              </motion.div>
            )}

            {currentStep === "PROMO" && (
              <motion.div
                key="promo"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="space-y-4 text-center">
                  <div className="bg-indigo-500/10 text-indigo-400 text-[10px] font-black px-4 py-1.5 rounded-full border border-indigo-500/20 inline-block tracking-widest uppercase mb-2">
                    {loadedPromo?.name || "CLAIM REWARD"}
                  </div>
                  
                  {/* Live Counter Display */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-3xl">
                      <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Available Budget</div>
                      <div className="text-xl font-black text-white">₹{Math.max(0, (loadedPromo?.totalBudget || 0) - (loadedPromo?.budgetUsed || 0)).toLocaleString()}</div>
                    </div>
                    <div className="bg-zinc-900/50 border border-zinc-800 p-4 rounded-3xl">
                      <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">Remaining Slots</div>
                      <div className="text-xl font-black text-white">{Math.max(0, (loadedPromo?.maxUsers || 0) - (loadedPromo?.usedCount || 0)).toLocaleString()}</div>
                    </div>
                  </div>

                  <h2 className="text-4xl font-black text-white">Enter Promo Code</h2>
                  <p className="text-zinc-400 text-lg">Please enter the valid promo code to unlock the claim button.</p>
                </div>

                <form onSubmit={handleVerifyPromo} className="space-y-6">
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="PROMO_CODE"
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                      className="w-full bg-zinc-900 border-2 border-zinc-800 rounded-[24px] py-6 text-center text-2xl font-black tracking-[0.2em] focus:outline-none focus:border-indigo-500/50 transition-all placeholder:text-zinc-800"
                    />
                  </div>

                  {promoError && (
                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <p className="text-sm text-red-400 font-medium">{promoError}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={verifyingPromo || !promoCodeInput.trim()}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white font-black py-5 rounded-[24px] transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                  >
                    {verifyingPromo ? <Loader2 className="w-6 h-6 animate-spin" /> : "VERIFY CODE"}
                  </button>
                </form>
              </motion.div>
            )}

            {currentStep === "CLAIM" && (
              <motion.div
                key="claim"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-10 text-center"
              >
                <div className="space-y-4">
                  <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl mx-auto flex items-center justify-center border border-indigo-500/20">
                    <Zap className="w-10 h-10 text-indigo-400" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black text-white leading-tight">Ready to Claim!</h2>
                    <p className="text-zinc-400">Watch a short ad to receive your reward instantly.</p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-indigo-900/40 to-transparent border border-indigo-500/20 rounded-[40px] p-8 space-y-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-6 opacity-10">
                    <Sparkles className="w-20 h-20 text-white" />
                  </div>
                  
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-indigo-400 tracking-[0.2em] uppercase">GUARANTEED REWARD</span>
                    <div className="text-6xl font-black text-white">₹{loadedPromo?.rewardAmount}</div>
                  </div>

                  <div className="h-[1px] bg-indigo-500/20 w-1/2 mx-auto" />

                  <div className="flex items-center justify-center gap-6 text-zinc-500 font-bold text-xs">
                    <div className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> VERIFIED</div>
                    <div className="flex items-center gap-1.5"><Zap className="w-4 h-4" /> INSTANT</div>
                  </div>
                </div>

                <div className="space-y-4">
                  {promoError && (
                    <p className="text-red-400 text-sm font-medium">{promoError}</p>
                  )}
                  <button
                    onClick={launchAdAndClaim}
                    disabled={claimLoading}
                    className="w-full bg-white text-black font-black py-6 rounded-[28px] shadow-[0_0_40px_rgba(255,255,255,0.15)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-4 text-xl"
                  >
                    {claimLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                      <>
                        <Smartphone className="w-7 h-7 text-indigo-600" />
                        WATCH AD & CLAIM
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {currentStep === "SUCCESS" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-8 text-center"
              >
                <div className="space-y-4">
                  <div className="w-20 h-20 bg-green-500 rounded-full mx-auto flex items-center justify-center shadow-2xl shadow-green-500/20">
                    <CheckCircle className="w-10 h-10 text-white" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black text-white">Claimed!</h2>
                    <p className="text-zinc-400 text-lg">Reward credited to your wallet.</p>
                  </div>
                </div>

                {/* Digital Receipt Card */}
                <div id="reward-receipt" className="bg-zinc-900 border border-zinc-800 rounded-[32px] p-8 space-y-6 text-left relative overflow-hidden">
                  <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-600/5 rounded-full blur-3xl" />
                  
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                    <span className="text-[10px] font-black text-zinc-500 tracking-widest uppercase">Transaction Receipt</span>
                    <span className="text-[10px] font-black text-green-500 tracking-widest uppercase">Status: Success</span>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 text-xs font-bold uppercase tracking-tighter">Claim ID</span>
                      <span className="text-white font-mono text-xs">{claimId}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 text-xs font-bold uppercase tracking-tighter">Promo Name</span>
                      <span className="text-white font-bold text-sm">{loadedPromo?.name}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 text-xs font-bold uppercase tracking-tighter">Reward Amount</span>
                      <span className="text-green-500 font-black text-lg">+ ₹{rewardAmount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 text-xs font-bold uppercase tracking-tighter">Wallet Balance</span>
                      <span className="text-white font-black text-lg">₹{walletBalance}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-zinc-800 pt-4">
                      <span className="text-zinc-500 text-xs font-bold uppercase tracking-tighter">Date & Time</span>
                      <span className="text-white font-bold text-xs">{claimTime}</span>
                    </div>
                  </div>

                  <div className="text-[9px] text-center text-zinc-600 font-medium italic mt-4">
                    Verified via RoyShare Secure OTP Verification
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={() => {
                      const tg = (window as any).Telegram?.WebApp;
                      if (tg) tg.close();
                      else window.location.href = "https://t.me/RoyShare_Bot";
                    }}
                    className="w-full bg-white text-black font-black py-5 rounded-[24px] shadow-xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                  >
                    GO TO BOT
                    <ArrowRight className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      // Basic Download logic (as text for simplicity in this env)
                      const receipt = `
ROYSHARE REWARD RECEIPT
-----------------------
Claim ID: ${claimId}
Promo: ${loadedPromo?.name}
Reward: ₹${rewardAmount}
Wallet Balance: ₹${walletBalance}
Date: ${claimTime}
Status: VERIFIED
-----------------------
Thank you for using RoyShare!
                      `;
                      const blob = new Blob([receipt], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `receipt_${claimId}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 text-white font-black py-4 rounded-[24px] hover:bg-zinc-800 transition-all flex items-center justify-center gap-3"
                  >
                    <Download className="w-5 h-5" />
                    DOWNLOAD RECEIPT
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        <footer className="py-10 text-center space-y-6">
          <div className="flex items-center justify-center gap-8 opacity-20">
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="w-6 h-6" />
              <span className="text-[8px] font-bold uppercase tracking-widest">Secure</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Zap className="w-6 h-6" />
              <span className="text-[8px] font-bold uppercase tracking-widest">Speed</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Smartphone className="w-6 h-6" />
              <span className="text-[8px] font-bold uppercase tracking-widest">Mini App</span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 font-bold tracking-tight px-8 leading-relaxed">
            POWERED BY ROYSHARE REWARD ENGINE • SECURE END-TO-END VERIFICATION • BOT OTP PROTECTED
          </p>
        </footer>
      </div>
    </div>
  );
};

export default PromoRewardsPage;
