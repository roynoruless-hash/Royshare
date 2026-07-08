import { useState, useEffect } from "react";
import { Copy, Users, Target, Award, TrendingUp, CheckCircle, Clock, DollarSign } from "lucide-react";
import { API_BASE } from "../config/api";

export default function ReferralCenter({ user }: { user: any }) {
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    
    fetch(`${API_BASE}/api/referral/analytics?userId=${user.id}`)
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error fetching referral stats:", err);
        setLoading(false);
      });
  }, [user]);

  if (loading) return <div className="text-white text-center p-10">Loading Referral Center...</div>;
  if (!stats) return <div className="text-white text-center p-10">Error loading data.</div>;

  const referralLink = `https://royshare.online/ref/${stats.referralCode}`;

  return (
    <div className="min-h-screen bg-[#020617] text-white p-6 space-y-8">
      <header className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Referral Center</h1>
        <div className="bg-indigo-900/50 text-indigo-300 px-4 py-2 rounded-full font-bold">Level: {stats.currentLevel?.name || "Bronze"}</div>
      </header>

      {/* Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
            {label: "Today", value: stats.todayCount || 0, icon: TrendingUp},
            {label: "Earnings", value: `₹${stats.totalEarnings || 0}`, icon: DollarSign},
            {label: "Approved", value: stats.approvedCount || 0, icon: CheckCircle},
            {label: "Pending", value: stats.pendingCount || 0, icon: Clock},
        ].map((s, i) => (
            <div key={i} className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                <s.icon className="w-6 h-6 text-indigo-400 mb-2" />
                <p className="text-slate-400 text-xs">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
            </div>
        ))}
      </section>

      {/* Invite */}
      <section className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-4">
        <h2 className="text-xl font-bold">Invite Friends</h2>
        <div className="flex gap-2">
            <input readOnly value={referralLink} className="flex-1 bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-indigo-400 text-sm" />
            <button onClick={() => { navigator.clipboard.writeText(referralLink); setCopied(true); }} className="bg-indigo-600 p-3 rounded-xl"><Copy /></button>
        </div>
        {copied && <p className="text-emerald-400 text-xs">Copied to clipboard!</p>}
      </section>
      
      {/* Milestone Rewards */}
      <section>
        <h2 className="text-xl font-bold mb-4">Milestone Rewards</h2>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
            {[10, 25, 50, 100, 500].map(m => (
                <div key={m} className={`p-4 rounded-2xl text-center border ${stats.approvedCount >= m ? "bg-emerald-900 border-emerald-700" : "bg-slate-800 border-slate-700"}`}>
                    <Award className={`w-8 h-8 mx-auto mb-2 ${stats.approvedCount >= m ? "text-yellow-400" : "text-slate-500"}`} />
                    <p className="font-bold text-xl">{m}+</p>
                </div>
            ))}
        </div>
      </section>
    </div>
  );
}
