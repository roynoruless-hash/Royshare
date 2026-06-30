import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../config/api";
import { motion, AnimatePresence } from "motion/react";
import { Gift, Disc, RotateCw, AlertTriangle, ArrowLeft, Clock, CheckCircle, ShieldCheck, Star, Package, CreditCard, ChevronRight, Trophy } from "lucide-react";
import confetti from "canvas-confetti";

// --- Types ---
interface BonusModuleStatus {
  enabled: boolean;
  dailyLimit: number;
  usageCount: number;
  cooldown: number;
  lastClaimAt: string | null;
  remaining: number;
  nextAvailableAt: string | null;
  isOnCooldown: boolean;
  cooldownRemaining: number;
}

interface BonusStatusResponse {
  success: boolean;
  dailyBonusEnabled: boolean;
  modules: {
    wheel: BonusModuleStatus;
    box: BonusModuleStatus;
    scratch: BonusModuleStatus;
  };
  currency: string;
}

// --- Components ---

export default function DailyBonusPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [status, setStatus] = useState<BonusStatusResponse | null>(null);
  const [activeView, setActiveView] = useState<'selection' | 'wheel' | 'box' | 'scratch'>('selection');
  
  // Reward States
  const [revealing, setRevealing] = useState(false);
  const [revealedReward, setRevealedReward] = useState<any>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // Wheel States
  const [wheelRotation, setWheelRotation] = useState(0);
  
  // Scratch Card States
  const [scratchedPercent, setScratchedPercent] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Initialization
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

  const fetchStatus = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/api/daily-bonus/status?userId=${userId}`);
      const data = await res.json();
      if (data.success) setStatus(data);
    } catch (err) {
      console.error("Error fetching bonus status:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Auto refresh every 30s
    return () => clearInterval(interval);
  }, [userId]);

  // --- Actions ---

  const handleReveal = async (type: string) => {
    if (revealing || !userId) return;
    setRevealing(true);
    setRevealedReward(null);
    setClaimSuccess(false);

    try {
      const res = await fetch(`${API_BASE}/api/daily-bonus/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type })
      });
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || "Failed to reveal reward");
        setRevealing(false);
        return;
      }

      if (type === 'wheel') {
        // Find index of reward in the wheel (we need settings for this)
        // For now, let's just do a generic rotation
        const spinTime = 4000;
        const extraSpins = 5;
        const newRotation = wheelRotation + (360 * extraSpins) + Math.random() * 360;
        setWheelRotation(newRotation);
        
        setTimeout(() => {
          setRevealedReward(data.reward);
          setRevealing(false);
        }, spinTime);
      } else if (type === 'box') {
        setTimeout(() => {
          setRevealedReward(data.reward);
          setRevealing(false);
        }, 1500);
      } else if (type === 'scratch') {
        setRevealedReward(data.reward);
        setRevealing(false);
        initScratchCard();
      }
    } catch (err) {
      console.error("Reveal error:", err);
      setRevealing(false);
    }
  };

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

  const handleClaim = async () => {
    if (claiming || !userId || !revealedReward) return;
    
    // 1. Show Monetag Rewarded Ad
    const adCompleted = await showMonetagAd();
    if (!adCompleted) return;

    setClaiming(true);
    try {
      const res = await fetch(`${API_BASE}/api/daily-bonus/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId, 
          type: activeView,
          adStatus: 'Verified' // In a real scenario, the backend handles this via postback, 
                             // but we call the claim endpoint to check if postback arrived or credit directly
        })
      });
      const data = await res.json();
      
      if (res.ok) {
        setClaimSuccess(true);
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#6366f1', '#a855f7', '#ec4899']
        });
        fetchStatus();
      } else {
        alert(data.error || "Failed to claim reward. Ensure you watched the ad fully.");
      }
    } catch (err) {
      console.error("Claim error:", err);
    } finally {
      setClaiming(false);
    }
  };

  // --- UI Helpers ---

  const initScratchCard = () => {
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fill with gray silver color
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Add text pattern
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      for(let i=0; i<5; i++) {
        for(let j=0; j<5; j++) {
          ctx.fillText('SCRATCH', 40 + i*60, 30 + j*50);
        }
      }

      setScratchedPercent(0);
    }, 100);
  };

  const handleScratch = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas || revealedReward?.claimed || claimSuccess) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Check percent
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] === 0) transparent++;
    }
    const percent = (transparent / (canvas.width * canvas.height)) * 100;
    setScratchedPercent(percent);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white font-sans p-6">
        <Disc className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
        <p className="text-slate-400 font-medium">Synchronizing Bonus System...</p>
      </div>
    );
  }

  if (!userId || !status || !status.dailyBonusEnabled) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center text-white font-sans p-6 text-center">
        <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">{!userId ? "Access Denied" : "System Maintenance"}</h1>
        <p className="text-slate-400 max-w-sm mb-6">
          {!userId ? "Please open this page directly from the RoyShare Telegram Bot menu." : "Daily Bonus system is currently disabled by administrator. Please check back later."}
        </p>
      </div>
    );
  }

  // --- Sub-Views ---

  const SelectionView = () => (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-black text-white tracking-tight">🎁 Daily Bonus</h1>
        <p className="text-slate-400 text-sm">Choose your luck and win real rewards!</p>
      </div>

      <div className="grid gap-4">
        {[
          { id: 'wheel', name: 'Wheel Spin', icon: Disc, color: 'from-indigo-600 to-blue-600', emoji: '🎡' },
          { id: 'box', name: 'Mystery Box', icon: Package, color: 'from-purple-600 to-pink-600', emoji: '📦' },
          { id: 'scratch', name: 'Scratch Card', icon: CreditCard, color: 'from-amber-600 to-orange-600', emoji: '🎫' }
        ].map((mod) => {
          const modStatus = status?.modules?.[mod.id as keyof typeof status.modules];
          const isLocked = !modStatus?.enabled || modStatus?.remaining === 0 || modStatus?.isOnCooldown;
          
          return (
            <motion.button
              key={mod.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => !isLocked && setActiveView(mod.id as any)}
              className={`relative overflow-hidden p-5 rounded-3xl border text-left transition-all ${
                isLocked ? 'bg-slate-900/50 border-slate-800 opacity-60' : 'bg-slate-900 border-slate-800 hover:border-slate-700 shadow-xl'
              }`}
            >
              <div className={`absolute top-0 left-0 w-2 h-full bg-gradient-to-b ${mod.color}`} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl bg-gradient-to-br ${mod.color} text-white shadow-lg`}>
                    <mod.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white flex items-center gap-2">
                      {mod.name} {mod.emoji}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {!status ? 'Loading...' : modStatus?.isOnCooldown ? `Cooldown: ${formatTime(modStatus.cooldownRemaining)}` : `${modStatus?.remaining || 0} of ${modStatus?.dailyLimit || 0} available today`}
                    </p>
                  </div>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </div>
              </div>
              
              {/* Progress Bar */}
              <div className="mt-4 h-1.5 bg-slate-950 rounded-full overflow-hidden">
                <div 
                  className={`h-full bg-gradient-to-r ${mod.color} transition-all duration-500`}
                  style={{ width: `${Math.min(100, Math.max(0, ((Number(modStatus?.usageCount) || 0) / (Number(modStatus?.dailyLimit) || 1)) * 100))}%` }}
                />
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="bg-indigo-500/5 border border-indigo-500/10 p-4 rounded-2xl flex items-center gap-3">
        <Trophy className="w-8 h-8 text-indigo-400 shrink-0" />
        <div>
          <p className="text-xs font-bold text-white uppercase tracking-wider">Pro Tip</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            All rewards are credited instantly. Complete every bonus to maximize your daily earnings!
          </p>
        </div>
      </div>
    </div>
  );

  const WheelView = () => (
    <div className="flex flex-col items-center space-y-8 py-4">
      <div className="relative">
        {/* Pointer */}
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-rose-500 z-10 drop-shadow-[0_4px_6px_rgba(0,0,0,0.4)]" />
        
        {/* Visual Wheel */}
        <div
          className="relative w-72 h-72 rounded-full border-[8px] border-indigo-600 shadow-[0_0_50px_rgba(79,70,229,0.2)] overflow-hidden transition-transform duration-[4000ms] cubic-bezier(0.25, 0.1, 0.25, 1)"
          style={{ transform: `rotate(${wheelRotation}deg)` }}
        >
          {/* Conic background pattern */}
          <div className="absolute inset-0" style={{ background: 'conic-gradient(#4f46e5 0deg 60deg, #6366f1 60deg 120deg, #7c3aed 120deg 180deg, #9333ea 180deg 240deg, #4f46e5 240deg 300deg, #6366f1 300deg 360deg)' }} />
          
          {/* Values on wheel */}
          {[1,2,3,4,5,6].map((v, i) => (
             <div key={i} className="absolute top-0 left-0 w-full h-full flex items-start justify-center" style={{ transform: `rotate(${i * 60 + 30}deg)` }}>
                <span className="mt-8 font-black text-white text-xs drop-shadow-md">₹?</span>
             </div>
          ))}

          {/* Center */}
          <div className="absolute inset-0 m-auto w-12 h-12 bg-white rounded-full border-4 border-indigo-600 shadow-xl z-10 flex items-center justify-center">
             <div className="w-4 h-4 bg-indigo-600 rounded-full animate-pulse" />
          </div>
        </div>
      </div>

      <button
        onClick={() => handleReveal('wheel')}
        disabled={revealing || !!revealedReward}
        className={`w-56 py-4 rounded-2xl font-black text-lg uppercase tracking-wider transition shadow-xl ${
          revealing || !!revealedReward ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-indigo-500/20 active:scale-95'
        }`}
      >
        {revealing ? 'Spinning...' : 'Spin Wheel'}
      </button>
    </div>
  );

  const BoxView = () => (
    <div className="flex flex-col items-center space-y-12 py-10">
      <div className="grid grid-cols-3 gap-4 w-full">
        {[0, 1, 2].map((i) => (
          <motion.button
            key={i}
            whileHover={{ y: -5 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => !revealedReward && handleReveal('box')}
            disabled={revealing || !!revealedReward}
            className={`aspect-square rounded-3xl border flex flex-col items-center justify-center gap-2 transition-all ${
              revealing && i === 1 ? 'animate-bounce' : ''
            } ${
              revealedReward ? (i === 1 ? 'bg-indigo-600/20 border-indigo-500' : 'bg-slate-900 border-slate-800 opacity-40') : 'bg-slate-900 border-slate-800 hover:border-slate-600 shadow-xl'
            }`}
          >
            <Package className={`w-10 h-10 ${revealing && i === 1 ? 'text-indigo-400' : 'text-slate-500'}`} />
            <span className="text-[10px] font-black text-slate-500 uppercase">Box {i+1}</span>
          </motion.button>
        ))}
      </div>
      <p className="text-slate-400 text-xs font-medium text-center">Tap any box to reveal your mystery reward!</p>
    </div>
  );

  const ScratchView = () => (
    <div className="flex flex-col items-center space-y-8 py-4">
      <div className="relative w-full max-w-[280px] aspect-[4/3] bg-slate-900 rounded-3xl border-4 border-amber-600 shadow-2xl overflow-hidden group">
         {/* Underlying Reward */}
         <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950">
            <Trophy className="w-12 h-12 text-amber-500 mb-2 opacity-20" />
            <span className="text-3xl font-black text-white">
               {revealedReward ? `₹${revealedReward.amount}` : '₹??'}
            </span>
            <span className="text-[10px] font-bold text-slate-500 uppercase mt-2 tracking-widest">Mystery Reward</span>
         </div>

         {/* Scratch Layer */}
         <canvas
            ref={canvasRef}
            width={280}
            height={210}
            className="absolute inset-0 cursor-crosshair touch-none"
            onMouseMove={handleScratch}
            onTouchMove={handleScratch}
         />

         {scratchedPercent > 50 && !revealedReward?.claimed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-transparent pointer-events-none flex items-center justify-center">
                <div className="bg-emerald-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase">Cleared!</div>
            </motion.div>
         )}
      </div>
      <p className="text-slate-400 text-xs font-medium">Scratch at least 50% of the area to reveal reward.</p>
      
      {!revealedReward && (
        <button 
          onClick={() => handleReveal('scratch')} 
          className="w-56 py-3.5 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all shadow-xl shadow-amber-900/20"
        >
          Get Scratch Card
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans flex flex-col">
      {/* Header */}
      <header className="p-5 border-b border-slate-900 bg-slate-950/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activeView !== 'selection' ? (
              <button onClick={() => { setActiveView('selection'); setRevealedReward(null); setClaimSuccess(false); }} className="p-2 bg-slate-900 rounded-xl border border-slate-800 text-slate-400">
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="p-2 bg-indigo-600/20 rounded-xl border border-indigo-500/20 text-indigo-400">
                <Gift className="w-5 h-5" />
              </div>
            )}
            <div>
              <h1 className="text-sm font-black tracking-wide uppercase">RoyShare Bonus</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                {activeView === 'selection' ? 'Menu' : activeView.toUpperCase()}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 rounded-full border border-slate-800">
            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
            <span className="text-xs font-black text-white">Daily Rewards</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-md mx-auto w-full p-6">
        <AnimatePresence mode="wait">
          {activeView === 'selection' && (
            <motion.div key="selection" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <SelectionView />
            </motion.div>
          )}
          {activeView === 'wheel' && (
            <motion.div key="wheel" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <WheelView />
            </motion.div>
          )}
          {activeView === 'box' && (
            <motion.div key="box" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <BoxView />
            </motion.div>
          )}
          {activeView === 'scratch' && (
            <motion.div key="scratch" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <ScratchView />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Claim Reward Popup */}
        <AnimatePresence>
          {revealedReward && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="mt-10 bg-slate-900 border border-indigo-500/30 p-6 rounded-3xl text-center relative overflow-hidden shadow-2xl"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
              
              {!claimSuccess ? (
                <>
                  <h2 className="text-xl font-black text-white mb-1">🎉 You Won!</h2>
                  <p className="text-slate-400 text-xs mb-4">Complete verification to claim reward</p>
                  
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 mb-6">
                    <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                      ₹{Number(revealedReward.amount).toFixed(2)}
                    </span>
                  </div>
                  
                  <button
                    onClick={handleClaim}
                    disabled={claiming}
                    className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-black uppercase tracking-wider active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-900/20"
                  >
                    {claiming ? (
                      <>
                        <RotateCw className="w-5 h-5 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-5 h-5" />
                        <span>Claim Reward</span>
                      </>
                    )}
                  </button>
                  <p className="mt-3 text-[10px] text-slate-500 font-medium">Watch a short ad to credit your balance</p>
                </>
              ) : (
                <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="py-4">
                  <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
                  <h2 className="text-2xl font-black text-white mb-2">Claimed!</h2>
                  <p className="text-slate-400 text-sm mb-6">Reward added to your wallet successfully.</p>
                  <button 
                    onClick={() => { setActiveView('selection'); setRevealedReward(null); setClaimSuccess(false); }} 
                    className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold text-xs uppercase"
                  >
                    Continue
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Ad Placeholder */}
      <footer className="p-4 text-center">
         <div className="bg-slate-900/30 border border-slate-800/50 rounded-2xl p-3 inline-block">
            <span className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em]">Sponsor Ad Space</span>
         </div>
      </footer>
    </div>
  );
}
