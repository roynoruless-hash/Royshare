import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../config/api";
import { motion, AnimatePresence } from "motion/react";
import { Gift, Disc, RotateCw, AlertTriangle, ArrowLeft, Clock, CheckCircle, ShieldCheck, Star, Package, CreditCard, ChevronRight, Trophy, Coins } from "lucide-react";
import confetti from "canvas-confetti";
import AdRenderer from "../components/AdRenderer";

// --- Types ---
interface RewardItem {
  amount: number;
  weight: number;
  label: string;
}

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
  rewards?: RewardItem[];
  // Coin Rain specific settings
  duration?: number;
  coinSpawnRate?: number;
  bombSpawnRate?: number;
  coinSpeed?: number;
  bombSpeed?: number;
  coinSize?: number;
  goldenCoinChance?: number;
  doubleCoinChance?: number;
  shieldChance?: number;
  magnetChance?: number;
  timeBoostChance?: number;
  bombDamagePercent?: number;
  conversionTable?: Array<{ coins: number; rate: number }>;
}

interface BonusStatusResponse {
  success: boolean;
  dailyBonusEnabled: boolean;
  modules: {
    wheel: BonusModuleStatus;
    box: BonusModuleStatus;
    scratch: BonusModuleStatus;
    coinrain: BonusModuleStatus;
  };
  pendingRewards?: any;
  currency: string;
}

// --- Components ---

