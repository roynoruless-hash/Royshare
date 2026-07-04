import React from "react";
import { useTelegramAuth } from "../context/TelegramAuthContext";
import { motion } from "motion/react";
import { Wallet, ArrowLeft, TrendingUp, History, Download, CreditCard, ShieldCheck } from "lucide-react";

export const WalletPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { user } = useTelegramAuth();

  if (!user) return null;

  const displayBalance = user.availableBalance !== undefined ? user.availableBalance : (user.balance || 0);
  const displayWithdrawn = user.withdrawnAmount !== undefined ? user.withdrawnAmount : 0;
  const displayTotalEarnings = user.totalEarnings !== undefined ? user.totalEarnings : (
    (user.fileEarnings || 0) + 
    (user.linkEarnings || 0) + 
    (user.referralEarnings || 0) + 
    (user.bonusBalance || 0) + 
    (user.rewardBalance || 0)
  );

  const transactions = [
    { id: 1, type: "Survey Reward", amount: 45.50, date: "Today, 2:30 PM", status: "Completed" },
    { id: 2, type: "Daily Bonus", amount: 5.00, date: "Today, 10:15 AM", status: "Completed" },
    { id: 3, type: "Referral Bonus", amount: 150.00, date: "Yesterday, 6:45 PM", status: "Completed" },
    { id: 4, type: "Smart Link Reward", amount: 12.20, date: "Yesterday, 4:20 PM", status: "Completed" },
  ];

  return (
    <div className="min-h-screen bg-[#020617] text-white">
      <header className="p-4 flex items-center gap-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
          <ArrowLeft className="w-6 h-6 text-slate-400" />
        </button>
        <h2 className="text-xl font-bold text-white">My Wallet</h2>
      </header>

      <main className="p-6 space-y-6">
        {/* Balance Card */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2.5rem] p-8 shadow-2xl shadow-blue-500/20 relative overflow-hidden"
        >
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-blue-100/80 text-sm font-medium mb-2">
              <Wallet className="w-4 h-4" /> Available Balance
            </div>
            <h3 className="text-5xl font-black tracking-tighter mb-8">₹{displayBalance.toLocaleString()}</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => alert("Withdrawal system is processing - You will be notified in Telegram.")}
                className="bg-white text-blue-600 py-4 rounded-2xl font-bold text-sm shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> Withdraw
              </button>
              <button 
                onClick={() => alert("History feature coming soon")}
                className="bg-blue-500/20 border border-white/20 text-white py-4 rounded-2xl font-bold text-sm backdrop-blur-md active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <History className="w-4 h-4" /> History
              </button>
            </div>
          </div>
          <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
        </motion.div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">Today's Profit</p>
            <p className="text-emerald-400 font-bold text-lg">+₹{user.todayEarnings}</p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4">
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Payouts</p>
            <p className="text-blue-400 font-bold text-lg">₹{displayWithdrawn.toLocaleString()}</p>
          </div>
        </div>

        {/* Detailed Earnings Breakdown */}
        <div className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-6 space-y-4">
          <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1">Earnings Breakdown</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">File Earnings</span>
              <p className="font-extrabold text-white mt-1">₹{(user.fileEarnings || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Link Earnings</span>
              <p className="font-extrabold text-white mt-1">₹{(user.linkEarnings || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Referral Earnings</span>
              <p className="font-extrabold text-white mt-1">₹{(user.referralEarnings || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Bonus Balance</span>
              <p className="font-extrabold text-white mt-1">₹{(user.bonusBalance || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Reward Balance</span>
              <p className="font-extrabold text-white mt-1">₹{(user.rewardBalance || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Monthly Earnings</span>
              <p className="font-extrabold text-white mt-1">₹{(user.monthEarnings || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Pending Withdrawals</span>
              <p className="font-extrabold text-amber-500 mt-1">₹{(user.pendingWithdrawals || 0).toLocaleString()}</p>
            </div>
            <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800/40">
              <span className="text-xs text-slate-400">Total Income</span>
              <p className="font-extrabold text-indigo-400 mt-1">₹{displayTotalEarnings.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Security Notice */}
        <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-emerald-500" />
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Your funds are protected by RoyShare's secure vault system. Payouts are processed within 24-48 hours.
          </p>
        </div>

        {/* Recent Transactions */}
        <div className="space-y-4">
          <h4 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-1">Recent Transactions</h4>
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div key={tx.id} className="bg-slate-900/40 border border-slate-800/50 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center text-emerald-400">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">{tx.type}</p>
                    <p className="text-[10px] text-slate-500 font-medium">{tx.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-emerald-400">+₹{tx.amount.toFixed(2)}</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase">{tx.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};
