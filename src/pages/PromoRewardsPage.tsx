import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../config/api";
import { motion, AnimatePresence } from "motion/react";
import { 
  Gift, 
  Lock, 
  Unlock, 
  Send, 
  Instagram, 
  Facebook, 
  Youtube, 
  Disc, 
  Twitter, 
  ChevronRight, 
  ArrowLeft, 
  Clock, 
  AlertTriangle, 
  History,
  CheckCircle2,
  Trophy,
  Activity,
  User,
  Hash
} from "lucide-react";
import confetti from "canvas-confetti";
import AdScriptRenderer from "../components/AdScriptRenderer";

interface ClaimRecord {
  id: string;
  promoCode: string;
  rewardAmount: number;
  status: string;
  date: string;
  time: string;
}

interface SocialButtonConfig {
  enabled: boolean;
  url: string;
}

interface PromoRewardsSettings {
  enabled: boolean;
  adsterraBannerCode?: string;
  monetagAdCode?: string;
  expiryMinutes: number;
  expiryEnabled: boolean;
  tgChannelUrl?: string;
  tgChannelEnabled?: boolean;
  tgGroupUrl?: string;
  tgGroupEnabled?: boolean;
  instagramUrl?: string;
  instagramEnabled?: boolean;
  facebookUrl?: string;
  facebookEnabled?: boolean;
  youtubeUrl?: string;
  youtubeEnabled?: boolean;
  discordUrl?: string;
  discordEnabled?: boolean;
  twitterUrl?: string;
  twitterEnabled?: boolean;
}

