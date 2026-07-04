import React, { useState } from "react";
import { useTelegramAuth } from "../context/TelegramAuthContext";
import { motion, AnimatePresence } from "motion/react";
import { Wallet, TrendingUp, Award, Share2, Gift, CreditCard, History, Settings, PlayCircle, ClipboardList, Gamepad2, Receipt, Users, Star, ArrowLeft, Disc } from "lucide-react";
import { SurveyPage } from "./SurveyPage";
import { WalletPage } from "./WalletPage";
import DailyBonusPage from "./DailyBonusPage";

export const MiniAppHome: React.FC = () => {
  const { user } = useTelegramAuth();
  const [currentView, setCurrentView] = useState<string>("home");

  if (!user) return null;

  if (currentView === "surveys") {
    return <SurveyPage onBack={() => setCurrentView("home")} />;
  }

  if (currentView === "wallet" || currentView === "withdraw") {
    return <WalletPage onBack={() => setCurrentView("home")} />;
  }

  if (currentView === "daily-bonus" || currentView === "spin-wheel") {
    return (
      <div className="min-h-screen bg-[#020617]">
        <header className="p-4 flex items-center gap-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
          <button onClick={() => setCurrentView("home")} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
            <ArrowLeft className="w-6 h-6 text-slate-400" />
          </button>
          <h2 className="text-xl font-bold text-white">{currentView === "spin-wheel" ? "Spin Wheel" : "Daily Bonus"}</h2>
        </header>
        <DailyBonusPage />
      </div>
    );
  }

  const actionButtons = [
    { id: "ads", label: "Watch Ads", icon: PlayCircle, color: "bg-blue-500", shadow: "shadow-blue-500/20" },
    { id: "surveys", label: "Surveys", icon: ClipboardList, color: "bg-purple-500", shadow: "shadow-purple-500/20" },
    { id: "spin-wheel", label: "Spin Wheel", icon: Disc, color: "bg-indigo-600", shadow: "shadow-indigo-500/20" },
    { id: "offerwall", label: "Offerwall", icon: Gamepad2, color: "bg-orange-500", shadow: "shadow-orange-500/20" },
    { id: "receipts", label: "Magic Receipts", icon: Receipt, color: "bg-emerald-500", shadow: "shadow-emerald-500/20" },
    { id: "cashback", label: "Cashback", icon: CreditCard, color: "bg-pink-500", shadow: "shadow-pink-500/20" },
    { id: "refer", label: "Refer & Earn", icon: Share2, color: "bg-indigo-500", shadow: "shadow-indigo-500/20" },
    { id: "daily-bonus", label: "Daily Bonus", icon: Gift, color: "bg-amber-500", shadow: "shadow-amber-500/20" },
    { id: "withdraw", label: "Withdraw", icon: Wallet, color: "bg-rose-500", shadow: "shadow-rose-500/20" },
    { id: "wallet", label: "Wallet", icon: Wallet, color: "bg-blue-600", shadow: "shadow-blue-600/20" },
    { id: "promos", label: "Promos", icon: Award, color: "bg-amber-600", shadow: "shadow-amber-600/20" },
    { id: "history", label: "History", icon: History, color: "bg-slate-500", shadow: "shadow-slate-500/20" },
    { id: "settings", label: "Settings", icon: Settings, color: "bg-zinc-500", shadow: "shadow-zinc-500/20" },
  ];

  const handleAction = (id: string, label: string) => {
    if (id === "surveys") {
      setCurrentView("surveys");
    } else if (id === "daily-bonus" || id === "spin-wheel") {
      setCurrentView(id);
    } else if (id === "wallet" || id === "withdraw") {
      setCurrentView("wallet");
    } else if (id === "ads") {
      alert("Watch Ads feature is active - Reward processing...");
    } else {
      alert(`${label} feature is coming soon!`);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white overflow-x-hidden pb-12">
      <header className="relative pt-12 pb-24 px-6 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-blue-600/20 to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center">
          <motion.div 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-24 h-24 rounded-full border-4 border-slate-800 p-1 bg-slate-900 mb-4 shadow-xl"
          >
            <img 
              src={user.photoUrl || `https://ui-avatars.com/api/?name=${user.firstName}&background=0D8ABC&color=fff`} 
              alt={user.username}
              className="w-full h-full rounded-full object-cover"
            />
          </motion.div>
          <motion.h2 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold tracking-tight mb-1"
          >
            {user.firstName} {user.lastName}
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-slate-400 text-sm mb-4"
          >
            @{user.username || "user"}
          </motion.p>
          
          <div className="flex gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-bold rounded-full border border-amber-500/20">
              <Star className="w-3 h-3 fill-amber-400" /> {user.level} Level
            </span>
            {user.isPremium && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-bold rounded-full border border-blue-500/20">
                Premium
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="px-6 -mt-16 relative z-20 space-y-4">
        {/* Main Wallet Card */}
        <motion.div 
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 shadow-2xl shadow-black/50"
        >
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">Wallet Balance</p>
              <h3 className="text-4xl font-bold tracking-tighter">₹{user.balance.toLocaleString()}</h3>
            </div>
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/40">
              <Wallet className="w-6 h-6" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800/50">
            <div>
              <p className="text-slate-500 text-xs mb-1">Today's Earnings</p>
              <p className="text-emerald-400 font-bold">₹{user.todayEarnings}</p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">Total Earnings</p>
              <p className="text-blue-400 font-bold">₹{user.totalEarnings}</p>
            </div>
          </div>
        </motion.div>

        {/* Referral Section */}
        <motion.div 
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 flex justify-between items-center"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center">
              <Share2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest">Referral Code</p>
              <p className="text-white font-mono font-bold">{user.referralCode}</p>
            </div>
          </div>
          <button 
            onClick={() => {
              navigator.clipboard.writeText(user.referralCode);
              alert("Referral code copied!");
            }}
            className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            Copy
          </button>
        </motion.div>
      </div>

      {/* Action Grid */}
      <section className="px-6 mt-8">
        <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4 px-1">Quick Actions</h4>
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-2 gap-3"
        >
          {actionButtons.map((btn, idx) => (
            <motion.button
              key={idx}
              variants={itemVariants}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleAction(btn.id, btn.label)}
              className={`flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-900/40 border border-slate-800/50 hover:border-slate-700 transition-all group`}
            >
              <div className={`w-12 h-12 ${btn.color} ${btn.shadow} rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                <btn.icon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs font-bold text-slate-300">{btn.label}</span>
            </motion.button>
          ))}
        </motion.div>
      </section>

      {/* Level Banner */}
      <section className="px-6 mt-8">
        <motion.div 
          whileHover={{ scale: 1.02 }}
          className="bg-gradient-to-r from-amber-600 to-amber-400 rounded-3xl p-6 relative overflow-hidden"
        >
          <div className="relative z-10">
            <h4 className="text-white font-bold text-lg mb-1">Upgrade to Silver</h4>
            <p className="text-white/80 text-xs mb-4">Complete 10 more tasks to unlock 1.2x earnings</p>
            <div className="w-full h-1.5 bg-black/10 rounded-full overflow-hidden">
              <div className="h-full bg-white w-2/3" />
            </div>
          </div>
          <TrendingUp className="absolute top-1/2 -right-4 -translate-y-1/2 w-32 h-32 text-white/10 -rotate-12" />
        </motion.div>
      </section>
    </div>
  );
};
