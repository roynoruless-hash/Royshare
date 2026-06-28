import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, User, Award, AlertTriangle, CheckCircle2, ExternalLink, ShieldAlert, AlertCircle, Play, Zap } from "lucide-react";
import AdRenderer from "../components/AdRenderer";

// Types
interface Task {
  id: string;
  name: string;
  amount: number;
  adNetwork?: string;
  description?: string;
}

const AD_LINKS = [
  {
    title: "Hostinger - Premium Web Hosting",
    desc: "Get 70% off premium web hosting + Free SSL and Free Domain name. Plans starting at just ₹149/mo!",
    cta: "Claim Discount",
    url: "https://www.hostinger.com"
  },
  {
    title: "Binance - Trade Crypto Instantly",
    desc: "Join the world's largest cryptocurrency exchange. Trade BTC, ETH, and 500+ altcoins with the lowest trading fees.",
    cta: "Register & Trade",
    url: "https://www.binance.com"
  },
  {
    title: "Stake - Premium Online Casino",
    desc: "Play slots, blackjack, roulette and sports betting with 100% safe deposits. Use promo code ROYSHARE for double bonus!",
    cta: "Play Now",
    url: "https://stake.com"
  },
  {
    title: "Zomato - Order Hot Food",
    desc: "Craving delicious meals? Order from premium local restaurants and get super fast delivery + flat 50% discount!",
    cta: "Order Now",
    url: "https://www.zomato.com"
  }
];