export default function PromoRewardsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("User");
  const [telegramId, setTelegramId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [settings, setSettings] = useState<PromoRewardsSettings | null>(null);
  
  // Lock Stage States
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [accessCodeInput, setAccessCodeInput] = useState<string>("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<boolean>(false);
  const [showUnlockSuccess, setShowUnlockSuccess] = useState<boolean>(false);

  // Expiry / Session States
  const [sessionExpiry, setSessionExpiry] = useState<string | null>(null);
  const [timeLeftStr, setTimeLeftStr] = useState<string>("00:00:00");
  const [isExpired, setIsExpired] = useState<boolean>(false);

  // Promo Code States
  const [promoCodeInput, setPromoCodeInput] = useState<string>("");
  const [redeeming, setRedeeming] = useState<boolean>(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [claimHistory, setClaimHistory] = useState<ClaimRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Success Celebration Popup
  const [showSuccessPopup, setShowSuccessPopup] = useState<boolean>(false);
  const [successData, setSuccessData] = useState<{ amount: number; code: string } | null>(null);

  // Initialize URL user parameters and load settings
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("userId");
    const tg = (window as any).Telegram?.WebApp;
    if (tg) tg.expand();
    const tgUserId = tg?.initDataUnsafe?.user?.id;
    const resolvedId = queryUserId || (tgUserId ? String(tgUserId) : null);

    if (resolvedId) {
      setUserId(resolvedId);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchStatusAndSettings = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/promo/status?userId=${userId}`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setUsername(data.user?.name || data.user?.username || "User");
        setTelegramId(data.user?.telegramId || "");
        
        if (data.unlocked && data.session) {
          setIsUnlocked(true);
          setSessionExpiry(data.session.expiresAt);
        }
      }
    } catch (err) {
      console.error("Error fetching promo rewards status:", err);
    } finally {
      setLoading(false);
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

  // Access Lock Submission
  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCodeInput.trim() || !userId || unlocking) return;

    setUnlocking(true);
    setUnlockError(null);

    try {
      const res = await fetch(`${API_BASE}/api/promo/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, accessCode: accessCodeInput.trim() })
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

  // Monetag Rewarded Ad logic
  const showMonetagAd = () => {
    return new Promise<boolean>((resolve) => {
      const tg = (window as any).Telegram?.WebApp;
      if (!tg) {
        console.log("Monetag Ad Simulator: Success");
        resolve(true);
        return;
      }

      const monetagFn = (window as any).show_11210088;
      if (monetagFn) {
         monetagFn().then(() => {
            resolve(true);
         }).catch((e: any) => {
            console.error("Monetag Ad Error:", e);
            alert("Ad failed to load or was closed early. Please try again to claim your reward.");
            resolve(false);
         });
      } else {
         console.warn("Monetag SDK function not found. Proceeding with claim.");
         resolve(true); 
      }
    });
  };

  // Promo Redemption Submission
  const handleRedeemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCodeInput.trim() || !userId || redeeming || isExpired) return;

    setRedeeming(true);
    setRedeemError(null);

    // 1. Show Monetag Mini Ad
    const adCompleted = await showMonetagAd();
    if (!adCompleted) {
      setRedeeming(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/promo/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId, 
          promoCode: promoCodeInput.trim(),
          accessCode: "session" // Server checks actual session
        })
      });
      const data = await res.json();

      if (data.success) {
        // Play fireworks & confetti
        confetti({
          particleCount: 180,
          spread: 80,
          origin: { y: 0.5 },
          colors: ['#a855f7', '#6366f1', '#3b82f6', '#ec4899', '#fbbf24']
        });
        
        // Secondary fireworks explosion
        setTimeout(() => {
          confetti({
            particleCount: 100,
            spread: 60,
            origin: { x: 0.3, y: 0.6 },
            colors: ['#ec4899', '#fbbf24']
          });
        }, 300);
        
        setTimeout(() => {
          confetti({
            particleCount: 100,
            spread: 60,
            origin: { x: 0.7, y: 0.6 },
            colors: ['#a855f7', '#3b82f6']
          });
        }, 600);

        setSuccessData({ amount: data.rewardAmount, code: data.promoCode });
        setShowSuccessPopup(true);
        setPromoCodeInput("");
        fetchClaimHistory();
        fetchStatusAndSettings();
      } else {
        setRedeemError(data.error || "Failed to redeem promo code. Ensure all tasks are completed.");
      }
    } catch (err) {
      console.error("Redeem error:", err);
      setRedeemError("Network error. Please try again later.");
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white font-sans p-6">
        <Disc className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-slate-400 font-medium tracking-wide">Syncing Security System...</p>
      </div>
    );
  }

  // Access Check if page or settings are globally closed
  if (!userId || !settings || !settings.enabled) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white font-sans p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-rose-500 mb-4 animate-pulse" />
        <h1 className="text-2xl font-black mb-2">{!userId ? "Access Denied" : "Promo Page Closed"}</h1>
        <p className="text-slate-400 max-w-sm mb-6 text-sm">
          {!userId ? "Please launch this app directly from the RoyShare official Telegram bot." : "Promo Rewards are currently offline or closed by administrator. Check back soon!"}
        </p>
      </div>
    );
  }

  // 1. PAGE EXPIRED STAGE
  if (isExpired) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white font-sans p-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-slate-900 border border-rose-500/30 p-10 rounded-3xl max-w-md w-full space-y-6 shadow-2xl shadow-rose-950/10"
        >
          <span className="text-6xl block animate-bounce">⌛</span>
          <h1 className="text-3xl font-black text-rose-500 tracking-tight">Better Luck Next Time</h1>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-rose-500/20 to-transparent w-full" />
          <p className="text-slate-300 font-bold text-lg">This Promo Page Has Expired.</p>
          <p className="text-slate-400 text-sm leading-relaxed">
            Promo claims are no longer available. Keep an eye on our Telegram Channel for upcoming promo drops!
          </p>
          <button
            disabled
            className="w-full py-4 rounded-2xl bg-slate-800 text-slate-500 font-bold uppercase tracking-wider cursor-not-allowed border border-slate-700/50"
          >
            Redemption Expired
          </button>
        </motion.div>
      </div>
    );
  }

  // 2. ACCESS LOCK STAGE (UNAUTHORIZED)
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white font-sans p-4">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md bg-slate-900/90 border border-indigo-500/20 rounded-3xl p-8 space-y-8 shadow-2xl relative overflow-hidden"
        >
          {/* Neon Top Accent */}
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500" />
          
          <div className="text-center space-y-3">
            <div className="inline-flex p-4 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mb-1">
              {showUnlockSuccess ? (
                <Unlock className="w-8 h-8 animate-pulse text-emerald-400" />
              ) : (
                <Lock className="w-8 h-8 text-indigo-400" />
              )}
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">🔒 Promo Rewards Locked</h1>
            <p className="text-slate-400 text-sm">Enter valid Access Code to claim premium rewards.</p>
          </div>

          <form onSubmit={handleUnlockSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-indigo-300 uppercase tracking-widest block">Access Code</label>
              <input
                type="text"
                required
                value={accessCodeInput}
                onChange={(e) => setAccessCodeInput(e.target.value)}
                placeholder="e.g. ROYPREMIUM77"
                disabled={unlocking || showUnlockSuccess}
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-2xl px-5 py-4 text-white text-center font-black placeholder:text-slate-600 text-lg uppercase tracking-wider focus:outline-none transition-all"
              />
            </div>

            {unlockError && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex gap-3 text-left"
              >
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-rose-400 uppercase tracking-wider">Invalid Access Code</h4>
                  <p className="text-xs text-slate-400 mt-1">Please double-check the code and try again.</p>
                </div>
              </motion.div>
            )}

            {showUnlockSuccess && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex gap-3 text-left text-emerald-400"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider">Access Approved</h4>
                  <p className="text-xs text-slate-400 mt-1">Unlocking promo reward page...</p>
                </div>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={unlocking || showUnlockSuccess || !accessCodeInput.trim()}
              className="w-full py-4.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {unlocking ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <span>✨ Unlock Page</span>
              )}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  // 3. MAIN AUTHORIZED PROMO PAGE
  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans flex flex-col relative overflow-x-hidden">
      
      {/* Header Panel */}
      <header className="p-5 border-b border-slate-900 bg-slate-950/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <Gift className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-wide uppercase">🎁 Promo Rewards</h1>
              <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                Premium Session Unlocked
              </p>
            </div>
          </div>
          
          {/* Header Countdown Timer */}
          {settings.expiryEnabled && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-full text-rose-400 animate-pulse">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-xs font-black font-mono">{timeLeftStr}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-md mx-auto w-full p-6 space-y-6 pb-20">
        
        {/* User Stats Card */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-black text-lg">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white text-sm">{username}</h4>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 font-mono">
                <Hash className="w-3 h-3 text-indigo-400" />
                {telegramId || "No Telegram Link"}
              </p>
            </div>
          </div>
          <div className="bg-slate-950 px-4 py-2 rounded-2xl border border-slate-800 text-right">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Wallet Balance</span>
            <span className="text-xs font-bold text-indigo-400">₹ Active Update</span>
          </div>
        </div>

        {/* Social Media Tasks Section */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wider">📌 Required Channels</h3>
            <p className="text-slate-400 text-xs mt-0.5">Join these communities before redeeming to verify claim status.</p>
          </div>

          <div className="grid gap-2.5">
            {[
              { id: 'tgChannel', name: 'Telegram Channel', icon: Send, url: settings.tgChannelUrl, enabled: settings.tgChannelEnabled },
              { id: 'tgGroup', name: 'Telegram Group', icon: Send, url: settings.tgGroupUrl, enabled: settings.tgGroupEnabled },
              { id: 'instagram', name: 'Instagram', icon: Instagram, url: settings.instagramUrl, enabled: settings.instagramEnabled },
              { id: 'facebook', name: 'Facebook', icon: Facebook, url: settings.facebookUrl, enabled: settings.facebookEnabled },
              { id: 'youtube', name: 'YouTube', icon: Youtube, url: settings.youtubeUrl, enabled: settings.youtubeEnabled },
              { id: 'discord', name: 'Discord', icon: Disc, url: settings.discordUrl, enabled: settings.discordEnabled },
              { id: 'twitter', name: 'X (Twitter)', icon: Twitter, url: settings.twitterUrl, enabled: settings.twitterEnabled }
            ].map((social) => {
              if (!social.enabled) return null;
              return (
                <a
                  key={social.id}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-950/50 rounded-2xl transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-indigo-500/5 text-indigo-400">
                      <social.icon className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-slate-300">{social.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-400 bg-indigo-500/5 border border-indigo-500/10 px-3 py-1 rounded-full uppercase">
                    Join Channel
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* Promo Code Input Box */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500" />
          
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wider flex items-center gap-2">
              🎁 Enter Promo Code
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">Enter active promo coupon code to receive your reward.</p>
          </div>

          <form onSubmit={handleRedeemSubmit} className="space-y-4">
            <input
              type="text"
              required
              value={promoCodeInput}
              onChange={(e) => setPromoCodeInput(e.target.value)}
              placeholder="e.g. WELCOME50"
              disabled={redeeming}
              className="w-full bg-slate-950/80 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-2xl px-5 py-4 text-white font-black placeholder:text-slate-700 text-center uppercase tracking-wider focus:outline-none transition-all"
            />

            {redeemError && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex gap-3 text-left"
              >
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400">{redeemError}</p>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={redeeming || !promoCodeInput.trim()}
              className="w-full py-4.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest active:scale-95 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {redeeming ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying Promo Code...</span>
                </>
              ) : (
                <span>✨ Redeem Reward</span>
              )}
            </button>
          </form>
        </div>

        {/* Claim History Section */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
          <h3 className="font-black text-white text-sm uppercase tracking-wider flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-400" />
            Claim History
          </h3>

          {historyLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : claimHistory.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No promo claims recorded yet.</p>
          ) : (
            <div className="space-y-2.5">
              {claimHistory.map((claim) => (
                <div key={claim.id} className="p-3.5 bg-slate-950 border border-slate-850 rounded-2xl flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white text-xs">{claim.promoCode}</h4>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono">{claim.date} | {claim.time}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-emerald-400 block">+₹{claim.rewardAmount.toFixed(2)}</span>
                    <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full text-emerald-400 font-black mt-1 inline-block uppercase">
                      {claim.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Adsterra Banner Area */}
        {settings.adsterraBannerCode && (
          <div className="bg-slate-950/40 p-4 border border-slate-900 rounded-3xl flex flex-col items-center justify-center overflow-hidden">
            <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest mb-3">Sponsored Content</p>
            <AdScriptRenderer scriptCode={settings.adsterraBannerCode} />
          </div>
        )}

      </main>

      {/* Footer Area */}
      <footer className="mt-auto border-t border-slate-900 bg-slate-950 py-8 text-center space-y-2">
        <p className="text-xs font-black text-white uppercase tracking-wider">RoyShare</p>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Developed by Rishu Roy</p>
      </footer>

      {/* Claims Success Popup Modal */}
      <AnimatePresence>
        {showSuccessPopup && successData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Dark Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSuccessPopup(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            
            {/* Pop Card */}
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-slate-900 border border-indigo-500/30 p-8 rounded-3xl text-center max-w-sm w-full relative overflow-hidden shadow-2xl space-y-6"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-500" />
              
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto text-3xl animate-bounce">
                🏆
              </div>

              <div className="space-y-1">
                <h2 className="text-2xl font-black text-white tracking-tight">🎉 Congratulations</h2>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-bold">Promo Redeemed Successfully</p>
              </div>

              <div className="h-0.5 bg-slate-800 w-full" />

              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-850">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Promo Code</span>
                  <span className="text-sm font-bold text-white uppercase mt-1 block">{successData.code}</span>
                </div>
                <div className="bg-slate-950 p-4 rounded-2xl border border-emerald-500/10">
                  <span className="text-[10px] font-black text-emerald-500 uppercase tracking-wider block">Reward Won</span>
                  <span className="text-sm font-bold text-emerald-400 mt-1 block">₹{successData.amount.toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-2xl text-xs text-slate-400 font-medium">
                💰 Wallet Updated Successfully
              </div>

              <button
                onClick={() => setShowSuccessPopup(false)}
                className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all shadow-lg"
              >
                Awesome
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
