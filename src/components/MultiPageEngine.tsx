import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Clock, ShieldAlert, ArrowRight, Download, ExternalLink, CheckCircle2 } from "lucide-react";
import AnimatedBackground from "./AnimatedBackground";
import AdScriptRenderer from "./AdScriptRenderer";
import AdRenderer from "./AdRenderer";

interface PageConfig {
  pageNumber: number;
  timerDuration: number;
  humanVerification: boolean;
  selectedAdIds: string[];
}

interface MultiPageEngineProps {
  type: "shortener" | "download";
  id: string; // shortLink alias/id or fileId
}

export default function MultiPageEngine({ type, id }: MultiPageEngineProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemData, setItemData] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Page state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pagesConfig, setPagesConfig] = useState<PageConfig[]>([]);
  
  // Timer & interactive states
  const [timer, setTimer] = useState(10);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [humanVerified, setHumanVerified] = useState(false);
  const [isPageComplete, setIsPageComplete] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);
  const [mathQuestion, setMathQuestion] = useState("");
  
  // Final action states
  const [finalCountdown, setFinalCountdown] = useState(5);
  const [redirecting, setRedirecting] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  // Security
  const [securityChecked, setSecurityChecked] = useState(false);
  const [securityBlockReason, setSecurityBlockReason] = useState<string | null>(null);

  // Available Ads Cache
  const [allAds, setAllAds] = useState<any[]>([]);

  useEffect(() => {
    // 1. Fetch active ads for custom placement ID matching
    const fetchAds = async () => {
      try {
        const res = await fetch("/api/admin/ads");
        if (res.ok) {
          const data = await res.json();
          setAllAds(data || []);
        }
      } catch (e) {
        console.error("Error fetching ads in MultiPageEngine:", e);
      }
    };
    fetchAds();
  }, []);

  // Initialize session and fetch target item details
  useEffect(() => {
    const initSession = async () => {
      try {
        setLoading(true);
        // Get user device details for tracking
        const ua = navigator.userAgent;
        let device = "Desktop";
        if (/Mobi|Android|iPhone|iPad/i.test(ua)) {
          device = "Mobile";
        }
        
        let browser = "Unknown";
        if (ua.includes("Chrome")) browser = "Chrome";
        else if (ua.includes("Firefox")) browser = "Firefox";
        else if (ua.includes("Safari")) browser = "Safari";
        else if (ua.includes("Edge")) browser = "Edge";

        let country = "Unknown";
        try {
          const geoRes = await fetch("https://ipapi.co/json/").catch(() => null);
          if (geoRes && geoRes.ok) {
            const geoData = await geoRes.json();
            country = geoData.country_name || "Unknown";
          }
        } catch (e) {}

        const initRes = await fetch("/api/smart-links/session/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            id,
            browser,
            device,
            country
          })
        });

        const initData = await initRes.json();

        if (!initRes.ok || !initData.success) {
          setError(initData.message || "Failed to initialize redirection session.");
          setLoading(false);
          return;
        }

        // Check security blocks
        if (initData.securityBlocked) {
          setSecurityBlockReason(initData.securityReason);
          setLoading(false);
          return;
        }

        setItemData(initData.data);
        setSessionId(initData.sessionId);
        setTotalPages(initData.totalPages || 1);
        setPagesConfig(initData.pagesConfig || []);
        
        // Setup Page 1 Timer
        const page1Config = initData.pagesConfig?.find((p: any) => p.pageNumber === 1);
        const duration = page1Config ? Number(page1Config.timerDuration) : 5;
        setTimer(duration);
        setIsTimerActive(true);
        
        // Setup CAPTCHA if verification is enabled for Page 1
        if (page1Config?.humanVerification) {
          generateCaptcha();
        } else {
          setHumanVerified(true);
        }

        setLoading(false);
      } catch (err: any) {
        console.error("Error initiating session:", err);
        setError("Error establishing a secure session. Please reload.");
        setLoading(false);
      }
    };

    initSession();
  }, [type, id]);

  // Handle countdown timer
  useEffect(() => {
    let interval: any;
    if (isTimerActive && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0 && isTimerActive) {
      setIsTimerActive(false);
      // If no human verification is needed, unlock step completion immediately
      const currentConfig = pagesConfig.find((p) => p.pageNumber === currentPage);
      if (!currentConfig?.humanVerification) {
        setHumanVerified(true);
        setIsPageComplete(true);
      }
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timer, currentPage, pagesConfig]);

  // Generate simple math captcha for human verification
  const generateCaptcha = () => {
    const num1 = Math.floor(Math.random() * 9) + 1;
    const num2 = Math.floor(Math.random() * 9) + 1;
    setMathQuestion(`${num1} + ${num2}`);
    setCaptchaAnswer(String(num1 + num2));
    setCaptchaInput("");
    setCaptchaError(false);
    setHumanVerified(false);
  };

  const handleVerifyCaptcha = () => {
    if (captchaInput.trim() === captchaAnswer) {
      setHumanVerified(true);
      setCaptchaError(false);
      setIsPageComplete(true);
    } else {
      setCaptchaError(true);
    }
  };

  // Move to next page
  const handleNextPage = async () => {
    if (!isPageComplete || !sessionId) return;

    setLoading(true);
    try {
      const res = await fetch("/api/smart-links/session/page-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          pageNumber: currentPage
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Failed to save progress.");
        setLoading(false);
        return;
      }

      const next = data.nextPage;
      setCurrentPage(next);
      setIsPageComplete(false);
      setHumanVerified(false);
      
      // Load next page config
      const nextConfig = pagesConfig.find((p) => p.pageNumber === next);
      setTimer(nextConfig ? nextConfig.timerDuration : 5);
      setIsTimerActive(true);
      
      if (nextConfig?.humanVerification) {
        generateCaptcha();
      } else {
        setHumanVerified(true);
      }
      
      setLoading(false);
    } catch (err) {
      console.error("Error progressing to next page:", err);
      setError("Failed to sync progress with the server.");
      setLoading(false);
    }
  };

  // Final Action: Claim Destination URL or Secure Download
  const handleClaim = async () => {
    if (!sessionId) return;
    setRedirecting(true);
    try {
      const res = await fetch("/api/smart-links/session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || "Claim validation failed.");
        setRedirecting(false);
        return;
      }

      if (type === "shortener") {
        setDestinationUrl(data.destinationUrl);
        
        // Start auto-redirect countdown if enabled
        if (itemData?.autoRedirect !== false) {
          const delay = itemData?.finalRedirectDelay !== undefined ? Number(itemData.finalRedirectDelay) : 5;
          setFinalCountdown(delay);
          
          let cd = delay;
          const rdInterval = setInterval(() => {
            cd--;
            setFinalCountdown(cd);
            if (cd <= 0) {
              clearInterval(rdInterval);
              window.location.href = data.destinationUrl;
            }
          }, 1000);
        }
      } else {
        setDownloadUrl(data.downloadUrl);
        // Automatically open file download link in a new tab if available
        if (data.downloadUrl) {
          window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
        }
      }
    } catch (err) {
      console.error("Error claiming target:", err);
      setError("An error occurred during final redirection.");
      setRedirecting(false);
    }
  };

  if (loading && currentPage === 1) {
    return (
      <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden">
        <AnimatedBackground />
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
          <span className="text-slate-400 font-medium">Verifying security parameters and loading center...</span>
        </main>
      </div>
    );
  }

  if (securityBlockReason) {
    return (
      <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden">
        <AnimatedBackground />
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-md bg-slate-900/90 border border-rose-500/20 backdrop-blur-md rounded-2xl p-8 shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
              <ShieldAlert size={36} />
            </div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">Access Restricted</h2>
            <p className="text-slate-400 text-sm leading-relaxed">{securityBlockReason}</p>
            <div className="text-xs text-slate-500 border-t border-white/5 pt-4">
              Your IP and session signatures are registered for security compliance.
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden">
        <AnimatedBackground />
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-md bg-slate-900/90 border border-rose-500/20 backdrop-blur-md rounded-2xl p-8 shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400 animate-pulse">
              <ShieldAlert size={36} />
            </div>
            <h2 className="text-xl font-bold text-white">An Error Occurred</h2>
            <p className="text-slate-400 text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition"
            >
              🔄 Try Again
            </button>
          </div>
        </main>
      </div>
    );
  }

  const currentPageConfig = pagesConfig.find((p) => p.pageNumber === currentPage);
  
  // Find current page ads
  const currentPageAds = allAds.filter((ad) => 
    currentPageConfig?.selectedAdIds?.includes(ad.id)
  );

  const isFinalStep = currentPage > totalPages;

  return (
    <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between border-b border-white/5 bg-slate-950/20 backdrop-blur-sm">
        <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-indigo-500 bg-clip-text text-transparent">
          RoyShare Center
        </span>
        <div className="text-xs text-slate-400 font-medium bg-slate-900/80 px-3 py-1 rounded-full border border-white/5">
          {!isFinalStep ? `Step ${currentPage} of ${totalPages}` : "Final Verification"}
        </div>
      </header>

      {/* Header Banner Ad */}
      {!isFinalStep && (
        <div className="relative z-10 w-full max-w-xl mx-auto px-6 mt-4">
          <AdRenderer targetPage={type === "download" ? "Download Page" : "URL Shortener"} placementKey="Header Banner" />
        </div>
      )}

      {/* Main Content Arena */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-xl bg-slate-900/80 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-2xl space-y-6">
          <AnimatePresence mode="wait">
            {!isFinalStep ? (
              <motion.div
                key={`step-${currentPage}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Step Instructions */}
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
                    <span>🔗</span> {type === "download" ? "RoyShare Secure File Portal" : "RoyShare Smart URL Hub"}
                  </h1>
                  <p className="text-slate-400 text-sm">
                    {itemData?.instructions || "Follow the instructions below to unlock your destination link."}
                  </p>
                </div>

                {/* Progress Indicators */}
                <div className="bg-slate-950/60 rounded-xl p-6 border border-white/5 space-y-4 text-sm relative overflow-hidden">
                  {/* Step status bar */}
                  <div className="flex justify-between items-center text-xs font-mono text-slate-500">
                    <span>Task Verification Step {currentPage}</span>
                    <span className="text-teal-400">Status: In Progress</span>
                  </div>

                  <div className="h-px bg-white/5"></div>

                  {/* Timer Loop */}
                  {timer > 0 ? (
                    <div className="text-center py-4 space-y-2">
                      <div className="text-5xl font-black text-teal-400 tracking-tight animate-pulse">{timer}s</div>
                      <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
                        <Clock size={12} className="animate-spin" /> Seconds remaining until page unlocks
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-2 space-y-4">
                      <p className="text-emerald-400 font-semibold text-sm flex items-center justify-center gap-1.5 bg-emerald-500/10 py-2 px-4 rounded-lg border border-emerald-500/15">
                        ✅ Page unlocked! Proceed to verification.
                      </p>

                      {/* Math Verification Box if Enabled */}
                      {currentPageConfig?.humanVerification && !humanVerified && (
                        <div className="bg-slate-900 border border-white/10 rounded-xl p-4 space-y-3 max-w-xs mx-auto">
                          <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">Solve Math Challenge</p>
                          <div className="flex items-center justify-center gap-3">
                            <span className="font-mono text-lg font-bold text-teal-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-white/5">
                              {mathQuestion}
                            </span>
                            <span className="text-slate-400 font-bold">=</span>
                            <input
                              type="number"
                              placeholder="Answer"
                              value={captchaInput}
                              onChange={(e) => setCaptchaInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleVerifyCaptcha()}
                              className="w-20 bg-slate-950 border border-slate-800 rounded-lg py-1.5 text-center font-mono text-lg text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          {captchaError && (
                            <p className="text-[11px] text-rose-400 font-semibold">❌ Incorrect response. Try again!</p>
                          )}
                          <button
                            onClick={handleVerifyCaptcha}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 rounded-lg text-xs transition"
                          >
                            Verify Human
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Selected Page Ads Display */}
                {currentPageAds.length > 0 && (
                  <div className="space-y-4 pt-2">
                    {currentPageAds.map((ad, i) => (
                      <div key={ad.id || i} className="bg-slate-950/40 rounded-xl p-4 border border-white/5">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">
                          Sponsored Link ({ad.adSource} - {ad.adType})
                        </p>
                        <div className="flex justify-center items-center overflow-hidden w-full">
                          {ad.adType === "Direct Link" || ad.adType === "Direct Link Ad" ? (
                            <a
                              href={ad.scriptCode}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 bg-gradient-to-r from-teal-500/20 to-indigo-500/20 hover:from-teal-500/30 hover:to-indigo-500/30 text-teal-300 font-semibold py-2.5 px-5 rounded-lg text-xs transition-all border border-teal-500/20 shadow-md"
                            >
                              🚀 Click here to visit Sponsor Link <ExternalLink size={12} />
                            </a>
                          ) : (
                            <AdScriptRenderer scriptCode={ad.scriptCode} adType={ad.adType} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Secondary/Backup Ads */}
                {currentPageAds.length === 0 && (
                  <AdRenderer targetPage={type === "download" ? "Download Page" : "URL Shortener"} placementKey="Secondary Banner" />
                )}

                {/* Progression Control */}
                <div className="pt-2">
                  <button
                    onClick={handleNextPage}
                    disabled={!isPageComplete}
                    className={`w-full py-4 rounded-xl font-bold text-sm tracking-wide transition duration-300 transform active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg ${
                      isPageComplete
                        ? "bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white shadow-teal-500/10 cursor-pointer"
                        : "bg-slate-800 text-slate-500 border border-white/5 cursor-not-allowed shadow-none"
                    }`}
                  >
                    {isPageComplete ? (
                      <>
                        Proceed to Next Step <ArrowRight size={16} />
                      </>
                    ) : timer > 0 ? (
                      `🔓 Unlocking in ${timer}s...`
                    ) : (
                      "Solve verification above to proceed"
                    )}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="final-step"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto text-emerald-400 animate-bounce">
                    <CheckCircle2 size={36} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-extrabold text-white tracking-tight">🎉 Verification Completed</h2>
                    <p className="text-slate-400 text-sm mt-1">
                      All steps successfully completed. Access is now fully authorized!
                    </p>
                  </div>
                </div>

                {type === "download" ? (
                  // DOWNLOAD FINAL CORE VIEW
                  <div className="bg-slate-950/60 rounded-xl p-6 border border-white/5 space-y-4 text-sm text-left">
                    <p className="text-slate-400 font-semibold">Your secure file is ready for download:</p>
                    <div className="h-px bg-white/5 my-2"></div>
                    <div className="space-y-2 font-medium">
                      <div className="grid grid-cols-[100px_1fr] gap-x-2">
                        <span className="text-slate-500">File Name:</span>
                        <span className="text-white font-bold break-all">{itemData?.fileName || "Unknown File"}</span>
                      </div>
                      <div className="grid grid-cols-[100px_1fr] gap-x-2">
                        <span className="text-slate-500">File Size:</span>
                        <span className="text-teal-400 font-semibold">
                          {typeof itemData?.fileSize === "number"
                            ? (itemData.fileSize / (1024 * 1024)).toFixed(2) + " MB"
                            : itemData?.fileSize || "Unknown"}
                        </span>
                      </div>
                      <div className="grid grid-cols-[100px_1fr] gap-x-2">
                        <span className="text-slate-500">Date:</span>
                        <span className="text-slate-300">{itemData?.uploadDate || "N/A"}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  // SHORTENER FINAL CORE VIEW
                  <div className="bg-slate-950/60 rounded-xl p-6 border border-white/5 text-center">
                    {destinationUrl ? (
                      itemData?.autoRedirect !== false ? (
                        <div className="space-y-2 py-2">
                          <p className="text-slate-300 font-semibold text-sm">Redirecting you to your destination...</p>
                          <div className="text-4xl font-extrabold text-teal-400 animate-pulse">{finalCountdown}s</div>
                          <p className="text-slate-500 text-[10px] uppercase tracking-wider">Seconds remaining</p>
                        </div>
                      ) : (
                        <div className="text-emerald-400 font-semibold text-sm py-2">
                          Destination unlocked and ready below!
                        </div>
                      )
                    ) : (
                      <p className="text-slate-400 text-sm">Unlock your secure target link below.</p>
                    )}
                  </div>
                )}

                {/* Secondary/Backup Ads */}
                <AdRenderer targetPage={type === "download" ? "Download Page" : "URL Shortener"} placementKey="Secondary Banner" />

                {/* Final Trigger CTA */}
                <div className="pt-2">
                  {type === "download" ? (
                    downloadUrl ? (
                      <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/10 transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Download size={16} /> Click to Direct Download File
                      </a>
                    ) : (
                      <button
                        onClick={handleClaim}
                        disabled={redirecting}
                        className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white shadow-lg shadow-teal-500/10 transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {redirecting ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Creating download payload...
                          </>
                        ) : (
                          <>
                            <Download size={16} /> Unlock Download Link
                          </>
                        )}
                      </button>
                    )
                  ) : destinationUrl ? (
                    <a
                      href={destinationUrl}
                      className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/10 transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      🚀 Continue to Destination <ExternalLink size={14} />
                    </a>
                  ) : (
                    <button
                      onClick={handleClaim}
                      disabled={redirecting}
                      className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white shadow-lg shadow-teal-500/10 transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {redirecting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Verifying session authentication...
                        </>
                      ) : (
                        <>
                          🔓 Claim Destination URL <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer Banner Ad */}
      {!isFinalStep && (
        <div className="relative z-10 w-full max-w-xl mx-auto px-6 mb-4">
          <AdRenderer targetPage={type === "download" ? "Download Page" : "URL Shortener"} placementKey="Footer Banner" />
        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-4 border-t border-white/5 text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} RoyShare Center. All rights reserved.
      </footer>
    </div>
  );
}