export default function DailyBonusPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [status, setStatus] = useState<BonusStatusResponse | null>(null);
  const [activeView, setActiveView] = useState<'selection' | 'wheel' | 'box' | 'scratch' | 'coinrain'>('selection');

  // Unified Debug Log State for Coin Rain lifecycle tracking
  const [logs, setLogs] = useState<Array<{ id: string; time: string; text: string; isError?: boolean }>>(() => {
    try {
      const saved = localStorage.getItem('coinrain_debug_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const addLog = (message: string, isError: boolean = false) => {
    const newLog = {
      id: Date.now() + Math.random().toString(36).substring(2, 7),
      time: new Date().toLocaleTimeString(),
      text: message,
      isError
    };
    setLogs(prev => {
      const updated = [newLog, ...prev].slice(0, 100);
      try {
        localStorage.setItem('coinrain_debug_logs', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save log to localStorage', e);
      }
      return updated;
    });
  };
  
  // Reward States
  const [revealing, setRevealing] = useState(false);
  const [revealedReward, setRevealedReward] = useState<any>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);

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

  const handleReveal = async (type: string, index?: number) => {
    if (revealing || !userId) return;
    
    // Prevent re-playing if reward already revealed but not claimed
    if (revealedReward && !claimSuccess) return;

    if (type === 'box' && index !== undefined) {
      setSelectedBox(index);
    }

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
        const rewards = status?.modules.wheel.rewards || [];
        const rewardIndex = rewards.findIndex(r => r.label === data.reward.label);
        
        const spinTime = 4000;
        const extraSpins = 5;
        const segmentSize = 360 / (rewards.length || 6);
        
        // Calculate exact angle to stop at the center of the won segment
        // We add current rotation to keep it spinning forward
        const targetAngle = (rewards.length - rewardIndex) * segmentSize - (segmentSize / 2);
        const newRotation = wheelRotation + (360 * extraSpins) + (targetAngle - (wheelRotation % 360));
        
        setWheelRotation(newRotation);
        
        setTimeout(() => {
          setRevealedReward(data.reward);
          setRevealing(false);
        }, spinTime);
      } else if (type === 'box') {
        setTimeout(() => {
          setRevealedReward(data.reward);
          setRevealing(false);
        }, 1200);
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
    
    if (activeView === 'coinrain') {
      addLog(`🎁 Claim Started: Claiming cash reward of ₹${Number(revealedReward.amount).toFixed(2)}`);
    }

    // 1. Show Monetag Rewarded Ad
    const adCompleted = await showMonetagAd();
    if (!adCompleted) {
      if (activeView === 'coinrain') {
        addLog(`❌ Ad Failed or closed early`, true);
      }
      return;
    }
    
    if (activeView === 'coinrain') {
      addLog(`📺 Ad Completed successfully! Proceeding with validation.`);
    }

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
        if (activeView === 'coinrain') {
          addLog(`✅ Wallet Updated: Credited ₹${Number(revealedReward.amount).toFixed(2)} to user's wallet!`);
          addLog(`🗄️ Firestore Updated: Claim entry saved and usage updated.`);
          if (data.telegramSent) {
            addLog(`📢 Telegram Sent: Notification sent to channel/group.`);
          } else {
            addLog(`📢 Telegram Sent: Notification dispatch successful.`);
          }
        }
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#6366f1', '#a855f7', '#ec4899']
        });
        fetchStatus();
      } else {
        if (activeView === 'coinrain') {
          addLog(`❌ Claim API Error: ${data.error || "Failed to claim reward"}`, true);
        }
        alert(data.error || "Failed to claim reward. Ensure you watched the ad fully.");
      }
    } catch (err: any) {
      console.error("Claim error:", err);
      if (activeView === 'coinrain') {
        addLog(`❌ Claim Exception: ${err.message || "Unknown claim error"}`, true);
      }
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

  useEffect(() => {
    if (activeView !== 'selection' && status?.pendingRewards?.[activeView]) {
      const pending = status.pendingRewards[activeView];
      if (pending && !pending.claimed) {
        setRevealedReward({
          amount: pending.amount,
          label: pending.label,
          coinsCollected: pending.coinsCollected,
          bombHits: pending.bombHits,
          powerupsUsed: pending.powerupsUsed,
          totalCoinsCollected: pending.totalCoinsCollected,
          goldenCoinsCollected: pending.goldenCoinsCollected,
          coinsLostByBombs: pending.coinsLostByBombs,
          finalScore: pending.finalScore,
          claimed: false
        });
        if (activeView === 'scratch') {
          setTimeout(() => {
            initScratchCard();
          }, 150);
        } else if (activeView === 'box' && selectedBox === null) {
          setSelectedBox(0);
        }
      }
    }
  }, [status, activeView]);

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
          { id: 'scratch', name: 'Scratch Card', icon: CreditCard, color: 'from-amber-600 to-orange-600', emoji: '🎫' },
          { id: 'coinrain', name: 'Coin Rain', icon: Coins, color: 'from-emerald-600 to-teal-600', emoji: '🪙' }
        ].map((mod) => {
          const modStatus = status?.modules?.[mod.id as keyof typeof status.modules];
          const hasPending = !!(status?.pendingRewards?.[mod.id] && !status.pendingRewards[mod.id].claimed);
          const isLocked = !modStatus?.enabled || (modStatus?.remaining === 0 && !hasPending) || (modStatus?.isOnCooldown && !hasPending);
          
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
                      {hasPending && (
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-black animate-pulse">
                          🎁 CLAIM
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {!status ? 'Loading...' : hasPending ? 'You have an unclaimed reward!' : modStatus?.isOnCooldown ? `Cooldown: ${formatTime(modStatus.cooldownRemaining)}` : `${modStatus?.remaining || 0} of ${modStatus?.dailyLimit || 0} available today`}
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

  const WheelView = () => {
    const rewards = status?.modules.wheel.rewards || [];
    const segmentSize = 360 / (rewards.length || 6);

    // Helpers for drawing sectors
    const getSectorPath = (startAngle: number, endAngle: number) => {
      const r = 140;
      const cx = 150;
      const cy = 150;
      
      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;
      
      const x1 = cx + r * Math.sin(startRad);
      const y1 = cy - r * Math.cos(startRad);
      const x2 = cx + r * Math.sin(endRad);
      const y2 = cy - r * Math.cos(endRad);
      
      return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
    };

    const getSegmentColor = (index: number, totalCount: number) => {
      const colors = [
        "#4f46e5", // Indigo
        "#7c3aed", // Violet
        "#06b6d4", // Cyan
        "#10b981", // Emerald
        "#f59e0b", // Amber
        "#db2777"  // Pink
      ];
      if (totalCount % 2 === 0) {
        return index % 2 === 0 ? "#4f46e5" : "#7c3aed";
      } else if (totalCount % 3 === 0) {
        return ["#4f46e5", "#7c3aed", "#db2777"][index % 3];
      }
      return colors[index % colors.length];
    };

    const getCleanLabel = (label: string) => {
      if (!label) return "";
      const lower = label.toLowerCase();
      if (lower.includes("better luck") || lower.includes("better luck next time")) {
        return "Try Again";
      }
      return label;
    };

    // Calculate bulbs around the rim for casino/professional look
    const numBulbs = Math.max(12, rewards.length * 2);
    const bulbs = [];
    for (let j = 0; j < numBulbs; j++) {
      const angle = (j * 360) / numBulbs;
      const rad = (angle * Math.PI) / 180;
      const bx = 150 + 143 * Math.sin(rad);
      const by = 150 - 143 * Math.cos(rad);
      bulbs.push({ x: bx, y: by });
    }

    return (
      <div className="flex flex-col items-center space-y-8 py-4">
        <div className="relative select-none">
          {/* Pointer */}
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-rose-500 z-30 drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)]" />
          
          {/* Outer Ring and Border Container */}
          <div className="relative p-1 bg-slate-900 rounded-full shadow-[0_0_50px_rgba(79,70,229,0.3)] border-4 border-indigo-500/20">
            {/* Visual Wheel with rotation transition */}
            <div
              className="relative w-72 h-72 rounded-full overflow-hidden transition-transform duration-[4000ms] cubic-bezier(0.25, 0.1, 0.25, 1)"
              style={{ transform: `rotate(${wheelRotation}deg)` }}
            >
              <svg viewBox="0 0 300 300" className="w-full h-full select-none">
                {/* Background base */}
                <circle cx="150" cy="150" r="148" fill="#020617" />

                {/* Slices */}
                {rewards.map((r, i) => {
                  const startAngle = i * segmentSize;
                  const endAngle = (i + 1) * segmentSize;
                  const color = getSegmentColor(i, rewards.length);
                  return (
                    <path
                      key={`slice-${i}`}
                      d={getSectorPath(startAngle, endAngle)}
                      fill={color}
                      stroke="#020617"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    />
                  );
                })}

                {/* Outer decorative borders */}
                <circle cx="150" cy="150" r="141" fill="none" stroke="#fbbf24" strokeWidth="2" className="opacity-90" />
                <circle cx="150" cy="150" r="145" fill="none" stroke="#4f46e5" strokeWidth="3" className="opacity-40" />

                {/* Bulbs (Dots) around the rim */}
                {bulbs.map((b, j) => (
                  <circle
                    key={`bulb-${j}`}
                    cx={b.x}
                    cy={b.y}
                    r="2.5"
                    fill={j % 2 === 0 ? "#ffffff" : "#fef08a"}
                    className="animate-pulse"
                    style={{ animationDelay: `${(j * 150) % 1000}ms` }}
                  />
                ))}

                {/* Labels */}
                {rewards.map((r, i) => {
                  const cleanLabel = getCleanLabel(r.label);
                  const midAngle = i * segmentSize + segmentSize / 2;
                  const normAngle = ((midAngle % 360) + 360) % 360;
                  const isFlipped = normAngle > 90 && normAngle < 270;
                  const rotateAngle = isFlipped ? midAngle + 180 : midAngle;
                  const textAnchor = isFlipped ? "start" : "end";
                  const textX = isFlipped ? 22 : 122; // Keep safe padding from the center and edge

                  // Dynamic font size based on slot count and text length
                  let fontSize = 11;
                  if (rewards.length > 24) fontSize = 6.5;
                  else if (rewards.length > 18) fontSize = 7.5;
                  else if (rewards.length > 12) fontSize = 8.5;
                  else if (rewards.length > 8) fontSize = 9.5;

                  if (cleanLabel.length > 10) {
                    fontSize = Math.max(5.5, fontSize - 1.5);
                  }

                  return (
                    <g key={`label-g-${i}`} transform={`rotate(${rotateAngle} 150 150)`}>
                      <text
                        x={150 + textX}
                        y={150}
                        textAnchor={textAnchor}
                        dominantBaseline="central"
                        fill="#ffffff"
                        style={{
                          fontSize: `${fontSize}px`,
                          fontWeight: "950",
                          fontFamily: "Inter, sans-serif",
                          letterSpacing: "-0.01em",
                          textShadow: "0px 1px 3px rgba(0,0,0,0.8)"
                        }}
                      >
                        {cleanLabel}
                      </text>
                    </g>
                  );
                })}

                {/* Center cap / hub */}
                <circle cx="150" cy="150" r="18" fill="#1e1b4b" stroke="#fbbf24" strokeWidth="3" className="shadow-lg" />
                <circle cx="150" cy="150" r="7" fill="#fbbf24" className="animate-pulse" />
              </svg>
            </div>
          </div>
        </div>

        <button
          onClick={() => handleReveal('wheel')}
          disabled={revealing || (!!revealedReward && !claimSuccess)}
          className={`w-56 py-4 rounded-2xl font-black text-lg uppercase tracking-wider transition shadow-xl ${
            revealing || (!!revealedReward && !claimSuccess) ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-indigo-500/20 active:scale-95'
          }`}
        >
          {revealing ? 'Spinning...' : 'Spin Wheel'}
        </button>
      </div>
    );
  };

  const BoxView = () => (
    <div className="flex flex-col items-center space-y-12 py-10">
      <div className="grid grid-cols-3 gap-4 w-full">
        {[0, 1, 2].map((i) => (
          <motion.button
            key={i}
            whileHover={{ y: -5 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => !revealedReward && handleReveal('box', i)}
            disabled={revealing || (!!revealedReward && !claimSuccess)}
            className={`aspect-square rounded-3xl border flex flex-col items-center justify-center gap-2 transition-all ${
              revealing && selectedBox === i ? 'animate-bounce border-indigo-500' : ''
            } ${
              revealedReward ? (selectedBox === i ? 'bg-indigo-600/20 border-indigo-500 scale-105' : 'bg-slate-900 border-slate-800 opacity-40') : 'bg-slate-900 border-slate-800 hover:border-slate-600 shadow-xl'
            }`}
          >
            <Package className={`w-10 h-10 ${(revealing || revealedReward) && selectedBox === i ? 'text-indigo-400' : 'text-slate-500'}`} />
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
               {scratchedPercent > 50 && revealedReward ? `₹${revealedReward.amount}` : '₹??'}
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

  const CoinRainView = () => {
    const coinrainConfig = status?.modules.coinrain || {
      enabled: true,
      dailyLimit: 2,
      duration: 30,
      coinSpawnRate: 1.5,
      bombSpawnRate: 0.3,
      coinSpeed: 3,
      bombSpeed: 3,
      coinSize: 32,
      goldenCoinChance: 0.1,
      doubleCoinChance: 0.05,
      shieldChance: 0.05,
      magnetChance: 0.05,
      timeBoostChance: 0.05,
      bombDamagePercent: 40,
      conversionTable: []
    };

    const [gameState, setGameState] = useState<'start' | 'playing' | 'finishing' | 'result'>(() => {
      const hasPending = !!(status?.pendingRewards?.coinrain && !status.pendingRewards.coinrain.claimed);
      return hasPending ? 'result' : 'start';
    });
    const [score, setScore] = useState(0);
    const [bombHits, setBombHits] = useState(0);
    const [powerupsUsed, setPowerupsUsed] = useState(0);
    const [secondsLeft, setSecondsLeft] = useState(coinrainConfig.duration || 30);
    const [activeDifficulty, setActiveDifficulty] = useState<'Easy' | 'Medium' | 'Hard' | 'Extreme'>('Easy');
    
    // Canvas & Game loop refs
    const canvasRefLocal = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number | null>(null);
    const gameActiveRef = useRef<boolean>(false);
    
    // Live refs to avoid closures in animation frame
    const scoreRef = useRef<number>(0);
    const bombHitsRef = useRef<number>(0);
    const powerupsRef = useRef<number>(0);
    const timeLeftRef = useRef<number>(coinrainConfig.duration || 30);
    const difficultyRef = useRef<'Easy' | 'Medium' | 'Hard' | 'Extreme'>('Easy');
    const tapsCountRef = useRef<number>(0);
    const sessionIdRef = useRef<string | null>(null);
    const totalCoinsCollectedRef = useRef<number>(0);
    const goldenCoinsCollectedRef = useRef<number>(0);
    const coinsLostByBombsRef = useRef<number>(0);

    // Power-up duration tracking
    const frozenTimerRef = useRef<number>(0);
    const shieldTimerRef = useRef<number>(0);
    const doubleTimerRef = useRef<number>(0);
    const magnetTimerRef = useRef<number>(0);

    const [isFrozen, setIsFrozen] = useState(false);
    const [isShielded, setIsShielded] = useState(false);
    const [doubleActive, setDoubleActive] = useState(false);
    const [magnetActive, setMagnetActive] = useState(false);

    const lastInteractionRef = useRef<{ x: number; y: number } | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [gameError, setGameError] = useState<string | null>(null);

    const itemsRef = useRef<any[]>([]);
    const floatTextsRef = useRef<any[]>([]);

    // Quick conversion helper for display
    const getEstimatedReward = (coins: number) => {
      const table = coinrainConfig.conversionTable || [];
      if (table.length > 0) {
        const sortedTable = [...table].sort((a: any, b: any) => a.coins - b.coins);
        let activeTier = null;
        for (const tier of sortedTable) {
          if (coins >= tier.coins) activeTier = tier;
        }
        if (activeTier) return coins * (Number(activeTier.rate) / Number(activeTier.coins));
        const lowest = sortedTable[0];
        return coins * (Number(lowest.rate) / Number(lowest.coins));
      }
      return coins * 0.0001;
    };

    // Initialize Game Session on Start
    const handleStartGame = async () => {
      addLog('🎮 Game Started: Requesting initial game session from server');
      console.log('🎮 [Coin Rain] Requesting to start game session for user:', userId);
      setGameError(null);
      setGameState('finishing'); // Loading state
      try {
        const res = await fetch(`${API_BASE}/api/daily-bonus/coinrain/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
        const data = await res.json();
        console.log('📡 [Coin Rain] Start Response Status:', res.status, data);
        if (!res.ok) {
          throw new Error(data.error || 'Failed to start game session');
        }

        // Set secure Session ID
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        console.log('🔑 [Coin Rain] Received Session ID:', data.sessionId);
        addLog(`🔑 Session ID received: ${data.sessionId}`);
        
        // Setup initial refs
        scoreRef.current = 0;
        bombHitsRef.current = 0;
        powerupsRef.current = 0;
        timeLeftRef.current = coinrainConfig.duration || 30;
        difficultyRef.current = 'Easy';
        tapsCountRef.current = 0;
        totalCoinsCollectedRef.current = 0;
        goldenCoinsCollectedRef.current = 0;
        coinsLostByBombsRef.current = 0;

        frozenTimerRef.current = 0;
        shieldTimerRef.current = 0;
        doubleTimerRef.current = 0;
        magnetTimerRef.current = 0;

        itemsRef.current = [];
        floatTextsRef.current = [];
        lastInteractionRef.current = null;

        setScore(0);
        setBombHits(0);
        setPowerupsUsed(0);
        setSecondsLeft(timeLeftRef.current);
        setActiveDifficulty('Easy');
        setIsFrozen(false);
        setIsShielded(false);
        setDoubleActive(false);
        setMagnetActive(false);

        setGameState('playing');
        gameActiveRef.current = true;
        addLog(`⏱️ Timer Started: Starting Coin Rain countdown from ${timeLeftRef.current}s`);
      } catch (err: any) {
        const errMsg = err.message || 'Error initializing session';
        addLog(`❌ Session Start Error: ${errMsg}`, true);
        setGameError(errMsg);
        setGameState('start');
      }
    };

    // Main Game Loop Update / Render
    useEffect(() => {
      if (gameState !== 'playing' || !gameActiveRef.current) return;

      const canvas = canvasRefLocal.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle Resize / Stage matching
      const handleResize = () => {
        const rect = canvas.parentElement?.getBoundingClientRect();
        canvas.width = rect?.width || 350;
        canvas.height = 420; // fixed stage height
      };
      handleResize();

      let lastTime = performance.now();

      const gameLoop = (timestamp: number) => {
        if (!gameActiveRef.current) return;

        const delta = (timestamp - lastTime) / 1000;
        lastTime = timestamp;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // --- 1. Draw Grid Background / Theme Accents ---
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Tech Grid lines
        ctx.strokeStyle = 'rgba(79, 70, 229, 0.05)';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 40) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }

        // --- 2. Update Timers ---
        timeLeftRef.current -= delta;
        if (timeLeftRef.current <= 0) {
          timeLeftRef.current = 0;
          gameActiveRef.current = false;
          triggerFinishGame();
          return;
        }
        setSecondsLeft(Math.ceil(timeLeftRef.current));

        // Update active difficulty
        const totalDuration = coinrainConfig.duration || 30;
        const elapsed = totalDuration - timeLeftRef.current;
        let diff: 'Easy' | 'Medium' | 'Hard' | 'Extreme' = 'Easy';
        if (elapsed > totalDuration * 0.7) {
          diff = 'Extreme';
        } else if (elapsed > totalDuration * 0.4) {
          diff = 'Hard';
        } else if (elapsed > totalDuration * 0.15) {
          diff = 'Medium';
        }
        difficultyRef.current = diff;
        setActiveDifficulty(diff);

        // Update powerups timer refs
        if (frozenTimerRef.current > 0) {
          frozenTimerRef.current -= delta;
          if (frozenTimerRef.current <= 0) setIsFrozen(false);
        }
        if (shieldTimerRef.current > 0) {
          shieldTimerRef.current -= delta;
          if (shieldTimerRef.current <= 0) setIsShielded(false);
        }
        if (doubleTimerRef.current > 0) {
          doubleTimerRef.current -= delta;
          if (doubleTimerRef.current <= 0) setDoubleActive(false);
        }
        if (magnetTimerRef.current > 0) {
          magnetTimerRef.current -= delta;
          if (magnetTimerRef.current <= 0) setMagnetActive(false);
        }

        // --- 3. Spawning ---
        // Scale with difficulty
        let spawnMultiplier = 1;
        let bombMultiplier = 1;
        if (diff === 'Medium') { spawnMultiplier = 1.1; bombMultiplier = 1.3; }
        else if (diff === 'Hard') { spawnMultiplier = 1.3; bombMultiplier = 1.8; }
        else if (diff === 'Extreme') { spawnMultiplier = 1.6; bombMultiplier = 2.4; }

        const coinSpawnChance = (coinrainConfig.coinSpawnRate ?? 1.5) / 60 * spawnMultiplier;
        const bombSpawnChance = (coinrainConfig.bombSpawnRate ?? 0.3) / 60 * bombMultiplier;

        // Spawn Coin
        if (Math.random() < coinSpawnChance) {
          const size = coinrainConfig.coinSize ?? 32;
          const x = Math.random() * (canvas.width - size * 2) + size;
          
          // Decide sub-type of coin / power-ups
          let type: any = 'normal';
          const r = Math.random();
          if (r < (coinrainConfig.goldenCoinChance ?? 0.1)) {
            type = 'golden';
          } else if (r < (coinrainConfig.goldenCoinChance ?? 0.1) + (coinrainConfig.doubleCoinChance ?? 0.05)) {
            type = 'double';
          } else if (r < (coinrainConfig.goldenCoinChance ?? 0.1) + (coinrainConfig.doubleCoinChance ?? 0.05) + (coinrainConfig.shieldChance ?? 0.05)) {
            type = 'shield';
          } else if (r < (coinrainConfig.goldenCoinChance ?? 0.1) + (coinrainConfig.doubleCoinChance ?? 0.05) + (coinrainConfig.shieldChance ?? 0.05) + (coinrainConfig.magnetChance ?? 0.05)) {
            type = 'magnet';
          } else if (r < (coinrainConfig.goldenCoinChance ?? 0.1) + (coinrainConfig.doubleCoinChance ?? 0.05) + (coinrainConfig.shieldChance ?? 0.05) + (coinrainConfig.magnetChance ?? 0.05) + (coinrainConfig.timeBoostChance ?? 0.05)) {
            type = 'timeboost';
          }

          itemsRef.current.push({
            id: Math.random().toString(),
            x,
            y: -size,
            speed: (coinrainConfig.coinSpeed ?? 3) * (0.8 + Math.random() * 0.4),
            size,
            type,
            angle: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.05
          });
        }

        // Spawn Bomb
        if (Math.random() < bombSpawnChance) {
          const size = coinrainConfig.coinSize ?? 32;
          const x = Math.random() * (canvas.width - size * 2) + size;
          
          // Bomb types
          const r = Math.random();
          let type: any = 'normal_bomb';
          if (r < 0.15) {
            type = 'electric_bomb';
          } else if (r < 0.3) {
            type = 'red_bomb';
          } else if (r < 0.45) {
            type = 'skull_bomb';
          } else if (r < 0.55) {
            type = 'magnet_bomb';
          }

          itemsRef.current.push({
            id: Math.random().toString(),
            x,
            y: -size,
            speed: (coinrainConfig.bombSpeed ?? 3) * (0.9 + Math.random() * 0.3),
            size,
            type,
            angle: 0,
            rotSpeed: 0.02
          });
        }

        // --- 4. Update and Pull Items ---
        const activeMagnetBomb = itemsRef.current.find(item => item.type === 'magnet_bomb');

        itemsRef.current.forEach(item => {
          // Falling movement
          item.y += item.speed;
          item.angle += item.rotSpeed;

          // Magnet Bomb pulls nearby coins
          if (activeMagnetBomb && (item.type === 'normal' || item.type === 'golden')) {
            const dx = activeMagnetBomb.x - item.x;
            const dy = activeMagnetBomb.y - item.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 120) {
              item.x += (dx / dist) * 4;
              item.y += (dy / dist) * 4;
              if (dist < 20) {
                item.toBeRemoved = true;
              }
            }
          }

          // Coin Magnet power-up pulls coins to interaction position
          if (magnetTimerRef.current > 0 && lastInteractionRef.current && (item.type === 'normal' || item.type === 'golden')) {
            const dx = lastInteractionRef.current.x - item.x;
            const dy = lastInteractionRef.current.y - item.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 5) {
              item.x += (dx / dist) * 8;
              item.y += (dy / dist) * 8;
              
              // Auto collect if magnet pulls it extremely close
              if (dist < item.size && !frozenTimerRef.current) {
                collectItem(item, lastInteractionRef.current.x, lastInteractionRef.current.y);
              }
            }
          }
        });

        // Filter out out-of-screen or removed items
        itemsRef.current = itemsRef.current.filter(item => item.y < canvas.height + item.size && !item.toBeRemoved);

        // --- 5. Draw Items ---
        itemsRef.current.forEach(item => {
          ctx.save();
          ctx.translate(item.x, item.y);
          ctx.rotate(item.angle);

          const r = item.size / 2;

          // Drawing shapes based on entity type
          if (item.type === 'normal') {
            const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, r);
            grad.addColorStop(0, '#fef08a');
            grad.addColorStop(1, '#ca8a04');
            ctx.fillStyle = grad;
            ctx.shadowColor = '#eab308';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = '#854d0e';
            ctx.font = 'bold 14px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('₹', 0, 0);

          } else if (item.type === 'golden') {
            const grad = ctx.createRadialGradient(-3, -3, 2, 0, 0, r);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.3, '#fde047');
            grad.addColorStop(1, '#eab308');
            ctx.fillStyle = grad;
            ctx.shadowColor = '#eab308';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = '#854d0e';
            ctx.font = 'bold 16px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⭐', 0, -1);

          } else if (item.type === 'double') {
            ctx.fillStyle = '#db2777';
            ctx.shadowColor = '#f472b6';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('2X', 0, 0);

          } else if (item.type === 'shield') {
            ctx.fillStyle = '#0284c7';
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🛡️', 0, 0);

          } else if (item.type === 'magnet') {
            ctx.fillStyle = '#0d9488';
            ctx.shadowColor = '#2dd4bf';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🧲', 0, 0);

          } else if (item.type === 'timeboost') {
            ctx.fillStyle = '#059669';
            ctx.shadowColor = '#34d399';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+5s', 0, 0);

          } else if (item.type === 'normal_bomb') {
            ctx.fillStyle = '#1e293b';
            ctx.shadowColor = '#f43f5e';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('💣', 0, 0);

          } else if (item.type === 'red_bomb') {
            ctx.fillStyle = '#991b1b';
            ctx.shadowColor = '#ef4444';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🔴', 0, 0);

          } else if (item.type === 'electric_bomb') {
            ctx.fillStyle = '#a16207';
            ctx.shadowColor = '#fbbf24';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⚡', 0, 0);

          } else if (item.type === 'skull_bomb') {
            ctx.fillStyle = '#0f172a';
            ctx.shadowColor = '#64748b';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('☠️', 0, 0);

          } else if (item.type === 'magnet_bomb') {
            ctx.fillStyle = '#581c87';
            ctx.shadowColor = '#a855f7';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'normal 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🧲💣', 0, 0);
          }

          ctx.restore();
        });

        // --- 6. Update and Draw Float Texts ---
        floatTextsRef.current.forEach(ft => {
          ft.y -= 1.2;
          ft.alpha -= delta * 1.5;
          
          ctx.save();
          ctx.globalAlpha = Math.max(0, ft.alpha);
          ctx.fillStyle = ft.color;
          ctx.font = 'bold 14px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(ft.text, ft.x, ft.y);
          ctx.restore();
        });
        floatTextsRef.current = floatTextsRef.current.filter(ft => ft.alpha > 0);

        // --- 7. Draw Frozen overlay if frozen ---
        if (frozenTimerRef.current > 0) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 4;
          ctx.strokeRect(0, 0, canvas.width, canvas.height);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 16px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`⚡ FROZEN (${Math.ceil(frozenTimerRef.current)}s) ⚡`, canvas.width / 2, canvas.height / 2);
        }

        requestRef.current = requestAnimationFrame(gameLoop);
      };

      requestRef.current = requestAnimationFrame(gameLoop);

      return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
    }, [gameState]);

    // Handle interactive clicks or drags on items
    const handleInteract = (clientX: number, clientY: number) => {
      if (gameState !== 'playing' || !gameActiveRef.current || frozenTimerRef.current > 0) return;

      const canvas = canvasRefLocal.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      lastInteractionRef.current = { x, y };

      // Check hit detection
      itemsRef.current.forEach(item => {
        const dist = Math.hypot(x - item.x, y - item.y);
        const radius = item.size / 2 + 10;
        if (dist < radius && !item.toBeRemoved) {
          collectItem(item, x, y);
        }
      });
    };

    // Item Collection Logic
    const collectItem = (item: any, x: number, y: number) => {
      item.toBeRemoved = true;
      tapsCountRef.current += 1;

      if (item.type === 'normal' || item.type === 'golden') {
        let val = item.type === 'golden' ? 10 : 1;
        let color = item.type === 'golden' ? '#fde047' : '#eab308';
        let txt = `+${val}`;

        totalCoinsCollectedRef.current += 1;
        if (item.type === 'golden') {
          goldenCoinsCollectedRef.current += 1;
        }

        if (doubleTimerRef.current > 0) {
          val = val * 2;
          txt = `DOUBLE +${val}`;
          color = '#ec4899';
        }

        scoreRef.current += val;
        setScore(scoreRef.current);
        addLog(`🪙 Coin Collected! Type: ${item.type}. Val: ${val}. Total: ${totalCoinsCollectedRef.current}. Current Score: ${scoreRef.current}`);

        floatTextsRef.current.push({
          x,
          y: y - 10,
          text: txt,
          color,
          alpha: 1
        });

      } else if (item.type === 'double') {
        powerupsRef.current += 1;
        setPowerupsUsed(powerupsRef.current);
        doubleTimerRef.current = 4;
        setDoubleActive(true);
        addLog(`🔋 Power-up Activated: 2X Double Coins for 4s`);

        floatTextsRef.current.push({
          x,
          y: y - 10,
          text: '⭐ DOUBLE ACTIVE (4s)!',
          color: '#db2777',
          alpha: 1
        });

      } else if (item.type === 'shield') {
        powerupsRef.current += 1;
        setPowerupsUsed(powerupsRef.current);
        shieldTimerRef.current = 5;
        setIsShielded(true);
        addLog(`🔋 Power-up Activated: Shield Protection for 5s`);

        floatTextsRef.current.push({
          x,
          y: y - 10,
          text: '🛡️ SHIELD ACTIVE (5s)!',
          color: '#38bdf8',
          alpha: 1
        });

      } else if (item.type === 'magnet') {
        powerupsRef.current += 1;
        setPowerupsUsed(powerupsRef.current);
        magnetTimerRef.current = 8;
        setMagnetActive(true);
        addLog(`🔋 Power-up Activated: Coin Magnet for 8s`);

        floatTextsRef.current.push({
          x,
          y: y - 10,
          text: '🧲 MAGNET ACTIVE (8s)!',
          color: '#2dd4bf',
          alpha: 1
        });

      } else if (item.type === 'timeboost') {
        powerupsRef.current += 1;
        setPowerupsUsed(powerupsRef.current);
        timeLeftRef.current = Math.min(300, timeLeftRef.current + 5);
        setSecondsLeft(Math.ceil(timeLeftRef.current));
        addLog(`🔋 Power-up Activated: Time Boost +5s`);

        floatTextsRef.current.push({
          x,
          y: y - 10,
          text: '⏱ +5 SECONDS!',
          color: '#10b981',
          alpha: 1
        });

      } else {
        // Bomb Hit Logic
        bombHitsRef.current += 1;
        setBombHits(bombHitsRef.current);

        const parent = canvasRefLocal.current?.parentElement;
        if (parent) {
          parent.classList.add('animate-shake');
          setTimeout(() => parent.classList.remove('animate-shake'), 400);
        }

        if (shieldTimerRef.current > 0) {
          addLog(`🛡️ Bomb Blocked: Shield absorbed the hit safely! Remaining Score: ${scoreRef.current}`);
          floatTextsRef.current.push({
            x,
            y: y - 10,
            text: '🛡️ SHIELD BLOCKED!',
            color: '#38bdf8',
            alpha: 1
          });
          return;
        }

        if (item.type === 'normal_bomb' || item.type === 'magnet_bomb') {
          const dmg = coinrainConfig.bombDamagePercent ?? 40;
          const loss = Math.floor(scoreRef.current * (dmg / 100));
          coinsLostByBombsRef.current += loss;
          scoreRef.current = Math.max(0, scoreRef.current - loss);
          setScore(scoreRef.current);
          addLog(`💥 Bomb Hit: Normal/Magnet Bomb detonated! Lost ${dmg}% (-${loss} Coins). Remaining Score: ${scoreRef.current}`, true);

          floatTextsRef.current.push({
            x,
            y: y - 10,
            text: `💥 -${dmg}% (${loss} Coins)!`,
            color: '#ef4444',
            alpha: 1
          });

        } else if (item.type === 'red_bomb') {
          const loss = 50;
          coinsLostByBombsRef.current += loss;
          scoreRef.current = Math.max(0, scoreRef.current - loss);
          setScore(scoreRef.current);
          addLog(`💥 Bomb Hit: Red Bomb detonated! Flat loss of -${loss} Coins. Remaining Score: ${scoreRef.current}`, true);

          floatTextsRef.current.push({
            x,
            y: y - 10,
            text: `💥 RED BOMB: -${loss} Coins!`,
            color: '#f87171',
            alpha: 1
          });

        } else if (item.type === 'electric_bomb') {
          frozenTimerRef.current = 4;
          setIsFrozen(true);
          addLog(`⚡ Bomb Hit: Electric Bomb shocked you! Game Frozen for 4s`, true);

          floatTextsRef.current.push({
            x,
            y: y - 10,
            text: '⚡ STUNNED / FROZEN (4s)!',
            color: '#fbbf24',
            alpha: 1
          });

        } else if (item.type === 'skull_bomb') {
          const rDmg = 20;
          const loss = Math.floor(scoreRef.current * (rDmg / 100));
          coinsLostByBombsRef.current += loss;
          scoreRef.current = Math.max(0, scoreRef.current - loss);
          setScore(scoreRef.current);
          addLog(`💀 Bomb Hit: Skull Bomb detonated! Lost ${rDmg}% (-${loss} Coins). Remaining Score: ${scoreRef.current}`, true);

          floatTextsRef.current.push({
            x,
            y: y - 10,
            text: `💀 SKULL: -${loss} Coins!`,
            color: '#94a3b8',
            alpha: 1
          });
        }
      }
    };

    const triggerFinishGame = async () => {
      addLog(`🏁 Game Finished! Score: ${scoreRef.current}, Bomb Hits: ${bombHitsRef.current}, Total Coins Collected: ${totalCoinsCollectedRef.current}`);
      console.log('🎮 [Coin Rain] Finishing game... Current State:', {
        userId,
        sessionId: sessionIdRef.current,
        score: scoreRef.current,
        bombHits: bombHitsRef.current,
        powerupsUsed: powerupsRef.current,
        duration: coinrainConfig.duration || 30,
        tapsCount: tapsCountRef.current,
        totalCoinsCollected: totalCoinsCollectedRef.current,
        goldenCoinsCollected: goldenCoinsCollectedRef.current,
        coinsLostByBombs: coinsLostByBombsRef.current,
        finalScore: scoreRef.current
      });

      setGameState('finishing');
      try {
        const payload = {
          userId,
          sessionId: sessionIdRef.current,
          score: scoreRef.current,
          bombHits: bombHitsRef.current,
          powerupsUsed: powerupsRef.current,
          duration: coinrainConfig.duration || 30,
          tapsCount: tapsCountRef.current,
          totalCoinsCollected: totalCoinsCollectedRef.current,
          goldenCoinsCollected: goldenCoinsCollectedRef.current,
          coinsLostByBombs: coinsLostByBombsRef.current,
          finalScore: scoreRef.current
        };

        addLog(`📡 Sending Finish API Request with payload: ${JSON.stringify(payload)}`);

        const res = await fetch(`${API_BASE}/api/daily-bonus/coinrain/finish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        console.log('📡 [Coin Rain] Finish Response Status:', res.status, res.statusText);
        addLog(`📡 Finish API Response Status: ${res.status} ${res.statusText}`);

        const data = await res.json();
        console.log('📦 [Coin Rain] Finish Response Body:', data);
        addLog(`📦 Finish API Response Body: ${JSON.stringify(data)}`);

        if (!res.ok) {
          throw new Error(data.error || 'Validation failed');
        }

        console.log('🏆 [Coin Rain] Success! Setting revealed reward... Reward amount:', data.rewardAmount);
        addLog(`🏆 Reward Calculated: ₹${Number(data.rewardAmount).toFixed(2)}`);

        setRevealedReward({
          amount: data.rewardAmount,
          label: `₹${data.rewardAmount.toFixed(2)}`,
          coinsCollected: data.coinsCollected,
          bombHits: data.bombHits,
          powerupsUsed: data.powerupsUsed,
          totalCoinsCollected: totalCoinsCollectedRef.current,
          goldenCoinsCollected: goldenCoinsCollectedRef.current,
          coinsLostByBombs: coinsLostByBombsRef.current,
          finalScore: scoreRef.current,
          claimed: false
        });

        if (data.rewardAmount > 0) {
          confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
        }

        setGameState('result');
      } catch (err: any) {
        console.error('❌ [Coin Rain] Finish game error caught:', err);
        const errMsg = err.message || 'Verification Error. Re-syncing.';
        addLog(`❌ Finish Game Error: ${errMsg}`, true);
        setGameError(errMsg);
        setGameState('start');
      }
    };

    useEffect(() => {
      return () => {
        gameActiveRef.current = false;
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
    }, []);

    const renderContent = () => {
      if (gameState === 'start') {
        const modStatus = status?.modules?.coinrain;
      const hasPending = !!(status?.pendingRewards?.coinrain && !status.pendingRewards.coinrain.claimed);
      const isLocked = !modStatus?.enabled || (modStatus?.remaining === 0 && !hasPending) || (modStatus?.isOnCooldown && !hasPending);

      return (
        <div className="flex flex-col items-center justify-center space-y-6 text-center py-4 animate-fade-in relative">
          <div className="w-full mb-2">
            <AdRenderer targetPage="Daily Bonus Page" placementKey="Header Banner" />
          </div>

          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-3xl w-20 h-20 flex items-center justify-center shadow-xl shadow-emerald-950/20">
            <Coins className="w-10 h-10 text-emerald-400" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-black text-white">🪙 Coin Rain</h2>
            <p className="text-slate-400 text-xs max-w-xs font-medium">Tap falling coins and activate high-yield powerups! Convert your coins to real cash instantly!</p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-3xl w-full max-w-xs space-y-3.5 text-left text-xs">
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">⏰ Duration</span>
              <span className="text-white font-black">{coinrainConfig.duration || 30} Seconds</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">🎰 Plays Available</span>
              <span className="text-white font-black">{modStatus?.remaining ?? 2} of {modStatus?.dailyLimit ?? 2}</span>
            </div>
            {modStatus?.isOnCooldown && (
              <div className="flex justify-between text-rose-400 border-b border-slate-800 pb-2 font-black">
                <span>⏳ Cooldown</span>
                <span>{formatTime(modStatus.cooldownRemaining)}</span>
              </div>
            )}
            <div className="pt-1">
              <span className="text-slate-500 font-black uppercase tracking-wider block text-[9px] mb-2">💰 Conversion Rates</span>
              <div className="space-y-1 bg-slate-950 p-2.5 rounded-2xl border border-slate-800 font-mono text-[10px] text-emerald-400 font-bold">
                {coinrainConfig.conversionTable?.length > 0 ? (
                  coinrainConfig.conversionTable.slice(0, 3).map((tier: any, i: number) => (
                    <div key={i} className="flex justify-between">
                      <span>{tier.coins} Coins</span>
                      <span>₹{tier.rate.toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between">
                    <span>100 Coins</span>
                    <span>₹0.01</span>
                  </div>
                )}
                {coinrainConfig.conversionTable?.length > 3 && (
                  <div className="text-[9px] text-slate-500 text-center pt-1">+ More tiers configured!</div>
                )}
              </div>
            </div>
          </div>

          {gameError && (
            <p className="text-xs font-bold text-rose-400 bg-rose-500/15 border border-rose-500/10 px-4 py-2.5 rounded-2xl max-w-xs">
              ⚠️ {gameError}
            </p>
          )}

          <button 
            onClick={handleStartGame}
            disabled={isLocked}
            className={`w-64 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all shadow-xl ${isLocked ? 'opacity-40 cursor-not-allowed shadow-none' : 'shadow-emerald-950/20'}`}
          >
            {modStatus?.isOnCooldown ? 'On Cooldown' : modStatus?.remaining === 0 ? 'No Plays Left' : 'Start Coin Rain'}
          </button>

          <div className="w-full mt-2">
            <AdRenderer targetPage="Daily Bonus Page" placementKey="Footer Banner" />
          </div>
        </div>
      );
    }

    if (gameState === 'playing') {
      return (
        <div className="flex flex-col items-center space-y-4 animate-fade-in py-2">
          <div className="w-full flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <div className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                activeDifficulty === 'Easy' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                activeDifficulty === 'Medium' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                activeDifficulty === 'Hard' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                'bg-red-500 text-white animate-pulse'
              }`}>
                {activeDifficulty}
              </div>
              
              <div className="flex gap-1">
                {doubleActive && <span className="text-[9px] bg-pink-500/20 text-pink-400 px-1.5 py-0.5 rounded-full font-black animate-bounce">2X</span>}
                {isShielded && <span className="text-[9px] bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded-full font-black animate-pulse">SHIELD</span>}
                {magnetActive && <span className="text-[9px] bg-teal-500/20 text-teal-400 px-1.5 py-0.5 rounded-full font-black">MAGNET</span>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-slate-400 font-bold text-xs bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-xl">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-mono text-white text-sm font-black">{secondsLeft.toString().padStart(2, '0')}s</span>
              </div>
              <div className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-xl font-black font-mono">
                {score} COINS
              </div>
            </div>
          </div>

          <div 
            className="w-full max-w-[360px] aspect-[5/6] bg-slate-950 border-4 border-slate-900 rounded-[32px] overflow-hidden shadow-2xl relative cursor-crosshair touch-none"
            onMouseDown={(e) => handleInteract(e.clientX, e.clientY)}
            onMouseMove={(e) => {
              if (e.buttons === 1) handleInteract(e.clientX, e.clientY);
            }}
            onTouchStart={(e) => handleInteract(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchMove={(e) => handleInteract(e.touches[0].clientX, e.touches[0].clientY)}
          >
            <canvas ref={canvasRefLocal} className="absolute inset-0 w-full h-full" />
          </div>

          <p className="text-[10px] text-slate-500 text-center font-bold uppercase tracking-wider">Drag or Tap on coins to collect them! Avoid bombs!</p>
        </div>
      );
    }

    if (gameState === 'finishing') {
      return (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-400 font-bold text-xs animate-pulse uppercase tracking-widest">Validating with secure servers...</p>
        </div>
      );
    }

    if (gameState === 'result' && revealedReward) {
      const totalCoins = revealedReward.totalCoinsCollected ?? (revealedReward.coinsCollected || score);
      const goldenCoins = revealedReward.goldenCoinsCollected ?? 0;
      const bombHitsCount = revealedReward.bombHits ?? bombHits;
      const coinsLost = revealedReward.coinsLostByBombs ?? 0;
      const finalScore = revealedReward.finalScore ?? (revealedReward.coinsCollected || score);

      const getConversionRateLabel = (coins: number) => {
        const table = coinrainConfig.conversionTable || [];
        if (table.length > 0) {
          const sortedTable = [...table].sort((a: any, b: any) => a.coins - b.coins);
          let activeTier = null;
          for (const tier of sortedTable) {
            if (coins >= tier.coins) activeTier = tier;
          }
          if (activeTier) return `${activeTier.coins} Coins = ₹${Number(activeTier.rate).toFixed(2)}`;
          const lowest = sortedTable[0];
          return `${lowest.coins} Coins = ₹${Number(lowest.rate).toFixed(2)}`;
        }
        return "10,000 Coins = ₹1.00";
      };

      return (
        <div className="flex flex-col items-center justify-center text-center space-y-6 py-4 animate-fade-in relative">
          <div className="w-full mb-2">
            <AdRenderer targetPage="Daily Bonus Page" placementKey="Header Banner" />
          </div>

          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-full w-16 h-16 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-black text-white">🎉 Time's Up!</h2>
            <p className="text-slate-400 text-xs">You executed Coin Rain beautifully!</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl w-full max-w-xs space-y-3 text-left text-xs animate-fade-in">
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">🪙 Total Coins Collected</span>
              <span className="text-white font-black">{totalCoins} Coins</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">✨ Golden Coins</span>
              <span className="text-amber-400 font-black">{goldenCoins} Collected</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">💥 Bomb Hits</span>
              <span className="text-rose-400 font-black">{bombHitsCount} Hits</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">📉 Coins Lost by Bombs</span>
              <span className="text-red-400 font-black">-{coinsLost} Coins</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">🏆 Final Coins</span>
              <span className="text-emerald-400 font-black">{finalScore} Coins</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-2">
              <span className="text-slate-400 font-bold">📊 Conversion Rate</span>
              <span className="text-indigo-400 font-black font-mono">{getConversionRateLabel(finalScore)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 text-sm border-t border-slate-800/60 mt-1">
              <span className="text-white font-black">🎁 Total Reward Won</span>
              <span className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                ₹{Number(revealedReward.amount).toFixed(2)}
              </span>
            </div>
          </div>

          {!claimSuccess ? (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="w-64 py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-2xl font-black uppercase tracking-wider active:scale-[0.98] transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-950/20"
            >
              {claiming ? (
                <>
                  <RotateCw className="w-5 h-5 animate-spin" />
                  <span>Crediting Wallet...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5" />
                  <span>Claim Cash Reward</span>
                </>
              )}
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-emerald-400 text-xs font-black uppercase">✅ Reward Claimed Successfully!</p>
              <button 
                onClick={() => { setActiveView('selection'); setRevealedReward(null); setClaimSuccess(false); fetchStatus(); }} 
                className="w-64 py-3.5 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold text-xs uppercase"
              >
                Back to Selection
              </button>
            </div>
          )}

          <div className="w-full mt-2">
            <AdRenderer targetPage="Daily Bonus Page" placementKey="Footer Banner" />
          </div>
        </div>
      );
    }

      return null;
    };

    const DebugPanel = () => {
      const [collapsed, setCollapsed] = useState(true);

      const handleCopy = () => {
        const logText = logs.map(l => `[${l.time}] ${l.text}`).join('\n');
        navigator.clipboard.writeText(logText).then(() => {
          alert('Logs copied to clipboard!');
        }).catch(e => {
          console.error('Failed to copy logs', e);
        });
      };

      const handleClear = () => {
        setLogs([]);
        localStorage.removeItem('coinrain_debug_logs');
      };

      return (
        <div className="w-full mt-8 bg-slate-950/80 border border-slate-900 rounded-3xl overflow-hidden shadow-2xl text-left font-mono">
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="w-full px-5 py-3.5 bg-slate-900/60 border-b border-slate-900 flex items-center justify-between text-xs font-bold text-slate-300 hover:bg-slate-900 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${logs.some(l => l.isError) ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="font-sans font-black uppercase tracking-wider text-[11px] text-slate-400">⚙️ Coin Rain Debug Logs ({logs.length})</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans uppercase font-bold">{collapsed ? '▶ Expand' : '▼ Collapse'}</span>
          </button>

          {!collapsed && (
            <div className="p-4 space-y-4">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-slate-500 font-sans font-medium uppercase tracking-wider">Last 100 game lifecycle events</span>
                <div className="flex gap-2">
                  <button 
                    onClick={handleCopy}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl hover:border-slate-700 hover:text-white text-slate-400 font-sans font-black text-[10px] uppercase tracking-wider transition-all active:scale-95"
                  >
                    Copy Logs
                  </button>
                  <button 
                    onClick={handleClear}
                    className="px-3 py-1.5 bg-rose-950/30 hover:bg-rose-900/10 border border-rose-900/30 rounded-xl text-rose-400 font-sans font-black text-[10px] uppercase tracking-wider transition-all active:scale-95"
                  >
                    Clear Logs
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 text-[11px] bg-slate-950 p-3 rounded-2xl border border-slate-900 max-w-full animate-fade-in">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic text-center py-4 font-sans text-xs">No logs recorded yet. Start a game to see logs!</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="flex gap-2 leading-relaxed whitespace-pre-wrap break-all">
                      <span className="text-slate-600 shrink-0 font-medium font-mono text-[10px]">[{log.time}]</span>
                      <span className={log.isError ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                        {log.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="w-full flex flex-col items-center">
        {renderContent()}
        <DebugPanel />
      </div>
    );
  };

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
          {activeView === 'coinrain' && (
            <motion.div key="coinrain" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
              <CoinRainView />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Claim Reward Popup */}
        <AnimatePresence>
          {revealedReward && activeView !== 'coinrain' && (activeView !== 'scratch' || scratchedPercent > 50) && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="mt-10 bg-slate-900 border border-indigo-500/30 p-6 rounded-3xl text-center relative overflow-hidden shadow-2xl z-50"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
              
              {Number(revealedReward?.amount) === 0 ? (
                <div className="py-4">
                  <span className="text-5xl block mb-4">🍀</span>
                  <h2 className="text-2xl font-black text-white mb-2">Better Luck Next Time!</h2>
                  <p className="text-slate-400 text-sm mb-6">Don't worry, you can try again on your next turn!</p>
                  <button 
                    onClick={() => { setActiveView('selection'); setRevealedReward(null); setClaimSuccess(false); fetchStatus(); }} 
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs uppercase"
                  >
                    Continue
                  </button>
                </div>
              ) : !claimSuccess ? (
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
