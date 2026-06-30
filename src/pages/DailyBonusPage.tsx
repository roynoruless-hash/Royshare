import { useState, useEffect } from "react";
import { API_BASE } from "../config/api";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Disc, RotateCw, AlertTriangle, ArrowLeft, Clock, CheckCircle, ShieldCheck, Star } from "lucide-react";
import AdRenderer from "../components/AdRenderer";

// Reward wheel sectors
const REWARDS = [
  { amount: 0.10, label: "₹0.10" },
  { amount: 0.20, label: "₹0.20" },
  { amount: 0.50, label: "₹0.50" },
  { amount: 1.00, label: "₹1.00" },
  { amount: 2.00, label: "₹2.00" },
  { amount: 5.00, label: "₹5.00" }
];

export default function DailyBonusPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [remainingSpins, setRemainingSpins] = useState<number>(0);
  const [dailySpinCount, setDailySpinCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [currency, setCurrency] = useState<string>("INR");

  // Dynamic Settings states loaded from Firestore settings
  const [rewards, setRewards] = useState<{ amount: number; label: string }[]>([]);
  const [claimTimerConfig, setClaimTimerConfig] = useState<number>(25);
  const [freeSpinsPerDayConfig, setFreeSpinsPerDayConfig] = useState<number>(3);
  const [dailyBonusEnabled, setDailyBonusEnabled] = useState<boolean>(true);

  const formatCurrency = (amount: number) => {
    if (currency === "USD") {
      const usd = amount * 0.0118;
      if (usd < 0.01) {
        return `$${usd.toFixed(4)}`;
      }
      return `$${usd.toFixed(2)}`;
    }
    return `₹${amount.toFixed(2)}`;
  };
  
  // Wheel State
  const [rotation, setRotation] = useState<number>(0);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [wonReward, setWonReward] = useState<number | null>(null);
  const [showCongratsPopup, setShowCongratsPopup] = useState<boolean>(false);

  // Verification Screen State
  const [isVerificationPage, setIsVerificationPage] = useState<boolean>(false);
  const [timer, setTimer] = useState<number>(25);
  const [isTimerCompleted, setIsTimerCompleted] = useState<boolean>(false);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [isClaimedSuccess, setIsClaimedSuccess] = useState<boolean>(false);

  useEffect(() => {
    // Determine User ID
    const params = new URLSearchParams(window.location.search);
    const queryUserId = params.get("userId");
    
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.expand();
    }
    const tgUserId = tg?.initDataUnsafe?.user?.id;

    const resolvedId = queryUserId || (tgUserId ? String(tgUserId) : null);
    if (resolvedId) {
      setUserId(resolvedId);
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Fetch initial status from Firestore backend
    fetch(`${API_BASE}/api/daily-bonus/status?userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        console.log("================= DAILY BONUS STATUS TRACE (FRONTEND) =================");
        console.log("[DB STATUS] Response from server:", data);
        
        if (data && data.remainingSpins !== undefined) {
          setRemainingSpins(data.remainingSpins);
          setDailySpinCount(data.dailySpinCount);
        }
        if (data && data.currency) {
          setCurrency(data.currency);
        }
        if (data && data.settings) {
          const activeRewards = (data.settings.rewardList || [])
            .filter((r: any) => r.status === "Active")
            .map((r: any) => ({
              amount: Number(r.amount),
              label: `₹${Number(r.amount).toFixed(2)}`
            }));
          
          console.log("[DB STATUS] Active dynamic rewards loaded:", activeRewards);
          
          if (activeRewards.length > 0) {
            setRewards(activeRewards);
          } else {
            console.warn("[DB STATUS] No active rewards found in Firestore, using dynamic wheel fallback.");
            setRewards([
              { amount: 0.10, label: "₹0.10" },
              { amount: 0.20, label: "₹0.20" },
              { amount: 0.50, label: "₹0.50" },
              { amount: 1.00, label: "₹1.00" },
              { amount: 2.00, label: "₹2.00" },
              { amount: 5.00, label: "₹5.00" }
            ]);
          }

          setClaimTimerConfig(Number(data.settings.claimTimer ?? 25));
          setTimer(Number(data.settings.claimTimer ?? 25));
          setFreeSpinsPerDayConfig(Number(data.settings.freeSpinsPerDay ?? 3));
          setDailyBonusEnabled(data.settings.dailyBonusEnabled ?? true);

          console.log(`[DB STATUS] Loaded config values: enabled=${data.settings.dailyBonusEnabled}, spinsPerDay=${data.settings.freeSpinsPerDay}, claimTimer=${data.settings.claimTimer}s`);
        }
        console.log("=======================================================================");
      })
      .catch(err => {
        console.error("Error loading daily bonus state:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [userId]);

  // Handle verification timer
  useEffect(() => {
    if (!isVerificationPage || timer <= 0) {
      if (isVerificationPage && timer === 0) {
        setIsTimerCompleted(true);
      }
      return;
    }
    const interval = setInterval(() => {
      setTimer(prev => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isVerificationPage, timer]);

  const handleSpin = async () => {
    if (isSpinning || remainingSpins <= 0 || !userId) return;

    setIsSpinning(true);
    const randomIndex = Math.floor(Math.random() * REWARDS.length);
    const selectedReward = REWARDS[randomIndex];

    // Landing target: we want the pointer at top to point to selected index
    // sector i is centered at (i * 60 + 30) deg. 
    // Wheel stops with sector at top when finalRotation is 360 * spins - (i * 60 + 30).
    const newRotation = rotation + (360 * 6) - (rotation % 360) - (randomIndex * 60 + 30);
    setRotation(newRotation);

    try {
      // Backend spin deduction
      const res = await fetch(`${API_BASE}/api/daily-bonus/spin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, rewardAmount: selectedReward.amount })
      });
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || "Spin failed");
        setIsSpinning(false);
        return;
      }

      // Wait for spin animation (5 seconds)
      setTimeout(() => {
        setWonReward(selectedReward.amount);
        setRemainingSpins(data.remainingSpins);
        setDailySpinCount(data.dailySpinCount);
        setShowCongratsPopup(true);
        setIsSpinning(false);
      }, 5000);

    } catch (err) {
      console.error("Error spinning wheel:", err);
      setIsSpinning(false);
    }
  };

  const handleClaimReward = () => {
    setShowCongratsPopup(false);
    setIsVerificationPage(true);
    setTimer(25);
    setIsTimerCompleted(false);
  };

  const handleClaimBonus = async () => {
    if (isClaiming || !userId || wonReward === null) return;
    setIsClaiming(true);

    try {
      const res = await fetch(`${API_BASE}/api/daily-bonus/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          rewardAmount: wonReward,
          remainingSpins,
          dailySpinCount
        })
      });
      const data = await res.json();
      if (res.ok) {
        setIsClaimedSuccess(true);
      } else {
        alert(data.error || "Failed to claim reward");
      }
    } catch (err) {
      console.error("Claim error:", err);
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCloseWebApp = () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.close();
    } else {
      window.close();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white font-sans p-6">
        <Disc className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-slate-400">Loading Daily Bonus wheel...</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white font-sans p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-slate-400 max-w-sm mb-6">
          Please open this page directly from the RoyShare Telegram Bot menu to access your daily spins.
        </p>
        <button
          onClick={handleCloseWebApp}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 transition rounded-full text-sm font-semibold"
        >
          Close
        </button>
      </div>
    );
  }

  // Render claimed success screen
  if (isClaimedSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 text-white font-sans p-6 flex flex-col items-center justify-center text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-slate-900 border border-emerald-500/30 p-8 rounded-3xl max-w-sm w-full shadow-2xl relative overflow-hidden"
        >
          {/* Sparkle background effects */}
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-teal-500" />
          
          <CheckCircle className="w-20 h-20 text-emerald-400 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(52,211,153,0.3)]" />
          
          <h1 className="text-2xl font-bold mb-3 text-emerald-300">🎉 Bonus Claimed!</h1>
          <p className="text-slate-300 text-sm mb-6 leading-relaxed">
            Your reward of <span className="font-extrabold text-white text-lg">{formatCurrency(wonReward || 0)}</span> has been successfully credited to your RoyShare balance.
          </p>
          
          <div className="bg-slate-950/60 rounded-2xl p-4 mb-6 border border-slate-800 text-left text-xs text-slate-400 space-y-2">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="font-semibold text-emerald-400">Success</span>
            </div>
            <div className="flex justify-between">
              <span>Remaining Spins:</span>
              <span className="font-semibold text-white">{remainingSpins} / 3</span>
            </div>
          </div>

          <div className="space-y-3">
            {remainingSpins > 0 ? (
              <button
                onClick={() => {
                  setIsVerificationPage(false);
                  setIsTimerCompleted(false);
                  setIsClaimedSuccess(false);
                  setWonReward(null);
                }}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 transition-all rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/20"
              >
                🔄 Spin Again
              </button>
            ) : null}
            
            <button
              onClick={handleCloseWebApp}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 transition rounded-xl font-semibold text-sm text-slate-300"
            >
              🚪 Close Daily Bonus
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Render verification page
  if (isVerificationPage) {
    return (
      <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col">
        {/* Top Header Section with Timer */}
        <div className="p-4 border-b border-slate-900 bg-slate-900/60 sticky top-0 z-10 flex flex-col items-center">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-indigo-400 animate-pulse" />
            <span className="text-sm text-slate-400 font-semibold tracking-wide uppercase">Reward Unlock Timer</span>
          </div>
          
          <div className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400 font-mono">
            {timer > 0 ? `${timer} Seconds` : "✅ Ready to Claim"}
          </div>
        </div>

        {/* Content Box containing Ads */}
        <div className="flex-1 max-w-md mx-auto w-full p-4 space-y-4">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-xl">
            <h2 className="text-center font-semibold text-slate-300 text-sm mb-4 tracking-wider uppercase">
              🛡️ Sponsor Verification
            </h2>
            
            <p className="text-xs text-slate-400 text-center mb-6">
              Complete verification to release your reward. Please view the sponsors below while the unlock timer counts down.
            </p>

            <div className="space-y-5">
              {/* Native Ad Slot 1 */}
              <AdRenderer targetPage="Daily Bonus Page"
                placementKey="Native Slot 1" 
                fallback={
                  <div className="bg-slate-950 rounded-xl p-4 border border-indigo-500/20 shadow-md hover:border-indigo-500/30 transition">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 bg-indigo-600/20 rounded-xl flex items-center justify-center text-indigo-400 font-bold border border-indigo-500/30 shrink-0">
                        RS
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-indigo-400 font-bold tracking-wider uppercase">Ad • Sponsored</span>
                          <div className="flex text-amber-400">
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                          </div>
                        </div>
                        <h3 className="text-sm font-bold text-white mt-1">RoyShare Fast Downloader</h3>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          Download files up to 5x faster with the official RoyShare client! Fast, free, and secure.
                        </p>
                      </div>
                    </div>
                    <button className="w-full mt-3 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 transition rounded-lg text-xs font-bold text-indigo-400 border border-indigo-500/20">
                      ⚡ Install Now
                    </button>
                  </div>
                }
              />

              {/* Native Ad Slot 2 */}
              <AdRenderer targetPage="Daily Bonus Page"
                placementKey="Native Slot 2"
                fallback={
                  <div className="bg-slate-950 rounded-xl p-4 border border-purple-500/20 shadow-md hover:border-purple-500/30 transition">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 bg-purple-600/20 rounded-xl flex items-center justify-center text-purple-400 font-bold border border-purple-500/30 shrink-0">
                        BTC
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-purple-400 font-bold tracking-wider uppercase">Ad • Sponsored</span>
                          <div className="flex text-amber-400">
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current" />
                            <Star className="w-3 h-3 fill-current text-slate-700" />
                          </div>
                        </div>
                        <h3 className="text-sm font-bold text-white mt-1">Free Crypto Faucet</h3>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          Stake and earn up to 15% APY on stable USDT. Zero hidden platform fees. Instant claims.
                        </p>
                      </div>
                    </div>
                    <button className="w-full mt-3 py-2 bg-purple-600/10 hover:bg-purple-600/20 transition rounded-lg text-xs font-bold text-purple-400 border border-purple-500/20">
                      🎁 Claim Free Crypto
                    </button>
                  </div>
                }
              />

              {/* Banner Ad Slot 1 */}
              <AdRenderer targetPage="Daily Bonus Page"
                placementKey="Banner Slot"
                fallback={
                  <div className="bg-gradient-to-r from-slate-950 to-slate-900 rounded-xl p-3 border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Banner Ad Slot 1</span>
                    <p className="text-xs text-slate-300 font-medium">
                      🌐 Need cloud hosting? Get 3 months free VPS on signup!
                    </p>
                  </div>
                }
              />

              {/* Banner Ad Slot 2 */}
              <AdRenderer targetPage="Daily Bonus Page"
                placementKey="Secondary Banner"
                fallback={
                  <div className="bg-gradient-to-r from-slate-900 to-slate-950 rounded-xl p-3 border border-slate-800 text-center">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block mb-1">Banner Ad Slot 2</span>
                    <p className="text-xs text-slate-300 font-medium">
                      📱 Join the official Telegram news channel for instant updates.
                    </p>
                  </div>
                }
              />
            </div>
          </div>
        </div>

        {/* Bottom Claim Control Bar */}
        <div className="p-4 bg-slate-900/60 border-t border-slate-900 sticky bottom-0">
          <div className="max-w-md mx-auto">
            {isTimerCompleted ? (
              <div className="space-y-3">
                <div className="text-center text-sm font-semibold text-emerald-400 flex items-center justify-center gap-1.5">
                  <ShieldCheck className="w-5 h-5" />
                  <span>Verification Complete! Reward unlocked.</span>
                </div>
                <button
                  onClick={handleClaimBonus}
                  disabled={isClaiming}
                  className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:scale-[0.98] transition-all rounded-2xl font-bold text-md text-white shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                >
                  {isClaiming ? (
                    <>
                      <RotateCw className="w-5 h-5 animate-spin" />
                      <span>Crediting Reward...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      <span>✅ Claim Bonus</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <button
                disabled
                className="w-full py-4 bg-slate-800 rounded-2xl font-bold text-md text-slate-500 flex items-center justify-center gap-2 cursor-not-allowed"
              >
                <Clock className="w-5 h-5 animate-spin" />
                <span>Waiting for Timer ({timer}s)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render primary wheel screen
  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col justify-between">
      {/* Top Header Section */}
      <div className="p-4 border-b border-slate-900 bg-slate-900/60 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-600/20 rounded-lg text-indigo-400">
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white tracking-wide">🎁 RoyShare Daily Bonus</h1>
              <p className="text-xs text-slate-400">Wheel of Fortune</p>
            </div>
          </div>

          <button
            onClick={handleCloseWebApp}
            className="p-2 bg-slate-900 hover:bg-slate-800 transition rounded-xl text-xs font-semibold text-slate-300"
          >
            Close
          </button>
        </div>
      </div>

      {/* Main Wheel Viewport */}
      <div className="flex-1 max-w-md mx-auto w-full p-4 flex flex-col justify-center items-center space-y-6">
        {/* Top Ad Banner */}
        <AdRenderer targetPage="Daily Bonus Page"
          placementKey="Header Banner"
          fallback={
            <div className="w-full bg-gradient-to-r from-slate-900 to-indigo-950/40 rounded-xl p-3 border border-indigo-950/60 shadow text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-indigo-600/30 text-[9px] font-bold text-indigo-300 px-2 py-0.5 rounded-bl">AD</div>
              <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block mb-0.5">Header Banner Area</span>
              <p className="text-xs font-semibold text-white">
                🚀 Upgrade to premium to enjoy unlimited bandwidth & zero banner ads!
              </p>
            </div>
          }
        />

        {/* Spins Remaining Count */}
        <div className="bg-slate-900/80 border border-slate-800/60 px-5 py-2.5 rounded-full text-sm font-semibold tracking-wide flex items-center gap-2 text-indigo-300">
          <span>🎡 Free Spins Remaining Today:</span>
          <span className="text-white font-bold text-base px-2 py-0.5 bg-indigo-600/40 rounded-full font-mono">
            {remainingSpins} / 3
          </span>
        </div>

        {remainingSpins > 0 ? (
          /* Wheel spin UI */
          <div className="flex flex-col items-center space-y-8 py-4">
            <div className="relative">
              {/* Pointer */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-rose-500 z-10 drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]" />

              {/* Rotatable wheel */}
              <div
                className="relative w-72 h-72 rounded-full border-[8px] border-indigo-600 shadow-2xl overflow-hidden"
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: isSpinning ? "transform 5000ms cubic-bezier(0.25, 0.1, 0.25, 1)" : "none",
                  background: 'conic-gradient(#4f46e5 0deg 60deg, #7c3aed 60deg 120deg, #9333ea 120deg 180deg, #c084fc 180deg 240deg, #2563eb 240deg 300deg, #3b82f6 300deg 360deg)'
                }}
              >
                {REWARDS.map((reward, i) => (
                  <div
                    key={i}
                    className="absolute top-0 left-0 w-full h-full flex items-start justify-center"
                    style={{
                      transform: `rotate(${i * 60 + 30}deg)`,
                      transformOrigin: '50% 50%',
                    }}
                  >
                    <span className="mt-10 font-black text-white text-[11px] select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] tracking-wide">
                      {formatCurrency(reward.amount)}
                    </span>
                  </div>
                ))}
                
                {/* Central Circle Button Cap */}
                <div className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-white border-[5px] border-indigo-600 shadow-xl flex items-center justify-center">
                  <div className="w-5 h-5 rounded-full bg-indigo-600 animate-pulse" />
                </div>
              </div>
            </div>

            <button
              onClick={handleSpin}
              disabled={isSpinning || remainingSpins <= 0}
              className={`w-48 py-4 rounded-2xl font-black text-lg tracking-wider uppercase transition shadow-xl ${
                isSpinning
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 active:scale-95 text-white shadow-rose-500/10"
              }`}
            >
              {isSpinning ? "Spinning..." : "SPIN WHEEL"}
            </button>
          </div>
        ) : (
          /* Out of spins screen block */
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl w-full text-center space-y-4">
            <div className="text-4xl">❌</div>
            <h2 className="text-xl font-bold text-slate-200">No Spins Remaining</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Come back tomorrow for more free spins. Daily limit resets every 24 hours.
            </p>
            <div className="pt-2">
              <button
                onClick={handleCloseWebApp}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm font-semibold text-slate-300"
              >
                🚪 Exit Wheel
              </button>
            </div>
          </div>
        )}

        {/* Bottom Ad Banner */}
        <AdRenderer targetPage="Daily Bonus Page"
          placementKey="Footer Banner"
          fallback={
            <div className="w-full bg-gradient-to-r from-slate-900 to-purple-950/40 rounded-xl p-3 border border-purple-950/60 shadow text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-purple-600/30 text-[9px] font-bold text-purple-300 px-2 py-0.5 rounded-bl">AD</div>
              <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block mb-0.5">Footer Banner Area</span>
              <p className="text-xs font-semibold text-white">
                👥 Invite your friends and earn up to 10% commission on all files they upload!
              </p>
            </div>
          }
        />
      </div>

      {/* Congrats Popup Overlay */}
      <AnimatePresence>
        {showCongratsPopup && wonReward !== null && (
          <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-slate-900 border border-indigo-500/30 p-8 rounded-3xl max-w-sm w-full shadow-2xl text-center relative overflow-hidden"
            >
              {/* Top ambient color strip */}
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-rose-500" />
              
              <div className="text-5xl mb-4">🎉</div>
              
              <h2 className="text-2xl font-black text-white mb-2">Congratulations</h2>
              <p className="text-slate-400 text-sm mb-6">You Won:</p>
              
              <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 mb-8 font-mono">
                {formatCurrency(wonReward)}
              </div>
              
              <button
                onClick={handleClaimReward}
                className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] transition-all rounded-2xl font-bold text-base text-white shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
              >
                <span>🎁 Claim Reward</span>
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