export default function EarnRewardsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Configuration and settings
  const [timerDuration, setTimerDuration] = useState<number>(30);
  const [currency, setCurrency] = useState<string>("INR");
  const [userName, setUserName] = useState<string>("User");
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [botUsername, setBotUsername] = useState<string>("RoyShareEarnBot");

  // Active Task State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [timer, setTimer] = useState<number>(30);
  const [isTimerFinished, setIsTimerFinished] = useState<boolean>(false);
  const [adClicked, setAdClicked] = useState<boolean>(false);
  const [adTimer, setAdTimer] = useState<number>(0);
  const [adTimerActive, setAdTimerActive] = useState<boolean>(false);

  // Completion State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isCompletedSuccess, setIsCompletedSuccess] = useState<boolean>(false);
  const [isMonetagAdRunning, setIsMonetagAdRunning] = useState<boolean>(false);
  const [monetagError, setMonetagError] = useState<string | null>(null);
  const [adWatchedSuccessfully, setAdWatchedSuccessfully] = useState<boolean>(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState<boolean>(false);
  const [isTelegramApp, setIsTelegramApp] = useState<boolean>(false);

  // Initialize Telegram WebApp and parse parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("userId");
    const queryTaskId = params.get("taskId");

    const tg = (window as any).Telegram?.WebApp;
    setIsTelegramApp(!!tg?.initData);
    if (tg) {
      tg.ready();
      tg.expand();
    }
    const tgUserId = tg?.initDataUnsafe?.user?.id;

    const resolvedUserId = queryUserId || (tgUserId ? String(tgUserId) : null);
    const resolvedTaskId = queryTaskId || null;

    if (resolvedUserId) {
      setUserId(resolvedUserId);
    }
    if (resolvedTaskId) {
      setTaskId(resolvedTaskId);
    }

    if (!resolvedUserId || !resolvedTaskId) {
      setError("Missing query parameters (userId and taskId are required).");
      setLoading(false);
    }
  }, []);

  // Fetch settings, user information, and tasks
  useEffect(() => {
    if (!userId || !taskId) return;

    setLoading(true);
    fetch(`/api/earn-rewards/settings?userId=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }

        setTimerDuration(data.timerDuration || 30);
        setTimer(data.timerDuration || 30);
        setCurrency(data.currency || "INR");
        setUserName(data.userName || "User");
        setCompletedTaskIds(data.completedTaskIds || []);
        setTasks(data.tasks || []);
        setBotUsername(data.botUsername || "RoyShareEarnBot");

        const resolvedTask = (data.tasks || []).find((t: Task) => t.id === taskId);
        if (resolvedTask) {
          setCurrentTask(resolvedTask);
          // Check if already completed (anti-abuse)
          if ((data.completedTaskIds || []).includes(taskId)) {
            setError("You have already completed this task. Duplicate rewards are not allowed.");
          }
        } else {
          setError("Requested task not found.");
        }
      })
      .catch((err) => {
        console.error("Error loading settings:", err);
        setError("Failed to connect to the server.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [userId, taskId]);

  // Main countdown timer
  useEffect(() => {
    if (loading || error || isCompletedSuccess || timer <= 0) {
      if (timer === 0 && !isTimerFinished) {
        setIsTimerFinished(true);
      }
      return;
    }

    const interval = setInterval(() => {
      setTimer((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [loading, error, isCompletedSuccess, timer, isTimerFinished]);

  // Redirect to Telegram Bot on success
  useEffect(() => {
    if (isCompletedSuccess) {
      const timerId = setTimeout(() => {
        window.location.href = `https://t.me/${botUsername}`;
      }, 3000);
      return () => clearTimeout(timerId);
    }
  }, [isCompletedSuccess, botUsername]);

  // Ad verification timer (5 seconds)
  useEffect(() => {
    if (!adTimerActive || adTimer <= 0) {
      if (adTimer === 0 && adTimerActive) {
        setAdTimerActive(false);
        setAdClicked(true);
      }
      return;
    }

    const interval = setInterval(() => {
      setAdTimer((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [adTimerActive, adTimer]);

  // Handle ad clicking
  const handleAdClick = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    if (!adClicked && !adTimerActive) {
      setAdTimer(5);
      setAdTimerActive(true);
    }
  };

  const handleWatchMonetagAd = async () => {
    if (isMonetagAdRunning || adWatchedSuccessfully || submitting) return;

    if (!isTelegramApp) {
      setMonetagError("This reward task is only available inside the Telegram Mini App.");
      return;
    }

    if (typeof (window as any).show_11210088 !== 'function') {
      setMonetagError("Please watch the complete advertisement to unlock your reward.");
      return;
    }

    setIsMonetagAdRunning(true);
    setMonetagError(null);
    try {
      await (window as any).show_11210088();
      setAdWatchedSuccessfully(true);
      setShowSuccessPopup(true);
      setTimeout(() => setShowSuccessPopup(false), 3000);
    } catch (err: any) {
      console.error("Monetag ad error:", err);
      setMonetagError("Please watch the complete advertisement to unlock your reward.");
    } finally {
      setIsMonetagAdRunning(false);
    }
  };

  const handleClaimMonetagReward = async () => {
    if (!adWatchedSuccessfully || isCompletedSuccess || submitting) return;
    submitTaskCompletion();
  };

  // Currency Formatter
  const formatValue = (amount: number) => {
    if (currency === "USD") {
      const usd = amount * 0.0118;
      return `$${usd.toFixed(2)}`;
    }
    return `₹${amount.toFixed(2)}`;
  };

  // Verify and Continue to next page
  const handleVerifyAndContinue = () => {
    if (!isTimerFinished) return;

    if (currentPage < 3) {
      // Transition to next page
      setCurrentPage((prev) => prev + 1);
      setTimer(timerDuration);
      setIsTimerFinished(false);
      // Optional: keep adClicked state or reset it. Let's keep it clicked to avoid annoying users, but require at least one click.
    } else {
      // Last page verification - complete the task!
      submitTaskCompletion();
    }
  };

  const submitTaskCompletion = () => {
    if (!userId || !taskId) return;

    setSubmitting(true);
    fetch("/api/earn-rewards/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, taskId })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setIsCompletedSuccess(true);
        }
      })
      .catch((err) => {
        console.error("Error completing task:", err);
        setError("Failed to submit task verification.");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  // Close WebApp and return to bot chat
  const handleBackToBot = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.close();
    } else {
      // Fallback for desktop browser testing
      window.close();
      alert("Please return to your Telegram chat.");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0e1118] text-white p-6">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" id="loading-spinner"></div>
        <p className="text-gray-400 font-medium">Loading Reward Task...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0e1118] text-white p-6 text-center">
        <div className="w-16 h-16 bg-red-950/50 border border-red-500/30 rounded-2xl flex items-center justify-center mb-6 text-red-500 shadow-lg shadow-red-950/20">
          <ShieldAlert size={36} />
        </div>
        <h2 className="text-2xl font-bold mb-3 text-red-400">Action Blocked</h2>
        <p className="text-gray-400 max-w-md mb-8 leading-relaxed">{error}</p>
        <button
          onClick={handleBackToBot}
          className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-semibold shadow-lg shadow-red-900/30 transition-all duration-200"
          id="btn-error-back"
        >
          Return to Telegram Bot
        </button>
      </div>
    );
  }

  if (isCompletedSuccess && currentTask) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f172a] text-white p-6 text-center overflow-hidden relative">
        {/* Decorative background lights */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-emerald-500/20 blur-[80px] rounded-full pointer-events-none"></div>
        
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.6 }}
          className="max-w-md w-full bg-slate-900/80 border border-emerald-500/20 backdrop-blur-md rounded-3xl p-8 shadow-2xl relative"
        >
          <div className="w-20 h-20 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-400">
            <CheckCircle2 size={44} />
          </div>

          <h2 className="text-3xl font-extrabold text-emerald-400 mb-2">✅ Task Completed</h2>
          <p className="text-gray-300 font-semibold mb-6 text-base">You are being redirected back to the bot...</p>
          
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 mb-8 max-w-sm mx-auto">
            <p className="text-gray-400 text-xs uppercase tracking-wider font-bold mb-1">💰 Reward Earned</p>
            <p className="text-4xl font-black text-amber-400 tracking-tight">{formatValue(currentTask.amount)}</p>
            <p className="text-[10px] text-emerald-400/80 mt-2 font-medium">Credited to your balance</p>
          </div>

          <button
            onClick={() => window.location.href = `https://t.me/${botUsername}`}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white rounded-2xl font-bold shadow-lg shadow-emerald-900/40 transition-all duration-200 flex items-center justify-center gap-2 text-lg animate-pulse"
            id="btn-congrats-back"
          >
            🤖 Return To Telegram Bot
          </button>
        </motion.div>
      </div>
    );
  }

  if (currentTask?.adNetwork === 'Monetag Mini App') {
    if (!isTelegramApp) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#0e1118] text-white p-6 text-center">
          <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-6 text-amber-500">
            <AlertCircle size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Mini App Required</h1>
          <p className="text-gray-400 max-w-xs mb-8">
            Please open this reward inside Telegram Mini App.
          </p>
          <button
            onClick={() => window.location.href = `https://t.me/${botUsername}`}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/30 transition-all active:scale-95 flex items-center gap-2"
          >
            <Play size={18} className="fill-current" />
            Open In Telegram
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0e1118] text-white p-6 text-center">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-blue-600/10 blur-[120px] rounded-full pointer-events-none"></div>
        
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full space-y-12 relative"
        >
          {/* Task Info */}
          <div className="space-y-4">
             <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-[11px] font-black uppercase tracking-widest mx-auto">
              <CheckCircle2 size={14} className="text-blue-400" />
              <span>Premium Task</span>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight leading-tight">
              {currentTask?.name || "Earn Rewards"}
            </h1>
            <p className="text-gray-400 text-lg leading-relaxed px-4">
              {currentTask?.description || "Watch a short ad to claim your reward coins instantly."}
            </p>
          </div>

          {/* Reward Amount */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden group">
             <p className="text-slate-500 font-bold uppercase tracking-[0.25em] text-[10px] mb-4">You will earn</p>
             <p className="text-7xl font-black text-amber-400 drop-shadow-md">
               {formatValue(currentTask.amount)}
             </p>
          </div>

          {/* Claim Button */}
          <div className="pt-4 px-2">
            {!adWatchedSuccessfully ? (
              <button
                onClick={handleWatchMonetagAd}
                disabled={isMonetagAdRunning || submitting}
                className={`w-full py-6 rounded-[2.5rem] font-black transition-all shadow-2xl flex flex-col items-center justify-center gap-2 text-2xl active:scale-95 group relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white shadow-blue-900/40`}
              >
                {isMonetagAdRunning ? (
                  <>
                    <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin mb-1" />
                    <span>Loading Ad...</span>
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    >
                      <Play size={36} className="text-blue-400" />
                    </motion.div>
                    <span>Watch Ad</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleClaimMonetagReward}
                disabled={isCompletedSuccess || submitting}
                className={`w-full py-6 rounded-[2.5rem] font-black transition-all shadow-2xl flex flex-col items-center justify-center gap-2 text-2xl active:scale-95 group relative overflow-hidden ${
                  isCompletedSuccess 
                    ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-400" 
                    : "bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-amber-900/40"
                }`}
              >
                {isCompletedSuccess ? (
                  <>
                    <CheckCircle2 size={32} />
                    <span>Reward Credited</span>
                  </>
                ) : submitting ? (
                  <>
                    <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin mb-1" />
                    <span>Claiming...</span>
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                    >
                      <Zap size={36} className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                    </motion.div>
                    <span>Claim Reward</span>
                  </>
                )}
              </button>
            )}

            {/* Status & Errors */}
            <div className="h-8 mt-6">
              <AnimatePresence mode="wait">
                {monetagError ? (
                  <motion.p 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="text-red-400 text-sm font-bold flex items-center justify-center gap-1.5 bg-red-400/10 py-2 px-4 rounded-full border border-red-400/20"
                  >
                    <AlertCircle size={14} /> {monetagError}
                  </motion.p>
                ) : isCompletedSuccess ? (
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-emerald-400 text-sm font-bold"
                  >
                    Reward Credited Successfully
                  </motion.p>
                ) : adWatchedSuccessfully ? (
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-blue-400 text-sm font-bold"
                  >
                    Ready to Claim!
                  </motion.p>
                ) : (
                  <p className="text-slate-500 text-xs font-medium uppercase tracking-[0.3em] opacity-50">
                    Watch complete ad to unlock
                  </p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Success Popup */}
        <AnimatePresence>
          {showSuccessPopup && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 50 }}
              className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-6 py-3 rounded-full font-bold shadow-2xl flex items-center gap-2"
            >
              <CheckCircle2 size={20} />
              <span>Advertisement watched successfully.</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const activeAd = AD_LINKS[(currentPage - 1) % AD_LINKS.length];
  const secondaryAd = AD_LINKS[currentPage % AD_LINKS.length];

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col justify-between py-6 px-4 relative">
      
      {/* HEADER SECTION */}
      <div className="max-w-lg w-full mx-auto bg-slate-900/60 border border-slate-800 backdrop-blur-sm rounded-2xl p-4 mb-4 shadow-md">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="flex flex-col items-center justify-center border-r border-slate-800 py-1">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
              <User size={13} className="text-blue-400" />
              <span>User Name</span>
            </div>
            <span className="text-sm font-bold truncate max-w-[120px] text-gray-100">{userName}</span>
          </div>

          <div className="flex flex-col items-center justify-center border-r border-slate-800 py-1">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
              <AlertCircle size={13} className="text-indigo-400" />
              <span>Task Number</span>
            </div>
            <span className="text-sm font-bold text-gray-100">{currentTask?.name}</span>
          </div>

          <div className="flex flex-col items-center justify-center py-1">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
              <Award size={13} className="text-amber-400" />
              <span>Reward Amount</span>
            </div>
            <span className="text-sm font-bold text-amber-400">{currentTask ? formatValue(currentTask.amount) : "—"}</span>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="max-w-lg w-full mx-auto flex-1 flex flex-col justify-center space-y-4">

        {/* 🖼 Top Banner Ad */}
        <div id="ad-top-banner">
          <AdRenderer targetPage="Earn Rewards Page"
            placementKey="Header Banner"
            fallback={
              <div 
                onClick={() => handleAdClick("https://www.hostinger.com")}
                className="bg-gradient-to-r from-blue-900/30 to-indigo-900/30 border border-blue-500/20 rounded-xl p-4 cursor-pointer hover:border-blue-500/40 transition-all shadow-md group relative overflow-hidden"
              >
                <span className="absolute top-1.5 right-2 bg-slate-800/80 text-[9px] text-slate-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Ad</span>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center text-blue-400 shrink-0 font-bold text-xs border border-blue-500/30">
                    HOST
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-blue-400 flex items-center gap-1 group-hover:underline">
                      Hostinger Premium Hosting <ExternalLink size={11} />
                    </h4>
                    <p className="text-[11px] text-gray-400 mt-1 leading-snug">
                      Web hosting starting at ₹149/mo. 70% Off + Free domain, SSL and backups included. 30-day refund guarantee!
                    </p>
                  </div>
                </div>
              </div>
            }
          />
        </div>

        {/* ⏱ Countdown Timer */}
        <div className="flex flex-col items-center justify-center py-6 bg-slate-900/30 border border-slate-900 rounded-3xl backdrop-blur-sm shadow-inner relative">
          <div className="relative flex items-center justify-center w-28 h-28 rounded-full border-4 border-slate-800 mb-3 shadow-lg">
            {/* Pulsing ring during ticking */}
            {!isTimerFinished && (
              <div className="absolute inset-0 rounded-full border-4 border-amber-500/30 animate-ping"></div>
            )}
            
            <div className="flex flex-col items-center">
              <Clock size={20} className={isTimerFinished ? "text-emerald-500" : "text-amber-500 mb-0.5 animate-pulse"} />
              <span className={`text-3xl font-black tracking-tighter ${isTimerFinished ? "text-emerald-400" : "text-amber-400"}`}>
                {timer}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">seconds</span>
            </div>
          </div>

          <p className="text-xs text-slate-400 font-medium">
            {isTimerFinished ? "Verification active" : `Page ${currentPage} of 3 • Please wait...`}
          </p>

          {/* Verification / Active Loading Indicator */}
          {adTimerActive && (
            <div className="absolute top-2 right-4 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1 flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
              Verifying visit: {adTimer}s
            </div>
          )}
          {adClicked && !adTimerActive && (
            <div className="absolute top-2 right-4 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1 flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
              <CheckCircle2 size={11} /> Visit Verified
            </div>
          )}
        </div>

        {/* 📢 Native Ad */}
        <div id="ad-native-1">
          <AdRenderer targetPage="Earn Rewards Page"
            placementKey="Native Slot 1"
            fallback={
              <div 
                onClick={() => handleAdClick(activeAd.url)}
                className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 cursor-pointer hover:border-slate-700 hover:bg-slate-900/80 transition-all shadow-md group relative"
              >
                <span className="absolute top-2 right-3 bg-slate-800 text-[9px] text-slate-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">Sponsored</span>
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="w-11 h-11 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center text-amber-500 font-black text-sm">
                    AD
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-200 group-hover:text-amber-400 flex items-center gap-1">
                      {activeAd.title} <ExternalLink size={12} className="opacity-70" />
                    </h3>
                    <p className="text-[10px] text-slate-500">Secure Partner Network</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {activeAd.desc}
                </p>
                <div className="mt-4 flex justify-end">
                  <span className="text-xs font-bold text-amber-500 group-hover:underline flex items-center gap-1">
                    {activeAd.cta} &rarr;
                  </span>
                </div>
              </div>
            }
          />
        </div>

        {/* 🖼 Banner Ad */}
        <div id="ad-banner-middle">
          <AdRenderer targetPage="Earn Rewards Page"
            placementKey="Banner Slot"
            fallback={
              <div 
                onClick={() => handleAdClick("https://stake.com")}
                className="bg-gradient-to-r from-purple-950/20 to-slate-900 border border-purple-500/20 rounded-xl p-4 cursor-pointer hover:border-purple-500/40 transition-all shadow-sm group relative overflow-hidden"
              >
                <span className="absolute top-1.5 right-2 bg-slate-800/80 text-[9px] text-slate-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider font-mono">Ad</span>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-600/20 flex items-center justify-center text-purple-400 font-extrabold text-xs border border-purple-500/30">
                    🎰
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-bold text-purple-400 flex items-center gap-1 group-hover:underline">
                      STAKE Casino & Betting <ExternalLink size={11} />
                    </h4>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                      Safe crypto casino & sportsbook. Double your deposit with promo code <strong className="text-amber-400 font-bold">ROYSHARE</strong>. Play now!
                    </p>
                  </div>
                </div>
              </div>
            }
          />
        </div>

        {/* 📢 Native Ad */}
        <div id="ad-native-2">
          <AdRenderer targetPage="Earn Rewards Page"
            placementKey="Native Slot 2"
            fallback={
              <div 
                onClick={() => handleAdClick(secondaryAd.url)}
                className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 cursor-pointer hover:border-slate-700 hover:bg-slate-900/80 transition-all shadow-md group relative"
              >
                <span className="absolute top-2 right-3 bg-slate-800 text-[9px] text-slate-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">Sponsored</span>
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="w-11 h-11 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400 font-black text-sm">
                    AD
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-200 group-hover:text-indigo-400 flex items-center gap-1">
                      {secondaryAd.title} <ExternalLink size={12} className="opacity-70" />
                    </h3>
                    <p className="text-[10px] text-slate-500">Premium Partner Network</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {secondaryAd.desc}
                </p>
                <div className="mt-4 flex justify-end">
                  <span className="text-xs font-bold text-indigo-400 group-hover:underline flex items-center gap-1">
                    {secondaryAd.cta} &rarr;
                  </span>
                </div>
              </div>
            }
          />
        </div>

        {/* 🖼 Footer Banner Ad */}
        <div id="ad-footer-banner">
          <AdRenderer targetPage="Earn Rewards Page"
            placementKey="Footer Banner"
            fallback={
              <div 
                onClick={() => handleAdClick("https://royshare.onrender.com")}
                className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 cursor-pointer hover:border-slate-700 hover:bg-slate-900/70 transition-all shadow-sm group relative"
              >
                <span className="absolute top-1.5 right-2 bg-slate-800 text-[8px] text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Ad</span>
                <p className="text-[11px] text-gray-300 leading-relaxed font-medium flex items-center gap-1.5">
                  <span>🚀 <strong>RoyShare Shortener:</strong> Shorten files or web URLs & get highest CPM rates! Join now.</span>
                  <ExternalLink size={10} className="text-slate-500 group-hover:text-slate-300 shrink-0" />
                </p>
              </div>
            }
          />
        </div>

      </div>

      {/* FOOTER & VERIFY SECTION */}
      <div className="max-w-lg w-full mx-auto mt-4 space-y-4">
        
        {/* ⚠️ Task Instructions */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 shadow-sm">
          <h3 className="text-sm font-bold text-amber-500 flex items-center gap-1.5 mb-2">
            <AlertTriangle size={15} /> ⚠️ Task Instructions
          </h3>
          <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4 font-medium leading-relaxed">
            <li>Open any advertisement.</li>
            <li>Stay on the advertisement page for at least 5 seconds.</li>
            <li>Then return back to continue.</li>
            <li>Complete all pages to receive your reward.</li>
          </ul>
        </div>

        {/* Action Button */}
        <AnimatePresence mode="wait">
          {isTimerFinished ? (
            <motion.button
              key="verify-btn"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              disabled={submitting}
              onClick={handleVerifyAndContinue}
              className={`w-full py-4 rounded-2xl font-bold shadow-lg text-lg transition-all duration-200 active:scale-98 flex items-center justify-center gap-2 ${
                submitting 
                  ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed" 
                  : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/20"
              }`}
              id="btn-verify-continue"
            >
              {submitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  <span>{currentPage === 3 ? "Verify & Complete Task" : "Verify & Continue"}</span>
                </>
              )}
            </motion.button>
          ) : (
            <motion.div
              key="disabled-btn-placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full py-4 bg-slate-900 border border-slate-800 text-slate-500 rounded-2xl font-bold flex items-center justify-center gap-2 cursor-not-allowed text-base select-none"
            >
              <Clock size={16} />
              <span>Complete timer to unlock verification</span>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

    </div>
  );
}
