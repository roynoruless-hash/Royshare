import { useState, useEffect } from "react";
import { 
  ShieldCheck, ShieldAlert, Save, RefreshCw, AlertCircle, CheckCircle2, Link2, ExternalLink, Play
} from "lucide-react";
import { API_BASE } from "../config/api";

export default function TelegramLoginSettingsAdmin() {
  const [settings, setSettings] = useState({
    clientId: "",
    clientSecret: "",
    botUsername: "",
    miniAppShortName: "",
    redirectUri: "",
    trustedOrigin: "",
  });

  const [hasSecret, setHasSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<"Connected" | "Not Connected">("Not Connected");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchSettings = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/telegram-settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings({
          clientId: data.clientId || "",
          clientSecret: data.hasClientSecret ? "••••••••••••••••" : "",
          botUsername: data.botUsername || "",
          miniAppShortName: data.miniAppShortName || "",
          redirectUri: data.redirectUri || "",
          trustedOrigin: data.trustedOrigin || "",
        });
        setHasSecret(data.hasClientSecret);
        setStatus(data.isConnected ? "Connected" : "Not Connected");
      } else {
        throw new Error("Failed to load Telegram Login settings");
      }
    } catch (err: any) {
      setError(err.message || "Error fetching settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSettings((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/telegram-settings/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess("Settings saved successfully!");
        setHasSecret(true);
        if (settings.clientSecret !== "••••••••••••••••") {
          setSettings(prev => ({ ...prev, clientSecret: "••••••••••••••••" }));
        }
        setStatus(data.isConnected ? "Connected" : "Not Connected");
      } else {
        throw new Error(data.error || "Failed to save settings");
      }
    } catch (err: any) {
      setError(err.message || "Error saving settings");
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/telegram-settings/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess("Telegram configuration is valid and verified!");
        setStatus("Connected");
      } else {
        setStatus("Not Connected");
        throw new Error(data.error || "Verification failed");
      }
    } catch (err: any) {
      setError(err.message || "Error verifying configuration");
    } finally {
      setVerifying(false);
    }
  };

  const handleTestLogin = () => {
    // Generate a simple simulation login or open the configured redirectUri in a test context
    if (!settings.clientId || !settings.redirectUri) {
      setError("Please save valid Client ID and Redirect URI before testing.");
      return;
    }
    const testUrl = `${settings.redirectUri}?test=true&userId=77777777&username=test_admin_user&firstName=AdminTest&hash=simulated_hash`;
    window.open(testUrl, "_blank", "width=600,height=600");
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 bg-slate-950 p-6 md:p-8 rounded-3xl border border-slate-800 text-slate-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-400" />
            Telegram Login Settings
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Configure Telegram credentials, WebApp redirects, and trusted origins.
          </p>
        </div>

        {/* Status Card */}
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl border text-sm font-bold shadow-lg transition-all duration-300 ${
          status === "Connected" 
            ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-400" 
            : "bg-rose-950/40 border-rose-500/30 text-rose-400"
        }`}>
          {status === "Connected" ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              Connected
            </>
          ) : (
            <>
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
              Not Connected
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3.5 rounded-2xl flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3.5 rounded-2xl flex items-start gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Client ID */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
              Telegram Client ID
            </label>
            <input 
              type="text"
              name="clientId"
              placeholder="e.g. 5819401948"
              value={settings.clientId}
              onChange={handleChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 px-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm"
              required
            />
          </div>

          {/* Client Secret */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
              Telegram Client Secret / Bot Token
            </label>
            <input 
              type="password"
              name="clientSecret"
              placeholder={hasSecret ? "••••••••••••••••" : "Enter client secret or bot token"}
              value={settings.clientSecret}
              onChange={handleChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 px-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm"
              required
            />
          </div>

          {/* Bot Username */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
              Telegram Bot Username
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">@</span>
              <input 
                type="text"
                name="botUsername"
                placeholder="RoyShareEarnBot"
                value={settings.botUsername}
                onChange={handleChange}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 pl-8 pr-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm"
                required
              />
            </div>
          </div>

          {/* Mini App Short Name */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
              Telegram Mini App Short Name
            </label>
            <input 
              type="text"
              name="miniAppShortName"
              placeholder="earn"
              value={settings.miniAppShortName}
              onChange={handleChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 px-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm"
              required
            />
          </div>

          {/* Redirect URI */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5" />
              Redirect URI
            </label>
            <input 
              type="url"
              name="redirectUri"
              placeholder="https://royshare.online/telegram-callback"
              value={settings.redirectUri}
              onChange={handleChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 px-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm font-mono"
              required
            />
          </div>

          {/* Trusted Origin */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5" />
              Trusted Origin
            </label>
            <input 
              type="url"
              name="trustedOrigin"
              placeholder="https://royshare.online"
              value={settings.trustedOrigin}
              onChange={handleChange}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-3 px-4 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-all text-sm font-mono"
              required
            />
          </div>
        </div>

        {/* Buttons Grid */}
        <div className="flex flex-wrap gap-4 pt-4 border-t border-slate-900">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 min-w-[150px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-2xl shadow-lg shadow-indigo-950/20 flex items-center justify-center gap-2 text-sm transition-all"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>

          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying}
            className="flex-1 min-w-[150px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 text-sm transition-all"
          >
            {verifying ? <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" /> : <ShieldCheck className="w-4 h-4 text-indigo-400" />}
            Verify Telegram
          </button>

          <button
            type="button"
            onClick={handleTestLogin}
            className="flex-1 min-w-[150px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 text-sm transition-all"
          >
            <Play className="w-4 h-4 text-emerald-400" />
            Test Login
          </button>
        </div>
      </form>
    </div>
  );
}
