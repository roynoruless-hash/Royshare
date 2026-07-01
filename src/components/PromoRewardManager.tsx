import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { API_BASE } from "../config/api";
import { 
  Gift, 
  Settings, 
  Key, 
  Plus, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Copy, 
  Check, 
  BarChart3, 
  Users, 
  DollarSign, 
  AlertTriangle,
  RefreshCw,
  Calendar,
  Clock,
  ExternalLink,
  Eye,
  QrCode,
  Sparkles,
  Wand2,
  Edit3,
  Save,
  CheckCircle,
  HelpCircle
} from "lucide-react";

interface AccessCode {
  id: string;
  code: string;
  startDate: string;
  startTime: string;
  expiryDate: string;
  expiryTime: string;
  maxUsers: number;
  usedCount: number;
  enabled: boolean;
}

interface Promo {
  id: string;
  name: string;
  code: string;
  rewardAmount: number;
  totalBudget: number;
  budgetUsed: number;
  maxUsers: number;
  usedCount: number;
  startDate: string;
  startTime: string;
  expiryDate: string;
  expiryTime: string;
  enabled: boolean;
  promoPageUrl?: string;
  randomPageId?: string;
  pageId?: string;
}

interface PromoAnalytics {
  pageOpenedCount: number;
  pageUnlockedCount: number;
  wrongAccessCount: number;
  successClaimCount: number;
  failedClaimCount: number;
  budgetUsed: number;
  remainingBudget: number;
  uniqueUsersCount: number;
}

