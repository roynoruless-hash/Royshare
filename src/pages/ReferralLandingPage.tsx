import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  User, Award, DollarSign, Users, CheckCircle, 
  Phone, ShieldAlert, Key, ArrowRight, ExternalLink, Loader2 
} from "lucide-react";
import { API_BASE } from "../config/api";

interface ReferrerInfo {
  id: string;
  name: string;
  level: string;
  referrals: number;
  earnings: number;
  avatar: string | null;
}

export default function ReferralLandingPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [mobile, setMobile] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referrer, setReferrer] = useState<ReferrerInfo | null>(null);
  const [banner, setBanner] = useState("Invite & Earn Lifetime Commission");
  const [rules, setRules] = useState<string[]>([]);

  useEffect(() => {
    // Extract referral code from URL if present (code, ref, or startapp)
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || params.get("ref") || params.get("startapp") || params.get("start_param");
    if (code) {
      setInviteCode(code);
      // Auto-fetch if there is an invite code
      verifyReferralCode(code);
    }

    // Load referral settings
    fetch(`${API_BASE}/api/referral/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.landingPageBanner) setBanner(data.landingPageBanner);
        if (data.referralRules) {
          const splitRules = data.referralRules.split("\n").filter((r: string) => r.trim());
          setRules(splitRules);
        }
      })
      .catch(err => console.error("Error loading referral settings:", err));
  }, []);

  const verifyReferralCode = async (codeToVerify: string) => {
    if (!codeToVerify.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/referral/verify-code?code=${encodeURIComponent(codeToVerify.trim())}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setReferrer(data.referrer);
      } else {
        setReferrer(null);
        setError(data.message || "Invalid referral code. Please check and try again.");
      }
    } catch (err) {
      console.error("Error verifying code:", err);
      setError("Failed to verify referral code. Please check your internet connection.");
    } finally {
      setVerifying(false);
    }
  };

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanMobile = mobile.replace(/[^0-9]/g, "");
    if (cleanMobile.length !== 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    setStep(2);
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!inviteCode.trim()) {
      setError("Please enter an invite code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/referral/pre-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobileNumber: mobile,
          referralCode: inviteCode.trim()
        })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Successful pre-registration! Automatically redirect to the Bot with startapp parameter
        window.location.href = data.botUrl;
      } else {
        setError(data.message || "Failed to complete verification. Please try again.");
      }
    } catch (err) {
      console.error("Error during pre-registration:", err);
      setError("An error occurred during verification. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Dynamic Animated Ambient Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px] pointer-events-none" />

      {/* Main Glass Card container */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-md bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl shadow-indigo-950/40 relative z-10"
        id="referral-glass-card"
      >
        {/* Brand Header */}
        <div className="text-center mb-6">
          <motion.div 
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-tr from-indigo-500 to-blue-500 rounded-2xl shadow-lg shadow-indigo-500/20 mb-3"
          >
            <Users className="w-6 h-6 text-white animate-pulse" />
          </motion.div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-1">RoyShare Program</h2>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white leading-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-indigo-200">
            {banner}
          </h1>
        </div>

        {/* Form Steps */}
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.form 
              key="step-1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              onSubmit={handleStep1Submit}
              className="space-y-5"
              id="step-1-form"
            >
              <div>
                <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <Phone className="w-5 h-5 text-indigo-400" />
                  Step 1: Mobile Verification
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Start earning lifetime commissions by inviting your friends. Enter your mobile number below.
                </p>
              </div>

              {/* Input Group */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Mobile Number
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm border-r border-white/10 pr-3">
                    +91
                  </span>
                  <input 
                    type="tel"
                    maxLength={10}
                    placeholder="Enter your 10 digit number"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 pl-16 pr-4 text-white font-medium placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm"
                    id="mobile-input-field"
                    required
                  />
                </div>
              </div>

              {/* Important Warn Area */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex gap-3 text-amber-300">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed space-y-1">
                  <span className="font-bold uppercase tracking-wider text-amber-400 block">
                    ⚠️ IMPORTANT: Must Match exactly
                  </span>
                  <p>
                    Please enter the <strong>SAME</strong> mobile number that you will use during Telegram registration.
                  </p>
                  <p className="text-amber-400/80 font-medium">
                    If the mobile number entered here and your Telegram registration number do not match exactly, your referral will NOT be counted.
                  </p>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3.5 text-xs text-red-400 font-medium text-center">
                  {error}
                </div>
              )}

              {/* Continue button */}
              <button 
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 active:scale-[0.98] transition-all text-white font-bold py-4 px-6 rounded-2xl shadow-lg shadow-indigo-500/10 flex items-center justify-center gap-2 text-sm"
                id="btn-step-1-continue"
              >
                Continue to Step 2
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.form>
          ) : (
            <motion.form 
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              onSubmit={handleStep2Submit}
              className="space-y-5"
              id="step-2-form"
            >
              <div>
                <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <Key className="w-5 h-5 text-indigo-400" />
                  Step 2: Referral Code
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Provide your friend's invite code to connect your registration and unlock your signup benefits.
                </p>
              </div>

              {/* Referral code input */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Referral / Invite Code
                </label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    placeholder="Enter referral code"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl py-3.5 px-4 text-white font-mono font-bold tracking-wider placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all text-sm"
                    id="invite-code-field"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => verifyReferralCode(inviteCode)}
                    disabled={verifying}
                    className="bg-white/10 hover:bg-white/15 text-white font-semibold px-4 rounded-2xl transition-all border border-white/5 text-xs shrink-0 flex items-center justify-center min-w-[70px]"
                    id="btn-verify-invite"
                  >
                    {verifying ? (
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    ) : (
                      "Verify"
                    )}
                  </button>
                </div>
              </div>

              {/* Referred by card */}
              <AnimatePresence>
                {referrer && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3 shadow-lg"
                    id="referred-by-card"
                  >
                    <div className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase">
                      Referred By
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0 text-indigo-400 font-bold overflow-hidden">
                        {referrer.avatar ? (
                          <img src={referrer.avatar} alt={referrer.name} className="w-full h-full object-cover" />
                        ) : (
                          <User className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="font-bold text-white text-sm">{referrer.name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold uppercase tracking-wider mt-0.5">
                          <Award className="w-3.5 h-3.5 shrink-0" />
                          {referrer.level} Member
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-xs">
                      <div className="bg-white/5 rounded-xl p-2 text-center">
                        <div className="text-slate-400 text-[10px] mb-0.5">Total Referrals</div>
                        <div className="font-bold text-white flex items-center justify-center gap-1">
                          <Users className="w-3.5 h-3.5 text-blue-400" />
                          {referrer.referrals} Friends
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-xl p-2 text-center">
                        <div className="text-slate-400 text-[10px] mb-0.5">Earned</div>
                        <div className="font-bold text-emerald-400 flex items-center justify-center gap-0.5">
                          ₹{referrer.earnings.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3.5 text-xs text-red-400 font-medium text-center">
                  {error}
                </div>
              )}

              {/* Navigation and Submit Buttons */}
              <div className="flex gap-3">
                <button 
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep(1);
                  }}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-white font-semibold py-4 rounded-2xl border border-white/10 transition-all text-sm"
                  id="btn-step-2-back"
                >
                  Back
                </button>
                <button 
                  type="submit"
                  disabled={loading}
                  className="flex-[2] bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:scale-[0.98] transition-all text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  id="btn-step-2-submit"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Register & Open Bot
                      <ExternalLink className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Dynamic Referral Rules List */}
        {rules.length > 0 && (
          <div className="mt-8 pt-6 border-t border-white/5 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Referral Program Rules
            </h4>
            <ul className="space-y-2 text-xs text-slate-400 leading-relaxed">
              {rules.map((rule, idx) => (
                <li key={idx} className="flex gap-2 items-start">
                  <CheckCircle className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.div>

      {/* Brand footer inside page */}
      <div className="mt-6 text-center text-slate-500 text-xs font-mono relative z-10 pointer-events-none">
        RoyShare Earn v4.0.0 • Secured & Verified
      </div>
    </div>
  );
}
