import { useState } from "react";
import { Copy, Share2, Users, Target, Award, TrendingUp, CheckCircle, Clock, XCircle, DollarSign } from "lucide-react";
import { motion } from "motion/react";

export default function ReferralCenter() {
  const [copied, setCopied] = useState(false);

  // Placeholder data - in a real app, this would come from a backend/context
  const stats = {
    approved: 120,
    pending: 5,
    today: 12,
    weekly: 45,
    monthly: 120,
    totalEarnings: 4500,
    currentCommission: "10%",
    currentLevel: "Gold"
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white p-6 space-y-8">
      <header className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Referral Center</h1>
        <div className="bg-indigo-900/50 text-indigo-300 px-4 py-2 rounded-full font-bold">Level: {stats.currentLevel}</div>
      </header>

      {/* STEP 1: Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
            {label: "Today", value: stats.today, icon: TrendingUp},
            {label: "Earnings", value: `₹${stats.totalEarnings}`, icon: DollarSign},
            {label: "Approved", value: stats.approved, icon: CheckCircle},
            {label: "Pending", value: stats.pending, icon: Clock},
        ].map((s, i) => (
            <div key={i} className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                <s.icon className="w-6 h-6 text-indigo-400 mb-2" />
                <p className="text-slate-400 text-xs">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
            </div>
        ))}
      </section>

      {/* STEP 2: Link/Code */}
      <section className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-4">
        <h2 className="text-xl font-bold">Invite Friends</h2>
        <div className="flex gap-2">
            <input readOnly value="https://royshare.com/ref/USER123" className="flex-1 bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-indigo-400" />
            <button onClick={() => setCopied(true)} className="bg-indigo-600 p-3 rounded-xl"><Copy /></button>
        </div>
      </section>

      {/* Other sections would follow here */}
      <section>
        <h2 className="text-xl font-bold mb-4">Milestone Rewards</h2>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
            {[10, 25, 50, 100, 500].map(m => (
                <div key={m} className="bg-slate-800 p-4 rounded-2xl text-center border border-slate-700">
                    <Award className="w-8 h-8 mx-auto text-yellow-500 mb-2" />
                    <p className="font-bold text-xl">{m}+</p>
                </div>
            ))}
        </div>
      </section>
    </div>
  );
}