export default function PromoRewardManager() {
  const [activeSubTab, setActiveSubTab] = useState<"settings" | "access-codes" | "promos" | "analytics">("analytics");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // States
  const [settings, setSettings] = useState<any>(null);
  const [accessCodes, setAccessCodes] = useState<AccessCode[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [analytics, setAnalytics] = useState<PromoAnalytics | null>(null);

  // Copy Feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Preview and QR Code Modals
  const [previewPromo, setPreviewPromo] = useState<Promo | null>(null);
  const [qrPromo, setQrPromo] = useState<Promo | null>(null);

  // Forms States
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingAccessCode, setCreatingAccessCode] = useState(false);
  const [creatingPromo, setCreatingPromo] = useState(false);

  // Access Code Form
  const [newAccessCode, setNewAccessCode] = useState({
    code: "",
    startDate: "",
    startTime: "",
    expiryDate: "",
    expiryTime: "",
    maxUsers: ""
  });

  // Promo Form
  const [newPromo, setNewPromo] = useState({
    name: "",
    code: "",
    rewardAmount: "",
    totalBudget: "",
    maxUsers: "",
    startDate: "",
    startTime: "",
    expiryDate: "",
    expiryTime: ""
  });

  // AI Promo Generator States
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [aiGeneratedPromo, setAiGeneratedPromo] = useState<any | null>(null);
  const [isEditingGenerated, setIsEditingGenerated] = useState(false);
  const [creationSuccess, setCreationSuccess] = useState(false);

  const handleAIGeneratePromo = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    setGenerationError(null);
    setCreationSuccess(false);
    setAiGeneratedPromo(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/ai-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt })
      });
      const data = await res.json();
      if (data.success && data.data) {
        // Automatically calculate random pageId and promoPageUrl
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let rPageId = "";
        for (let i = 0; i < 12; i++) {
          rPageId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const domain = window.location.origin;
        const rPromoPageUrl = `${domain}/promo/${rPageId}`;

        setAiGeneratedPromo({
          ...data.data,
          randomPageId: rPageId,
          promoPageUrl: rPromoPageUrl
        });
      } else {
        setGenerationError(data.error || "Failed to generate promo details. Please refine your prompt.");
      }
    } catch (err: any) {
      console.error("AI Promo Generation error:", err);
      setGenerationError(err.message || "An unexpected error occurred during AI generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAICreatePromo = async () => {
    if (!aiGeneratedPromo) return;
    setCreatingPromo(true);
    setCreationSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/promos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: aiGeneratedPromo.name,
          code: aiGeneratedPromo.code,
          rewardAmount: Number(aiGeneratedPromo.rewardAmount),
          totalBudget: Number(aiGeneratedPromo.totalBudget),
          maxUsers: Number(aiGeneratedPromo.maxUsers),
          startDate: aiGeneratedPromo.startDate || "",
          startTime: aiGeneratedPromo.startTime || "",
          expiryDate: aiGeneratedPromo.expiryDate || "",
          expiryTime: aiGeneratedPromo.expiryTime || "",
          enabled: true
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCreationSuccess(true);
        setAiGeneratedPromo(null);
        setAiPrompt("");
        fetchData();
        setTimeout(() => setCreationSuccess(false), 5000);
      } else {
        alert(data.error || "Failed to create promo. Please check input values.");
      }
    } catch (err: any) {
      console.error("AI Create promo error:", err);
      alert(err.message || "Server error while creating promo.");
    } finally {
      setCreatingPromo(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, codesRes, promosRes, analyticsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/promo/settings`),
        fetch(`${API_BASE}/api/admin/promo/access-codes`),
        fetch(`${API_BASE}/api/admin/promo/promos`),
        fetch(`${API_BASE}/api/admin/promo/analytics`)
      ]);

      const settingsData = await settingsRes.json();
      const codesData = await codesRes.json();
      const promosData = await promosRes.json();
      const analyticsData = await analyticsRes.json();

      if (settingsData.success) setSettings(settingsData.settings);
      if (codesData.success) {
        setAccessCodes(codesData.codes || []);
        console.log("Access Codes Reloaded");
      }
      if (promosData.success) setPromos(promosData.promos || []);
      if (analyticsData.success) setAnalytics(analyticsData.analytics);
    } catch (err) {
      console.error("Error loading admin promo rewards:", err);
      setError("Failed to fetch administrative data from the server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const triggerCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRegenerateLink = async (promoId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/promos/regenerate/${promoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: window.location.origin })
      });
      const data = await res.json();
      if (data.success) {
        setPromos((prev) =>
          prev.map((p) => (p.id === promoId ? { ...p, promoPageUrl: data.promoPageUrl } : p))
        );
      }
    } catch (err) {
      console.error("Error regenerating link:", err);
    }
  };

  // Toggle handlers
  const handleToggleAccessCode = async (id: string, currentStatus: boolean) => {
    console.log("Firestore Write Started");
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/access-codes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentStatus })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        console.log("Firestore Write Success");
        setAccessCodes(accessCodes.map(c => c.id === id ? { ...c, enabled: !currentStatus } : c));
        alert("Access Code status updated successfully!");
      } else {
        console.error("Firestore Write Failed:", data.error || "Update failed");
        alert("Failed to update status.");
      }
    } catch (err) {
      console.error("Firestore Write Failed:", err);
      alert("Failed to update status.");
    }
  };

  const handleTogglePromo = async (id: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/promos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentStatus })
      });
      if (res.ok) {
        setPromos(promos.map(p => p.id === id ? { ...p, enabled: !currentStatus } : p));
      }
    } catch (err) {
      console.error("Toggle promo error:", err);
    }
  };

  // Delete handlers
  const handleDeleteAccessCode = async (id: string) => {
    if (!confirm("Are you sure you want to delete this access code?")) return;
    console.log("Firestore Write Started");
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/access-codes/${id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        console.log("Firestore Write Success");
        setAccessCodes(accessCodes.filter(c => c.id !== id));
        alert("Access Code deleted successfully!");
      } else {
        console.error("Firestore Write Failed:", data.error || "Delete failed");
        alert("Failed to delete access code.");
      }
    } catch (err) {
      console.error("Firestore Write Failed:", err);
      alert("Failed to delete access code.");
    }
  };

  const handleDeletePromo = async (id: string) => {
    if (!confirm("Are you sure you want to delete this promo code?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/promos/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setPromos(promos.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error("Delete promo error:", err);
    }
  };

  // Settings Save
  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        alert("Settings successfully saved!");
      }
    } catch (err) {
      console.error("Save settings error:", err);
    } finally {
      setSavingSettings(false);
    }
  };

  // Create Access Code submit
  const handleCreateAccessCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccessCode.code.trim()) {
      alert("Access Code is required");
      return;
    }
    console.log("Creating Access Code...");
    setCreatingAccessCode(true);

    try {
      console.log("Create Code: Calling API POST /api/admin/promo/access-codes");
      const res = await fetch(`${API_BASE}/api/admin/promo/access-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newAccessCode,
          enabled: true
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        console.log("Firestore Write Success");
        setNewAccessCode({
          code: "",
          startDate: "",
          startTime: "",
          expiryDate: "",
          expiryTime: "",
          maxUsers: ""
        });
        
        console.log("Reloading Access Codes...");
        await fetchData();
        console.log("Access Codes Reloaded");
        
        alert("Access Code created successfully!");
      } else {
        const errorMsg = data.error || "Failed to save the access code.";
        console.error("Firestore Write Failed:", errorMsg);
        alert(`Error: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error("Firestore Write Failed:", err);
      alert(`Network error: ${err.message || "Failed to connect to the server."}`);
    } finally {
      setCreatingAccessCode(false);
    }
  };

  // Create Promo submit
  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPromo.name.trim() || !newPromo.code.trim() || !newPromo.rewardAmount || !newPromo.totalBudget) return;
    setCreatingPromo(true);

    try {
      const res = await fetch(`${API_BASE}/api/admin/promo/promos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPromo)
      });
      if (res.ok) {
        setNewPromo({
          name: "",
          code: "",
          rewardAmount: "",
          totalBudget: "",
          maxUsers: "",
          startDate: "",
          startTime: "",
          expiryDate: "",
          expiryTime: ""
        });
        fetchData();
        alert("Promo Code created successfully!");
      }
    } catch (err) {
      console.error("Create promo error:", err);
    } finally {
      setCreatingPromo(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mr-3" />
        <span className="text-slate-400 font-medium">Syncing promo modules...</span>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-2xl text-center">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-500" />
        <p className="font-semibold">{error || "Settings file is stale."}</p>
        <button onClick={fetchData} className="mt-4 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 transition-all font-semibold text-xs">
          Retry Sync
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Section */}
      <div className="flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Gift className="w-7 h-7 text-indigo-400" />
            Promo Rewards System
          </h2>
          <p className="text-slate-400 text-xs mt-1">Manage locks, page expiration countdowns, access codes, active promos, and check overall analytics.</p>
        </div>
        
        {/* Navigation Sub-Tabs */}
        <div className="flex items-center gap-2 flex-wrap bg-slate-950 p-1.5 rounded-2xl border border-slate-900">
          {[
            { id: "analytics", name: "📈 Analytics", icon: BarChart3 },
            { id: "settings", name: "⚙️ Settings", icon: Settings },
            { id: "access-codes", name: "🔑 Access Codes", icon: Key },
            { id: "promos", name: "🎁 Promos Manager", icon: Gift }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                activeSubTab === tab.id 
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20" 
                  : "text-slate-400 hover:text-white hover:bg-slate-900"
              }`}
            >
              {tab.name}
            </button>
          ))}
          <button onClick={fetchData} className="p-2 text-slate-400 hover:text-white hover:bg-slate-900 rounded-xl transition-all border border-transparent hover:border-slate-800">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 1. ANALYTICS VIEW */}
      {activeSubTab === "analytics" && analytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Page Views", val: analytics.pageOpenedCount, desc: "Total page opened attempts", icon: ExternalLink, color: "text-blue-400" },
              { label: "Unlocked Pages", val: analytics.pageUnlockedCount, desc: "Successful access entries", icon: Key, color: "text-indigo-400" },
              { label: "Failed Accesses", val: analytics.wrongAccessCount, desc: "Incorrect key attempts", icon: AlertTriangle, color: "text-amber-500" },
              { label: "Unique Claimers", val: analytics.uniqueUsersCount, desc: "Distinct user rewards", icon: Users, color: "text-emerald-400" },
              { label: "Total Redemptions", val: analytics.successClaimCount, desc: "Successful promo claims", icon: Gift, color: "text-emerald-400" },
              { label: "Failed Claims", val: analytics.failedClaimCount, desc: "Redeem attempts failed", icon: AlertTriangle, color: "text-rose-500" },
              { label: "Budget Claimed", val: `₹${analytics.budgetUsed.toFixed(2)}`, desc: "Budget credited to users", icon: DollarSign, color: "text-teal-400" },
              { label: "Remaining Budget", val: `₹${analytics.remainingBudget.toFixed(2)}`, desc: "Budget in active promos", icon: DollarSign, color: "text-rose-400" },
            ].map((stat, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 relative overflow-hidden">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</span>
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white">{stat.val}</h3>
                  <p className="text-[10px] text-slate-400 mt-1">{stat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. SETTINGS VIEW */}
      {activeSubTab === "settings" && (
        <form onSubmit={handleSettingsSubmit} className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            <h3 className="text-md font-bold text-white border-b border-slate-850 pb-3 flex items-center gap-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              General Page Configuration
            </h3>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Toggles */}
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-850 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Promo Rewards Page</h4>
                    <p className="text-[10px] text-slate-500 mt-1">Globally enable or disable user promo rewards access.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
                    className="text-slate-400 hover:text-white transition-all"
                  >
                    {settings.enabled ? <ToggleRight className="w-11 h-11 text-indigo-500" /> : <ToggleLeft className="w-11 h-11 text-slate-600" />}
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-850 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">🔒 Require Access Code</h4>
                    <p className="text-[10px] text-slate-500 mt-1">If enabled, users must enter a valid access code to open the promo page.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, requireAccessCode: settings.requireAccessCode !== false ? false : true })}
                    className="text-slate-400 hover:text-white transition-all"
                  >
                    {settings.requireAccessCode !== false ? <ToggleRight className="w-11 h-11 text-indigo-500" /> : <ToggleLeft className="w-11 h-11 text-slate-600" />}
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-850 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Session Page Expiry</h4>
                    <p className="text-[10px] text-slate-500 mt-1">Automatically lock and expire page after a custom timer.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, expiryEnabled: !settings.expiryEnabled })}
                    className="text-slate-400 hover:text-white transition-all"
                  >
                    {settings.expiryEnabled ? <ToggleRight className="w-11 h-11 text-indigo-500" /> : <ToggleLeft className="w-11 h-11 text-slate-600" />}
                  </button>
                </div>

                {settings.expiryEnabled && (
                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                    <label className="text-[10px] font-black text-indigo-300 uppercase tracking-widest block">Timer Limit (Minutes)</label>
                    <input
                      type="number"
                      required
                      value={settings.expiryMinutes || 120}
                      onChange={(e) => setSettings({ ...settings, expiryMinutes: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Codes Integration scripts */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-indigo-300 uppercase tracking-widest block">Adsterra Banner Script/Code</label>
                  <textarea
                    rows={4}
                    value={settings.adsterraBannerCode || ""}
                    onChange={(e) => setSettings({ ...settings, adsterraBannerCode: e.target.value })}
                    placeholder="<script type='text/javascript'>...</script>"
                    className="w-full bg-slate-950 border border-slate-850 rounded-2xl px-4 py-3 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Social Channels Integration */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            <h3 className="text-md font-bold text-white border-b border-slate-850 pb-3 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              Social Media Join Actions & Verification Rules
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
              {[
                { key: "tgChannel", name: "Telegram Channel", placeholder: "https://t.me/royshare_official" },
                { key: "tgGroup", name: "Telegram Group", placeholder: "https://t.me/royshare_chat" },
                { key: "instagram", name: "Instagram", placeholder: "https://instagram.com/..." },
                { key: "facebook", name: "Facebook", placeholder: "https://facebook.com/..." },
                { key: "youtube", name: "YouTube", placeholder: "https://youtube.com/..." },
                { key: "discord", name: "Discord", placeholder: "https://discord.gg/..." },
                { key: "twitter", name: "X (Twitter)", placeholder: "https://x.com/..." }
              ].map((item) => (
                <div key={item.key} className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-white uppercase tracking-wider">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, [`${item.key}Enabled`]: !settings[`${item.key}Enabled`] })}
                      className="text-slate-400 hover:text-white transition-all text-xs flex items-center gap-1.5"
                    >
                      {settings[`${item.key}Enabled`] ? (
                        <span className="bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">Active</span>
                      ) : (
                        <span className="bg-slate-800 border border-slate-700 text-slate-500 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">Offline</span>
                      )}
                    </button>
                  </div>
                  {settings[`${item.key}Enabled`] && (
                    <input
                      type="url"
                      required
                      value={settings[`${item.key}Url`] || ""}
                      onChange={(e) => setSettings({ ...settings, [`${item.key}Url`]: e.target.value })}
                      placeholder={item.placeholder}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/10 transition-all active:scale-95 disabled:opacity-50"
            >
              {savingSettings ? "Saving Settings..." : "💾 Save settings"}
            </button>
          </div>
        </form>
      )}

      {/* 3. ACCESS CODES VIEW */}
      {activeSubTab === "access-codes" && (
        <div className="grid lg:grid-cols-3 gap-6 items-start">
          {/* Create Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 lg:col-span-1">
            <h3 className="text-md font-bold text-white border-b border-slate-850 pb-3 flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-400" />
              New Access Code
            </h3>

            <form onSubmit={handleCreateAccessCode} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Access Code</label>
                <input
                  type="text"
                  required
                  value={newAccessCode.code}
                  onChange={(e) => setNewAccessCode({ ...newAccessCode, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. SPECIALPASS"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold uppercase tracking-wider"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Start Date</label>
                  <input
                    type="date"
                    required
                    value={newAccessCode.startDate}
                    onChange={(e) => setNewAccessCode({ ...newAccessCode, startDate: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Start Time</label>
                  <input
                    type="time"
                    required
                    value={newAccessCode.startTime}
                    onChange={(e) => setNewAccessCode({ ...newAccessCode, startTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Expiry Date</label>
                  <input
                    type="date"
                    required
                    value={newAccessCode.expiryDate}
                    onChange={(e) => setNewAccessCode({ ...newAccessCode, expiryDate: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Expiry Time</label>
                  <input
                    type="time"
                    required
                    value={newAccessCode.expiryTime}
                    onChange={(e) => setNewAccessCode({ ...newAccessCode, expiryTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Maximum Users Limit</label>
                <input
                  type="number"
                  required
                  value={newAccessCode.maxUsers}
                  onChange={(e) => setNewAccessCode({ ...newAccessCode, maxUsers: e.target.value })}
                  placeholder="e.g. 500"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={creatingAccessCode}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/10 transition-all disabled:opacity-50"
              >
                {creatingAccessCode ? "Creating..." : "✨ Create Code"}
              </button>
            </form>
          </div>

          {/* List Codes */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden lg:col-span-2">
            <div className="px-6 py-5 border-b border-slate-850">
              <h3 className="text-md font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-400" />
                Active Access Codes ({accessCodes.length})
              </h3>
            </div>

            {accessCodes.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">No access codes found. Create one to enable users to access the promo rewards page.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/50 text-slate-400 font-bold uppercase text-[9px] tracking-widest border-b border-slate-850">
                      <th className="p-4">Access Code</th>
                      <th className="p-4">Validity Range</th>
                      <th className="p-4">Users Limit</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {accessCodes.map((code) => (
                      <tr key={code.id} className="hover:bg-slate-950/25">
                        <td className="p-4 font-black text-white flex items-center gap-2">
                          {code.code}
                          <button onClick={() => triggerCopy(code.code, code.id)} className="text-slate-500 hover:text-white">
                            {copiedId === code.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="p-4 text-slate-400 font-medium">
                          <p className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {code.startDate} {code.startTime}</p>
                          <p className="flex items-center gap-1 mt-1 text-rose-400"><Clock className="w-3 h-3" /> {code.expiryDate} {code.expiryTime}</p>
                        </td>
                        <td className="p-4 font-bold text-indigo-400">
                          {code.usedCount} / {code.maxUsers || "unlimited"}
                        </td>
                        <td className="p-4">
                          <button onClick={() => handleToggleAccessCode(code.id, code.enabled)}>
                            {code.enabled ? (
                              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">Active</span>
                            ) : (
                              <span className="bg-slate-800 border border-slate-700 text-slate-500 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">Disabled</span>
                            )}
                          </button>
                        </td>
                        <td className="p-4 text-right">
                          <button onClick={() => handleDeleteAccessCode(code.id)} className="p-2 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/10 text-rose-400 rounded-xl transition-all">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. PROMOS MANAGER VIEW */}
      {activeSubTab === "promos" && (
        <div className="grid lg:grid-cols-3 gap-6 items-start">
          {/* Create Form and AI Promo Generator */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* AI Promo Generator Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
              <h3 className="text-md font-bold text-white border-b border-slate-850 pb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="text-xl">🤖</span>
                  AI Promo Generator
                </span>
                <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  Gemini Flash 3.5
                </span>
              </h3>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block flex items-center justify-between">
                    <span>Describe Your Promo Reward Prompt</span>
                    <span title="Explain budget, reward, claims, dates or names, and AI will extract it all!">
                      <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 cursor-pointer" />
                    </span>
                  </label>
                  <textarea
                    rows={4}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Example:&#10;Total Budget ₹1000&#10;Reward ₹10&#10;100 Users&#10;Promo Name: Independence Bonus&#10;Promo Code: INDIA100&#10;Start: 15 Aug 2026 10:00 AM&#10;End: 20 Aug 2026 10:00 PM"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-sans leading-relaxed"
                  />
                </div>

                <button
                  onClick={handleAIGeneratePromo}
                  disabled={isGenerating || !aiPrompt.trim()}
                  className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>AI Extracting & Calculating...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span>✨ AI Generate Promo</span>
                    </>
                  )}
                </button>

                {/* Skeleton Loader during generation */}
                {isGenerating && (
                  <div className="border border-slate-800/80 bg-slate-950/40 rounded-2xl p-5 space-y-4 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded w-1/3" />
                    <div className="space-y-2">
                      <div className="h-3 bg-slate-800 rounded w-3/4" />
                      <div className="h-3 bg-slate-800 rounded w-5/6" />
                      <div className="h-3 bg-slate-800 rounded w-1/2" />
                    </div>
                    <div className="pt-2 flex justify-between">
                      <div className="h-8 bg-slate-800 rounded-xl w-1/4" />
                      <div className="h-8 bg-slate-800 rounded-xl w-1/4" />
                    </div>
                  </div>
                )}

                {generationError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-xs flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Generation Failed</p>
                      <p className="mt-1 text-slate-400">{generationError}</p>
                    </div>
                  </div>
                )}

                {creationSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl text-xs flex gap-2 items-center">
                    <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                    <div>
                      <p className="font-bold">✅ Promo Created Successfully</p>
                      <p className="mt-0.5 text-slate-400">The promotional page is now live and saved to Firestore!</p>
                    </div>
                  </div>
                )}

                {/* AI generated preview card */}
                {aiGeneratedPromo && !isGenerating && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-indigo-500/30 bg-slate-950/80 rounded-2xl p-5 space-y-5 shadow-xl relative overflow-hidden"
                  >
                    {/* Glow effect */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

                    <div className="border-b border-slate-850 pb-3 flex items-center justify-between">
                      <div>
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest block">AI Promo Preview</span>
                        <h4 className="text-sm font-bold text-white truncate max-w-[150px]">{aiGeneratedPromo.name || "Untitled Promo"}</h4>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest block">Status</span>
                        <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                          Active
                        </span>
                      </div>
                    </div>

                    {/* Mathematical calculation validation warning */}
                    {Number(aiGeneratedPromo.rewardAmount) * Number(aiGeneratedPromo.maxUsers) !== Number(aiGeneratedPromo.totalBudget) && (
                      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-xl text-[11px] space-y-2">
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">⚠ Budget calculation mismatch</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Reward (₹{aiGeneratedPromo.rewardAmount}) × Claims ({aiGeneratedPromo.maxUsers}) = ₹{Number(aiGeneratedPromo.rewardAmount) * Number(aiGeneratedPromo.maxUsers)} which does not equal Budget (₹{aiGeneratedPromo.totalBudget}).
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            // Automatically fix values by adjusting total budget to match reward * claims
                            setAiGeneratedPromo({
                              ...aiGeneratedPromo,
                              totalBudget: Number(aiGeneratedPromo.rewardAmount) * Number(aiGeneratedPromo.maxUsers)
                            });
                          }}
                          className="w-full py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                        >
                          ✔ Fix Automatically
                        </button>
                      </div>
                    )}

                    {isEditingGenerated ? (
                      /* Editable fields form */
                      <div className="space-y-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Promo Name</label>
                          <input
                            type="text"
                            value={aiGeneratedPromo.name}
                            onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, name: e.target.value })}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Promo Code</label>
                          <input
                            type="text"
                            value={aiGeneratedPromo.code}
                            onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, code: e.target.value.toUpperCase() })}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white uppercase font-bold focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Reward (₹)</label>
                            <input
                              type="number"
                              value={aiGeneratedPromo.rewardAmount}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, rewardAmount: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Budget (₹)</label>
                            <input
                              type="number"
                              value={aiGeneratedPromo.totalBudget}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, totalBudget: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Max Claims</label>
                            <input
                              type="number"
                              value={aiGeneratedPromo.maxUsers}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, maxUsers: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Start Date</label>
                            <input
                              type="date"
                              value={aiGeneratedPromo.startDate}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, startDate: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider">Start Time</label>
                            <input
                              type="time"
                              value={aiGeneratedPromo.startTime}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, startTime: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider font-bold">Expiry Date</label>
                            <input
                              type="date"
                              value={aiGeneratedPromo.expiryDate}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, expiryDate: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-500 uppercase tracking-wider font-bold">Expiry Time</label>
                            <input
                              type="time"
                              value={aiGeneratedPromo.expiryTime}
                              onChange={(e) => setAiGeneratedPromo({ ...aiGeneratedPromo, expiryTime: e.target.value })}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => setIsEditingGenerated(false)}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Save Local Changes
                        </button>
                      </div>
                    ) : (
                      /* Preview Details rendering */
                      <div className="space-y-3.5">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                          <div>
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Promo Code</span>
                            <span className="font-mono font-bold text-white tracking-wide">{aiGeneratedPromo.code || "N/A"}</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Reward Amount</span>
                            <span className="font-bold text-indigo-400">₹{aiGeneratedPromo.rewardAmount || "0"}</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Total Budget</span>
                            <span className="font-bold text-white">₹{aiGeneratedPromo.totalBudget || "0"}</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Maximum Claims</span>
                            <span className="font-bold text-slate-300">{aiGeneratedPromo.maxUsers || "N/A"}</span>
                          </div>
                          <div>
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Start</span>
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {aiGeneratedPromo.startDate || "N/A"} {aiGeneratedPromo.startTime || "00:00"}
                            </span>
                          </div>
                          <div>
                            <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Expiry</span>
                            <span className="text-[10px] text-rose-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {aiGeneratedPromo.expiryDate || "N/A"} {aiGeneratedPromo.expiryTime || "23:59"}
                            </span>
                          </div>
                        </div>

                        {/* Random URL section */}
                        <div className="bg-slate-900 border border-slate-850 p-3 rounded-xl space-y-1">
                          <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider block">Random Public URL</span>
                          <a
                            href={aiGeneratedPromo.promoPageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-indigo-400 hover:underline font-mono truncate block flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            <span className="truncate">{aiGeneratedPromo.promoPageUrl}</span>
                          </a>
                        </div>

                        {/* QR Code generator */}
                        <div className="flex flex-col items-center justify-center bg-white p-3 rounded-2xl w-32 h-32 mx-auto border border-slate-800">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&color=020617&data=${encodeURIComponent(aiGeneratedPromo.promoPageUrl)}`}
                            alt="QR Code"
                            className="w-24 h-24"
                          />
                          <span className="text-[7px] text-slate-500 font-bold uppercase tracking-widest mt-1">Scan Preview</span>
                        </div>

                        {/* Action buttons on card */}
                        <div className="pt-2 flex gap-2">
                          <button
                            onClick={() => setIsEditingGenerated(true)}
                            className="flex-1 py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                          >
                            <Edit3 className="w-3 h-3 text-slate-400" />
                            Edit
                          </button>
                          <button
                            onClick={handleAIGeneratePromo}
                            className="flex-1 py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-all"
                          >
                            <RefreshCw className="w-3 h-3 text-slate-400" />
                            Regenerate
                          </button>
                        </div>

                        <button
                          onClick={handleAICreatePromo}
                          disabled={creatingPromo}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/10 transition-all flex items-center justify-center gap-2"
                        >
                          <Save className="w-4 h-4" />
                          <span>{creatingPromo ? "Creating..." : "Save & Create Promo"}</span>
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Original Form Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
              <h3 className="text-md font-bold text-white border-b border-slate-850 pb-3 flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                New Promo reward Code
              </h3>

            <form onSubmit={handleCreatePromo} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Promo Name</label>
                <input
                  type="text"
                  required
                  value={newPromo.name}
                  onChange={(e) => setNewPromo({ ...newPromo, name: e.target.value })}
                  placeholder="e.g. Free Welcome Reward"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Promo Coupon Code</label>
                <input
                  type="text"
                  required
                  value={newPromo.code}
                  onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. ROYSHARE50"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold uppercase tracking-wider"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Reward (₹)</label>
                  <input
                    type="number"
                    required
                    value={newPromo.rewardAmount}
                    onChange={(e) => setNewPromo({ ...newPromo, rewardAmount: e.target.value })}
                    placeholder="50"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Total Budget (₹)</label>
                  <input
                    type="number"
                    required
                    value={newPromo.totalBudget}
                    onChange={(e) => setNewPromo({ ...newPromo, totalBudget: e.target.value })}
                    placeholder="25000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Start Date</label>
                  <input
                    type="date"
                    required
                    value={newPromo.startDate}
                    onChange={(e) => setNewPromo({ ...newPromo, startDate: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Start Time</label>
                  <input
                    type="time"
                    required
                    value={newPromo.startTime}
                    onChange={(e) => setNewPromo({ ...newPromo, startTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Expiry Date</label>
                  <input
                    type="date"
                    required
                    value={newPromo.expiryDate}
                    onChange={(e) => setNewPromo({ ...newPromo, expiryDate: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Expiry Time</label>
                  <input
                    type="time"
                    required
                    value={newPromo.expiryTime}
                    onChange={(e) => setNewPromo({ ...newPromo, expiryTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block">Maximum Claims Limit</label>
                <input
                  type="number"
                  required
                  value={newPromo.maxUsers}
                  onChange={(e) => setNewPromo({ ...newPromo, maxUsers: e.target.value })}
                  placeholder="e.g. 1000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={creatingPromo}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/10 transition-all disabled:opacity-50"
              >
                {creatingPromo ? "Creating..." : "✨ Create Promo"}
              </button>
            </form>
          </div>
        </div>

          {/* List Promos */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden lg:col-span-2">
            <div className="px-6 py-5 border-b border-slate-850">
              <h3 className="text-md font-bold text-white flex items-center gap-2">
                <Gift className="w-5 h-5 text-indigo-400" />
                Active Promos ({promos.length})
              </h3>
            </div>

            {promos.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">No promos found. Create a promo so users can enter and claim their balance rewards.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/50 text-slate-400 font-bold uppercase text-[9px] tracking-widest border-b border-slate-850">
                      <th className="p-4">Promo details</th>
                      <th className="p-4">Reward Amount</th>
                      <th className="p-4">Budget Progress</th>
                      <th className="p-4">Claim Limit</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {promos.map((promo) => (
                      <tr key={promo.id} className="hover:bg-slate-950/25">
                        <td className="p-4 space-y-2">
                          <div>
                            <p className="font-bold text-white text-xs">{promo.name}</p>
                            <p className="font-black text-indigo-400 mt-1 flex items-center gap-1.5 uppercase">
                              `{promo.code}`
                              <button onClick={() => triggerCopy(promo.code, promo.id)} className="text-slate-500 hover:text-white">
                                {copiedId === promo.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </p>
                          </div>
                          
                          {/* Promo Page Actions Toolbar */}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {/* Copy Page Link */}
                            <button 
                              onClick={() => {
                                const url = promo.promoPageUrl || `${window.location.origin}/promo/${promo.pageId || promo.randomPageId || promo.id}`;
                                console.log("Copy link URL:", url);
                                triggerCopy(url, `link-${promo.id}`);
                              }}
                              className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-indigo-500 hover:bg-indigo-500/5 text-[10px] font-bold text-slate-300 hover:text-indigo-400 rounded-lg flex items-center gap-1 transition-all"
                            >
                              {copiedId === `link-${promo.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400 font-black">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy Link</span>
                                </>
                              )}
                            </button>

                            {/* Preview Page */}
                            <button 
                              onClick={() => setPreviewPromo(promo)}
                              className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-indigo-500 hover:bg-indigo-500/5 text-[10px] font-bold text-slate-300 hover:text-indigo-400 rounded-lg flex items-center gap-1 transition-all"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Preview</span>
                            </button>

                            {/* Open Page */}
                            <a 
                              href={promo.promoPageUrl || `/promo/${promo.pageId || promo.randomPageId || promo.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-indigo-500 hover:bg-indigo-500/5 text-[10px] font-bold text-slate-300 hover:text-indigo-400 rounded-lg flex items-center gap-1.5 transition-all"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Open</span>
                            </a>

                            {/* QR Code */}
                            <button 
                              onClick={() => setQrPromo(promo)}
                              className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-indigo-500 hover:bg-indigo-500/5 text-[10px] font-bold text-slate-300 hover:text-indigo-400 rounded-lg flex items-center gap-1 transition-all"
                            >
                              <QrCode className="w-3 h-3" />
                              <span>QR Code</span>
                            </button>

                            {/* Regenerate Link */}
                            <button 
                              onClick={() => handleRegenerateLink(promo.id)}
                              className="px-2 py-1 bg-slate-950 border border-slate-850 hover:border-rose-500 hover:bg-rose-500/5 text-[10px] font-bold text-slate-300 hover:text-rose-400 rounded-lg flex items-center gap-1 transition-all"
                              title="Regenerate Page Link"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Regen</span>
                            </button>
                          </div>
                        </td>
                        <td className="p-4 font-black text-emerald-400 text-sm">
                          ₹{promo.rewardAmount.toFixed(2)}
                        </td>
                        <td className="p-4 font-medium text-slate-400">
                          <p>₹{promo.budgetUsed} / ₹{promo.totalBudget}</p>
                          <div className="w-24 h-1.5 bg-slate-950 rounded-full overflow-hidden mt-1.5">
                            <div 
                              className="h-full bg-indigo-500" 
                              style={{ width: `${Math.min(100, (promo.budgetUsed / promo.totalBudget) * 100)}%` }} 
                            />
                          </div>
                        </td>
                        <td className="p-4 font-bold text-slate-400">
                          {promo.usedCount} / {promo.maxUsers || "unlimited"}
                        </td>
                        <td className="p-4">
                          <button onClick={() => handleTogglePromo(promo.id, promo.enabled)}>
                            {promo.enabled ? (
                              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">Active</span>
                            ) : (
                              <span className="bg-slate-800 border border-slate-700 text-slate-500 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase">Disabled</span>
                            )}
                          </button>
                        </td>
                        <td className="p-4 text-right">
                          <button onClick={() => handleDeletePromo(promo.id)} className="p-2 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/10 text-rose-400 rounded-xl transition-all">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Preview Page Modal */}
      {previewPromo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={() => setPreviewPromo(null)} />
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-3xl relative overflow-hidden shadow-2xl flex flex-col h-[85vh] z-50 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-850 flex items-center justify-between bg-slate-950/40">
              <div>
                <h3 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-2">
                  <Eye className="w-4 h-4 text-indigo-400" />
                  Promo Page Live Preview
                </h3>
                <p className="text-[10px] text-slate-400 mt-1">Promo: <span className="font-mono text-indigo-400 font-bold uppercase">{previewPromo.name}</span></p>
              </div>
              <button 
                onClick={() => setPreviewPromo(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
              >
                Close
              </button>
            </div>
            {/* Embedded Live Web Iframe */}
            <div className="flex-1 bg-[#020617] overflow-hidden relative">
              <iframe 
                src={`/promo/${previewPromo.pageId || previewPromo.randomPageId || previewPromo.id}?userId=ADMIN_PREVIEW`} 
                title="Promo Preview"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {qrPromo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={() => setQrPromo(null)} />
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center max-w-sm w-full relative overflow-hidden shadow-2xl space-y-6 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-purple-500" />
            <div>
              <h3 className="font-black text-white text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                <QrCode className="w-4 h-4 text-indigo-400" />
                Promo Page QR Code
              </h3>
              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Scan to claim premium promo reward</p>
            </div>
            
            <div className="bg-white p-4 rounded-2xl inline-block border border-slate-800 shadow-inner">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=020617&data=${encodeURIComponent(qrPromo.promoPageUrl || `${window.location.origin}/promo/${qrPromo.pageId || qrPromo.randomPageId || qrPromo.id}`)}`}
                alt="QR Code"
                className="w-44 h-44 mx-auto"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-850 text-left">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Target URL</span>
              <span className="text-xs text-indigo-400 break-all font-mono font-medium block mt-1">
                {qrPromo.promoPageUrl || `${window.location.origin}/promo/${qrPromo.pageId || qrPromo.randomPageId || qrPromo.id}`}
              </span>
            </div>

            <button 
              onClick={() => setQrPromo(null)}
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all shadow-lg"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
