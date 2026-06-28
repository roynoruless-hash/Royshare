import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, Play, Pause, RotateCcw, Volume2, VolumeX, ShieldCheck, AlertCircle, Sparkles, CheckCircle2, Zap, Award } from "lucide-react";
import { db } from "../lib/firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import AdScriptRenderer from "../components/AdScriptRenderer";
import AdRenderer from "../components/AdRenderer";

interface Task {
  id: string;
  name: string;
  amount: number;
  adNetwork?: string;
  selectedAdIds?: string[];
  description?: string;
  timerDuration?: string | number;
  totalPages?: string | number;
  timer?: string | number;
  title?: string;
}

export default function RewardTasksPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userName, setUserName] = useState("User");
  const [currency, setCurrency] = useState("INR");
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [botUsername, setBotUsername] = useState("RoyShareEarnBot");
  const [firestoreReadStatus, setFirestoreReadStatus] = useState("Pending");

  // Video State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(15); // Standard 15s video ad
  const [isMuted, setIsMuted] = useState(false);
  const [videoCompleted, setVideoCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isCompletedSuccess, setIsCompletedSuccess] = useState(false);

  const [videoSrc, setVideoSrc] = useState("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4");
  const [fallbackAttempts, setFallbackAttempts] = useState(0);
  const [isMonetagAdRunning, setIsMonetagAdRunning] = useState(false);
  const [monetagError, setMonetagError] = useState<string | null>(null);
  const [adWatchedSuccessfully, setAdWatchedSuccessfully] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [isTelegramApp, setIsTelegramApp] = useState(false);

  useEffect(() => {
    const checkTelegram = () => {
      const tg = (window as any).Telegram?.WebApp;
      
      // Improved Detection: Check for WebApp, initData, and user
      const hasTgWebApp = !!(tg && tg.initData && tg.initDataUnsafe?.user);
      setIsTelegramApp(hasTgWebApp);
      
      if (tg) {
        console.log("Telegram WebApp Version:", tg.version);
        console.log("Telegram Platform:", tg.platform);
        console.log("Telegram initData:", tg.initData);
        console.log("Telegram user:", tg.initDataUnsafe?.user);
        
        tg.ready();
        tg.expand();
      } else {
        console.log("Telegram WebApp not detected yet in RewardTasksPage");
      }
    };

    checkTelegram();
    // Retry once after 500ms to ensure SDK is fully initialized
    const retryTimer = setTimeout(checkTelegram, 500);

    return () => clearTimeout(retryTimer);
  }, []);

  const handleVideoError = () => {
    console.warn("Video failed to load in RewardTasksPage. Trying fallback...");
    const fallbacks = [
      "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      "https://www.w3schools.com/html/mov_bbb.mp4",
      "https://assets.mixkit.co/videos/preview/mixkit-starry-sky-and-milky-way-on-a-quiet-night-42211-large.mp4"
    ];
    if (fallbackAttempts < fallbacks.length) {
      setVideoSrc(fallbacks[fallbackAttempts]);
      setFallbackAttempts(prev => prev + 1);
    } else {
      console.error("All video fallbacks failed.");
    }
  };

  // Ad State
  const [videoAd, setVideoAd] = useState<any>(null);
  const [selectedAds, setSelectedAds] = useState<any[]>([]);
  const [adExecuted, setAdExecuted] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("userId");
    const queryTaskId = params.get("taskId");

    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.expand();
    }
    const tgUserId = tg?.initDataUnsafe?.user?.id;

    const resolvedUserId = queryUserId || (tgUserId ? String(tgUserId) : null);
    const resolvedTaskId = queryTaskId || null;

    if (resolvedUserId) setUserId(resolvedUserId);
    if (resolvedTaskId) setTaskId(resolvedTaskId);

    if (!resolvedUserId || !resolvedTaskId) {
      setError("Missing query parameters (userId and taskId are required).");
      setLoading(false);
    }
  }, []);

  // Fetch task, settings, and find active video ad
  useEffect(() => {
    if (!userId || !taskId) return;

    const initializePage = async () => {
      try {
        setLoading(true);
        // Fetch Settings & User Information
        const settingsRes = await fetch(`/api/earn-rewards/settings?userId=${userId}`);
        const data = await settingsRes.json();

        if (data.error) {
          setError(data.error);
          return;
        }

        setCurrency(data.currency || "INR");
        setUserName(data.userName || "User");
        setBotUsername(data.botUsername || "RoyShareEarnBot");

        let resolvedTask: Task | null = null;
        let firestoreReadStatusLocal = "Pending";

        try {
          const taskDocRef = doc(db, "tasks", taskId);
          const taskDocSnap = await getDoc(taskDocRef);
          if (taskDocSnap.exists()) {
            const tData = taskDocSnap.data();
            resolvedTask = {
              id: taskId,
              name: tData.title || tData.name || "",
              amount: Number(tData.rewardAmount) || Number(tData.amount) || 0,
              ...tData
            };
            firestoreReadStatusLocal = "Success";
          } else {
            firestoreReadStatusLocal = "Not Found in Firestore";
          }
        } catch (fErr: any) {
          console.error("Error reading task from Firestore directly:", fErr);
          firestoreReadStatusLocal = `Failed: ${fErr.message || fErr}`;
        }

        // Fallback to data.tasks
        if (!resolvedTask) {
          if (data.tasks && Array.isArray(data.tasks)) {
            data.tasks.forEach((t: Task) => {
              if (t.id === taskId) {
                resolvedTask = t;
              }
            });
          }
        }

        setFirestoreReadStatus(firestoreReadStatusLocal);

        if (resolvedTask) {
          setCurrentTask(resolvedTask);
          if ((data.completedTaskIds || []).includes(taskId)) {
            setError("You have already completed this task. Duplicate rewards are not allowed.");
            return;
          }

          // Set timer duration exactly from dynamic/saved config
          const savedDuration = resolvedTask.timerDuration ? Number(resolvedTask.timerDuration) : (resolvedTask.timer ? Number(resolvedTask.timer) : (data.timerDuration ? Number(data.timerDuration) : 30));
          if (savedDuration && !isNaN(savedDuration)) {
            setDuration(savedDuration);
          }
        } else {
          setError("Requested video reward task not found.");
          return;
        }

        // Fetch all Ads from Firestore
        const adsQuery = query(collection(db, "ads"));
        const adsSnap = await getDocs(adsQuery);
        const adsList: any[] = [];
        adsSnap.forEach(docSnap => {
          adsList.push({ id: docSnap.id, ...docSnap.data() });
        });

        const isAdActive = (ad: any) => {
          const statusStr = String(ad.status || "").toLowerCase();
          return statusStr.includes("active") || statusStr === "active";
        };

        // Populate selected ads specifically assigned to this task
        let taskSelectedAds: any[] = [];
        if (resolvedTask && (resolvedTask as Task).selectedAdIds && Array.isArray((resolvedTask as Task).selectedAdIds)) {
          const adsMap: Record<string, any> = {};
          adsList.forEach(ad => {
            if (ad && ad.id) {
              adsMap[ad.id] = ad;
            }
          });
          ((resolvedTask as Task).selectedAdIds || []).forEach((id, index) => {
            const matchedAd = adsMap[id];
            if (matchedAd) {
              taskSelectedAds.push({
                ...matchedAd,
                uniqueId: `${matchedAd.id}-${index}`
              });
            }
          });
        }
        setSelectedAds(taskSelectedAds);

        // Try to find an active video ad from the task's assigned ads
        let chosenAd: any = null;
        if (taskSelectedAds.length > 0) {
          taskSelectedAds.forEach(ad => {
            const t = String(ad.adType || "").toLowerCase();
            if (t.includes("video") || t.includes("vast") || t.includes("stream") || t.includes("slider")) {
              if (!chosenAd) {
                chosenAd = ad;
              }
            }
          });
        }

        // If no video ad is found inside the task-assigned ads, search globally
        if (!chosenAd) {
          const activeVideoAds = adsList.filter(ad => 
            isAdActive(ad) && 
            (ad.adType === "VAST Video Ad" || ad.adType === "VAST Video" || ad.adType === "In-stream Video" || ad.adType === "Video Slider") && 
            (ad.placement === "Video Slot" || ad.placement === "Video Slot")
          );

          // Fallback Order: Adsterra -> Monetag
          activeVideoAds.forEach(ad => {
            if (ad.adSource === "Adsterra" && !chosenAd) {
              chosenAd = ad;
            }
          });
          if (!chosenAd) {
            activeVideoAds.forEach(ad => {
              if (ad.adSource === "Monetag" && !chosenAd) {
                chosenAd = ad;
              }
            });
          }
        }

        if (chosenAd) {
          setVideoAd(chosenAd);
        }
      } catch (err) {
        console.error("Error setting up Video Task Page:", err);
        setError("Connection error. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    initializePage();
  }, [userId, taskId]);

  // Video playback progress simulation
  useEffect(() => {
    if (isPlaying && currentTime < duration) {
      timerRef.current = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= duration - 1) {
            clearInterval(timerRef.current);
            setIsPlaying(false);
            setVideoCompleted(true);
            return duration;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, currentTime, duration]);

  const handlePlayPause = () => {
    if (videoCompleted) return;
    setIsPlaying(!isPlaying);
    setAdExecuted(true);
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(console.error);
      }
    }
  };

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
  };

  const handleRestart = () => {
    setCurrentTime(0);
    setVideoCompleted(false);
    setIsPlaying(true);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(console.error);
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
      // Pass the taskId as request_var to Monetag for server-side verification
      if (typeof (window as any).show_11210088 === 'function') {
        await (window as any).show_11210088({ request_var: taskId });
      } else {
        await (window as any).show_11210088();
      }
      
      setAdWatchedSuccessfully(true);
      setShowSuccessPopup(true);
      // Automatically hide popup after 3 seconds
      setTimeout(() => setShowSuccessPopup(false), 3000);
    } catch (err: any) {
      console.error("Monetag ad error:", err);
      setMonetagError("Please watch the complete advertisement to unlock your reward.");
    } finally {
      setIsMonetagAdRunning(false);
    }
  };

  const handleClaimMonetagReward = async () => {
    if (!adWatchedSuccessfully || videoCompleted || submitting) return;
    
    // Instead of directly crediting, we check if the postback has arrived
    setSubmitting(true);
    setMonetagError(null);
    
    try {
      const res = await fetch(`/api/earn-rewards/check-status?userId=${userId}&taskId=${taskId}`);
      const data = await res.json();
      
      if (data.completed) {
        setVideoCompleted(true);
        setCurrentTime(duration);
        setIsCompletedSuccess(true);
      } else {
        setMonetagError("Verification pending. Please wait a few seconds and try again.");
      }
    } catch (err) {
      setMonetagError("Failed to check verification status.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitTaskCompletion = async () => {
    if (!userId || !taskId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/earn-rewards/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, taskId })
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setIsCompletedSuccess(true);
        // Automatically redirect to Telegram Bot after 3s
        setTimeout(() => {
          window.location.href = `https://t.me/${botUsername}`;
        }, 3000);
      }
    } catch (err) {
      console.error("Error completing task:", err);
      setError("Failed to verify video completion.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToBot = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.close();
    } else {
      window.close();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0f19] text-white p-6">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-400 font-medium">Initializing Reward Video Player...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0f19] text-white p-6 text-center">
        <div className="w-16 h-16 bg-red-950/50 border border-red-500/30 rounded-2xl flex items-center justify-center mb-6 text-red-500">
          <AlertCircle size={36} />
        </div>
        <h2 className="text-2xl font-bold mb-3 text-red-400">Action Blocked</h2>
        <p className="text-gray-400 max-w-md mb-8 leading-relaxed">{error}</p>
        <button
          onClick={handleBackToBot}
          className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-semibold transition-all duration-200"
        >
          Return to Telegram Bot
        </button>
      </div>
    );
  }

  if (isCompletedSuccess && currentTask) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b0f19] text-white p-6 text-center relative overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-emerald-500/20 blur-[80px] rounded-full pointer-events-none"></div>
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full bg-slate-900/80 border border-emerald-500/20 backdrop-blur-md rounded-3xl p-8 shadow-2xl relative"
        >
          <div className="w-20 h-20 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-6 text-emerald-400">
            <CheckCircle2 size={44} />
          </div>
          <h2 className="text-3xl font-extrabold text-emerald-400 mb-2">✅ Task Completed</h2>
          <p className="text-gray-300 font-semibold mb-6 text-base">Reward credited successfully.</p>
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 mb-8 max-w-sm mx-auto">
            <p className="text-gray-400 text-xs uppercase tracking-wider font-bold mb-1">💰 Reward Earned</p>
            <p className="text-4xl font-black text-amber-400 tracking-tight">
              {currency === "USD" ? `$${(currentTask.amount * 0.0118).toFixed(2)}` : `₹${currentTask.amount.toFixed(2)}`}
            </p>
          </div>
          <button
            onClick={() => window.location.href = `https://t.me/${botUsername}`}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 text-lg"
          >
            🤖 Return To Telegram Bot
          </button>
        </motion.div>
      </div>
    );
  }

  const renderedAds = selectedAds;
  const totalSelectedAds = selectedAds.length;
  const totalRenderedAds = renderedAds.length;
  const selectedAdIds = selectedAds.map(ad => ad.id);
  const renderedAdIds = renderedAds.map(ad => ad.id);

  if (currentTask?.adNetwork === 'Monetag Mini App') {
    if (!isTelegramApp) {
      return (
        <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col items-center justify-center py-6 px-4 text-center">
          <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mb-6 text-amber-500">
            <AlertCircle size={40} />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Mini App Required</h1>
          <p className="text-slate-400 max-w-xs mb-8">
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
      <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col items-center justify-center py-6 px-4">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-blue-500/10 blur-[100px] rounded-full pointer-events-none"></div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full space-y-10 text-center relative"
        >
          {/* Task Info */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-[10px] font-bold uppercase tracking-widest mx-auto">
              <Zap size={12} className="fill-current" />
              <span>Premium Rewarded Task</span>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight leading-tight">
              {currentTask?.name || currentTask?.title || "Watch Video Task"}
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed max-w-[320px] mx-auto">
              {currentTask?.description || "Watch a short sponsored video to unlock your reward coins instantly."}
            </p>
          </div>

          {/* Reward Amount */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-[2.5rem] p-10 relative overflow-hidden group shadow-2xl">
             <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <Award size={120} />
             </div>
             <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px] mb-3">Total Reward Points</p>
             <p className="text-6xl font-black text-amber-400 drop-shadow-sm">
               {currency === "USD" ? `$${(currentTask.amount * 0.0118).toFixed(2)}` : `₹${currentTask.amount.toFixed(2)}`}
             </p>
             <div className="mt-4 flex items-center justify-center gap-1.5 text-emerald-400 text-xs font-bold">
               <ShieldCheck size={14} />
               <span>Verified by Monetag SDK</span>
             </div>
          </div>

          {/* Claim Button */}
          <div className="pt-2">
            {!adWatchedSuccessfully ? (
              <button
                onClick={handleWatchMonetagAd}
                disabled={isMonetagAdRunning || submitting}
                className={`w-full py-6 rounded-[2rem] font-black transition-all shadow-2xl flex flex-col items-center justify-center gap-2 text-2xl active:scale-95 group relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white shadow-blue-900/40`}
              >
                {isMonetagAdRunning ? (
                  <>
                    <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin mb-1" />
                    <span>Loading Ad...</span>
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.15, 1], rotate: [0, 5, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <Play size={32} className="fill-current text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
                    </motion.div>
                    <span>Watch Ad</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleClaimMonetagReward}
                disabled={videoCompleted || submitting}
                className={`w-full py-6 rounded-[2rem] font-black transition-all shadow-2xl flex flex-col items-center justify-center gap-2 text-2xl active:scale-95 group relative overflow-hidden ${
                  videoCompleted 
                    ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 cursor-default" 
                    : "bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-amber-900/40"
                }`}
              >
                {videoCompleted ? (
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
                      <Zap size={32} className="fill-current text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
                    </motion.div>
                    <span>Claim Reward</span>
                  </>
                )}
              </button>
            )}

            {/* Status & Errors */}
            <div className="h-6 mt-4">
              <AnimatePresence mode="wait">
                {monetagError ? (
                  <motion.p 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="text-red-400 text-sm font-bold flex items-center justify-center gap-1.5"
                  >
                    <AlertCircle size={14} /> {monetagError}
                  </motion.p>
                ) : videoCompleted ? (
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
                  <p className="text-slate-500 text-xs font-medium uppercase tracking-widest opacity-60">
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

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-100 flex flex-col justify-between py-6 px-4">
      {/* Top Details Header */}
      <div className="max-w-xl w-full mx-auto bg-slate-900/60 border border-slate-800 rounded-2xl p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles size={18} className="text-amber-400" />
              <span>{currentTask?.name || currentTask?.title || "Watch Video Task"}</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">{currentTask?.description || ""}</p>
            {currentTask?.totalPages && (
              <p className="text-[11px] text-indigo-400 font-semibold mt-1">
                Pages Count: {currentTask.totalPages}
              </p>
            )}
          </div>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-1.5 text-right shrink-0">
            <p className="text-[9px] text-amber-500 font-bold uppercase tracking-wider">REWARD</p>
            <p className="text-sm font-black text-amber-400">
              {currentTask ? (currency === "USD" ? `$${(currentTask.amount * 0.0118).toFixed(2)}` : `₹${currentTask.amount.toFixed(2)}`) : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Video Arena */}
      <div className="max-w-xl w-full mx-auto flex-1 flex flex-col justify-center my-4 space-y-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
          
          {/* Header of Video Container */}
          <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800/60 flex justify-between items-center text-xs text-slate-400 font-semibold">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${videoCompleted ? 'bg-emerald-500' : isPlaying ? 'bg-amber-500 animate-pulse' : 'bg-slate-500'}`}></span>
              {videoCompleted ? 'Video Finished' : isPlaying ? 'Playing Sponsored Ad...' : 'Ready to play'}
            </span>
            <span>Ad Network: <span className="text-blue-400">{videoAd?.adSource || 'Adsterra'}</span></span>
          </div>

          {/* Video Frame */}
          {currentTask?.adNetwork === 'Monetag Mini App' ? (
            <div className="aspect-video bg-slate-950 flex items-center justify-center p-8">
              <div className="text-center space-y-6">
                <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto text-blue-400">
                  <Play size={32} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-white">Watch Rewarded Ad</h3>
                  <p className="text-sm text-slate-400">Complete the short ad to claim your reward coins.</p>
                </div>
                {!adWatchedSuccessfully ? (
                  <button
                    onClick={handleWatchMonetagAd}
                    disabled={isMonetagAdRunning || submitting}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 text-lg active:scale-95"
                  >
                    {isMonetagAdRunning ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Ad is Running...</span>
                      </>
                    ) : (
                      <>
                        <Play size={20} />
                        <span>Watch Ad Now</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleClaimMonetagReward}
                    disabled={videoCompleted || submitting}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-2xl font-bold transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 text-lg active:scale-95"
                  >
                    {videoCompleted ? (
                      <>
                        <CheckCircle2 size={24} />
                        <span>Reward Credited</span>
                      </>
                    ) : submitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Claiming...</span>
                      </>
                    ) : (
                      <>
                        <Zap size={20} className="fill-current" />
                        <span>Claim Reward Coins</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          ) : videoAd && (videoAd.adType === 'VAST Video Ad' || videoAd.adType === 'VAST Video') ? (
            <div className="p-4 flex justify-center bg-slate-950">
              <AdScriptRenderer 
                scriptCode={videoAd.scriptCode} 
                adType={videoAd.adType}
                onStatusChange={(status, message, diagnostics) => {
                  if (status === 'Loaded' || message?.includes('Completed') || diagnostics?.adCompleted === 'Yes') {
                    setVideoCompleted(true);
                    setCurrentTime(duration);
                  }
                }}
              />
            </div>
          ) : (
            <>
              <div className="aspect-video bg-black relative flex items-center justify-center group overflow-hidden">
                {/* Standard Premium HD Video (nature, dynamic background or preview placeholder) */}
                <video 
                  ref={videoRef}
                  src={videoSrc}
                  className="w-full h-full object-cover"
                  loop={false}
                  playsInline
                  onClick={handlePlayPause}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onError={handleVideoError}
                />

                {/* Immersive Play/Pause/Completed Overlay */}
                <AnimatePresence>
                  {!isPlaying && !videoCompleted && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center cursor-pointer p-4 text-center"
                      onClick={handlePlayPause}
                    >
                      <div className="w-16 h-16 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105">
                        <Play size={28} className="ml-1" />
                      </div>
                      <p className="text-sm font-extrabold text-white mt-4">Click to Play Sponsor's Video</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs">You must watch the full {duration}-second duration to receive points.</p>
                    </motion.div>
                  )}

                  {videoCompleted && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center p-4 text-center"
                    >
                      <div className="w-16 h-16 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg">
                        <ShieldCheck size={32} />
                      </div>
                      <p className="text-base font-extrabold text-emerald-400 mt-4">Ad View Complete!</p>
                      <p className="text-xs text-slate-300 mt-1">Verification unlocked. Claim your rewards below.</p>
                      <button 
                        onClick={handleRestart}
                        className="mt-4 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                      >
                        <RotateCcw size={12} /> Watch Again
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Custom Interactive Player Bar */}
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-slate-950 to-transparent flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button onClick={handlePlayPause} className="text-white hover:text-amber-400 transition-colors">
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  </button>

                  <div className="flex-1 mx-4">
                    <div className="h-1 bg-white/20 rounded-full relative overflow-hidden">
                      <div 
                        className="absolute top-0 bottom-0 left-0 bg-amber-500 transition-all duration-300"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-white/90">
                      {currentTime}s / {duration}s
                    </span>
                    <button onClick={handleMuteToggle} className="text-white hover:text-amber-400 transition-colors">
                      {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Video progress indicator underneath */}
              <div className="p-4 bg-slate-950/40 border-t border-slate-800/40 flex flex-col gap-3">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-400">Viewing Progress:</span>
                  <span className={videoCompleted ? 'text-emerald-400' : 'text-amber-400'}>
                    {Math.floor((currentTime / duration) * 100)}% ({currentTime}s / {duration}s)
                  </span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div 
                    className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full transition-all duration-500 rounded-full" 
                    style={{ width: `${(currentTime / duration) * 100}%` }}
                  ></div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 🖼 Header banner space */}
        <div className="w-full">
          <AdRenderer targetPage="Reward Tasks Page" placementKey="Header Banner" />
        </div>

        {/* Dynamic task-specific selected ads */}
        {selectedAds.length > 0 && (
          <div className="space-y-4">
            {selectedAds.map(ad => (
              <div key={ad.uniqueId || ad.id} className="w-full bg-slate-900/40 border border-slate-800/40 rounded-2xl p-4">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1">
                  <span>Sponsored Ad ({ad.adSource} - {ad.adType})</span>
                </p>
                <div className="flex justify-center items-center overflow-hidden w-full">
                  {ad.adType === "Direct Link" || ad.adType === "Direct Link Ad" ? (
                    <a 
                      href={ad.scriptCode} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600/80 to-indigo-600/80 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all shadow-md"
                    >
                      🚀 Visit Sponsor Link ({ad.adName})
                    </a>
                  ) : (
                    <AdScriptRenderer scriptCode={ad.scriptCode} adType={ad.adType} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Diagnostics block */}
        <div id="reward-task-ad-diagnostics" className="p-4 bg-slate-950/60 border border-slate-850 rounded-2xl font-mono text-xs text-slate-400 mt-4 space-y-1.5 shadow-inner">
          <div className="text-slate-500 font-bold uppercase tracking-wider text-[10px] mb-2">🔍 AD RENDERING DIAGNOSTICS</div>
          <div>Saved Task ID = <span className="text-blue-400 font-bold">{taskId || 'None'}</span></div>
          <div>Selected Ads Count = <span className="text-amber-400 font-bold">{totalSelectedAds}</span></div>
          <div>Rendered Ads Count = <span className="text-emerald-400 font-bold">{totalRenderedAds}</span></div>
          <div className="break-all">Selected Ad IDs = <span className="text-blue-400 font-medium">{selectedAdIds.join(', ') || 'None'}</span></div>
          <div className="break-all">Rendered Ad IDs = <span className="text-blue-400 font-medium">{renderedAdIds.join(', ') || 'None'}</span></div>
          {totalRenderedAds < totalSelectedAds && (
            <div className="text-red-400">Rendering Mismatch Reason = <span>Rendered count ({totalRenderedAds}) is less than Selected count ({totalSelectedAds})</span></div>
          )}
          <div>Saved Timer = <span className="text-blue-400">{currentTask?.timerDuration || currentTask?.timer || 'None'}</span></div>
          <div>Loaded Timer = <span className="text-blue-400">{duration}</span></div>
          <div className="break-words">Saved Instructions = <span className="text-blue-400">{currentTask?.description || 'None'}</span></div>
          <div className="break-words">Loaded Instructions = <span className="text-blue-400">{currentTask?.description || 'None'}</span></div>
          <div>Firestore Read Status = <span className="text-emerald-400 font-bold">{firestoreReadStatus}</span></div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="max-w-xl w-full mx-auto mt-4 space-y-4">
        {videoCompleted ? (
          <button
            disabled={submitting}
            onClick={submitTaskCompletion}
            className={`w-full py-4 rounded-2xl font-bold shadow-lg text-lg transition-all active:scale-98 flex items-center justify-center gap-2 ${
              submitting 
                ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed" 
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/20"
            }`}
          >
            {submitting ? (
              <>
                <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                <span>Verifying and Crediting...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} />
                <span>Claim Reward Coins</span>
              </>
            )}
          </button>
        ) : (
          <div className="w-full py-4 bg-slate-900/60 border border-slate-800/40 text-slate-500 rounded-2xl font-bold flex items-center justify-center gap-2 cursor-not-allowed text-base select-none">
            <Clock size={16} className="animate-spin" />
            <span>Complete Video Playback To Unlock Reward</span>
          </div>
        )}
      </div>
    </div>
  );
}
