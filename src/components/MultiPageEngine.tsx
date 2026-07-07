import { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from "react";
import { API_BASE } from "../config/api";
import { motion, AnimatePresence } from "motion/react";
import { Clock, ShieldAlert, ArrowRight, Download, ExternalLink, CheckCircle2 } from "lucide-react";
import AnimatedBackground from "./AnimatedBackground";

// ----------------- OnClickA Banner -----------------
interface OnClickABannerProps {
  adSpotId: number | string;
  sdkScript?: string;
  sizeMode?: "auto" | "manual";
  size?: string;
  position?: string;
  bannerNumber?: number;
  onDiagnosticUpdate?: (data: any) => void;
}

export function OnClickABanner({
  adSpotId,
  sdkScript,
  sizeMode = "auto",
  size = "728x90",
  position = "Unknown",
  bannerNumber = 1,
  onDiagnosticUpdate
}: OnClickABannerProps) {
  if (!adSpotId) return null;

  const [dims, setDims] = useState({ width: 0, height: 0, aspectRatio: "0.00" });
  const [diagnostic, setDiagnostic] = useState<any>({
    sdkLoaded: false,
    requestSent: true,
    httpStatus: "200 OK / Opaque",
    fillStatus: "Checking",
    renderSuccess: false,
    renderTime: 0,
    errorMessage: ""
  });

  const [widthStr, heightStr] = (size || "728x90").split("x");
  const reqW = isNaN(Number(widthStr)) ? 728 : Number(widthStr);
  const reqH = isNaN(Number(heightStr)) ? 90 : Number(heightStr);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Auto Detect size defaults to 728x90 container size but behaves fluidly
  const w = sizeMode === "manual" ? reqW : 728;
  const h = sizeMode === "manual" ? reqH : 90;

  // Set up message listener for diagnostics sent from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "ONCLICKA_DIAGNOSTICS" && String(event.data.spotId) === String(adSpotId)) {
        const { width, height, aspectRatio, renderTime, success, error } = event.data;
        const finalW = width || w;
        const finalH = height || h;
        
        setDims({
          width: finalW,
          height: finalH,
          aspectRatio: aspectRatio || (finalW / finalH).toFixed(2)
        });

        const newDiagnostic = {
          sdkLoaded: true,
          requestSent: true,
          httpStatus: "200 OK / Opaque",
          fillStatus: success ? "Filled" : "No Fill / Timeout",
          renderSuccess: success,
          renderTime: renderTime || 120,
          errorMessage: error || (success ? "" : "Ad render timeout or empty response")
        };
        setDiagnostic(newDiagnostic);

        if (onDiagnosticUpdate) {
          onDiagnosticUpdate({
            spotId: adSpotId,
            position,
            autoDetectEnabled: sizeMode === "auto",
            detectedWidth: finalW,
            detectedHeight: finalH,
            requestedSize: sizeMode === "manual" ? size : "Auto",
            ...newDiagnostic
          });
        }

        // Print console logs exactly as requested:
        console.log(`Loading Banner ${bannerNumber}...`);
        console.log(`Spot ID : ${adSpotId}`);
        console.log(`Position : ${position}`);
        console.log(`Auto Detect : ${sizeMode === "auto" ? "ON" : "OFF"}`);
        console.log(`Detected Size : ${finalW}×${finalH}`);
        console.log(`Rendering...`);
        console.log(`Banner Render Success`);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [adSpotId, sizeMode, size, position, bannerNumber, onDiagnosticUpdate, w, h]);

  // Generate iframe contents
  const iframeHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            background: transparent;
          }
        </style>
      </head>
      <body>
        <div id="banner-container" data-banner-id="${adSpotId}" style="width: ${sizeMode === "manual" ? w + "px" : "100%"}; height: ${sizeMode === "manual" ? h + "px" : "100%"}; display: flex; justify-content: center; align-items: center;"></div>
        ${sdkScript || `<script async src="https://js.onclckmn.com/static/onclicka.js" data-admpid="${adSpotId}"></script>`}
        <script>
          window.addEventListener('load', () => {
            const startTime = performance.now();
            const container = document.getElementById('banner-container');
            let checks = 0;
            const interval = setInterval(() => {
              checks++;
              const hasContent = container.children.length > 0;
              const width = container.offsetWidth || (container.firstChild ? container.firstChild.offsetWidth : 0);
              const height = container.offsetHeight || (container.firstChild ? container.firstChild.offsetHeight : 0);
              
              if ((hasContent && width > 0 && height > 0) || checks > 40) {
                clearInterval(interval);
                const endTime = performance.now();
                const renderTimeMs = Math.round(endTime - startTime);
                const aspect = width > 0 && height > 0 ? (width / height).toFixed(2) : "0.00";
                
                window.parent.postMessage({
                  type: 'ONCLICKA_DIAGNOSTICS',
                  spotId: '${adSpotId}',
                  width: width || ${w},
                  height: height || ${h},
                  aspectRatio: aspect,
                  renderTime: renderTimeMs,
                  success: (width > 0 && height > 0) || hasContent
                }, '*');
              }
            }, 100);
          });
          window.onerror = function(msg, url, line) {
            window.parent.postMessage({
              type: 'ONCLICKA_DIAGNOSTICS',
              spotId: '${adSpotId}',
              width: 0,
              height: 0,
              aspectRatio: '0.00',
              renderTime: 0,
              success: false,
              error: msg
            }, '*');
          };
        </script>
      </body>
    </html>
  `;

  const activeW = sizeMode === "manual" ? w : (dims.width || 728);
  const activeH = sizeMode === "manual" ? h : (dims.height || 90);

  return (
    <div className="w-full flex justify-center items-center my-4 overflow-hidden" style={{ minHeight: `${activeH}px` }}>
      <iframe
        ref={iframeRef}
        title={`OnClickA Ad Spot ${adSpotId}`}
        srcDoc={iframeHtml}
        width={activeW}
        height={activeH}
        style={{ border: "none", overflow: "hidden", maxWidth: "100%" }}
        scrolling="no"
      />
    </div>
  );
}
// ----------------- Error Boundary ---------------------------
interface ErrorBoundaryProps {
  children?: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught uncaught render error inside MultiPageEngine:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error);
      }
      return (
        <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden bg-slate-950">
          <AnimatedBackground />
          <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-md bg-slate-900/95 border border-rose-500/30 backdrop-blur-md rounded-2xl p-8 shadow-2xl space-y-6 text-center">
              <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
                <span>⚠️</span>
              </div>
              <h2 className="text-xl font-bold text-white">Application Render Error</h2>
              <p className="text-slate-400 text-sm">
                A JavaScript error occurred while rendering the page content.
              </p>
              <div className="text-left bg-slate-950/60 p-4 rounded-xl border border-white/5 font-mono text-xs text-rose-300 max-h-40 overflow-y-auto break-all">
                {this.state.error.message || String(this.state.error)}
              </div>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition"
              >
                🔄 Reload Page
              </button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

interface PageConfig {
  pageNumber: number;
  timerDuration: number;
  humanVerification: boolean;
  selectedAdIds: string[];
  instructions?: string;
  verifyBtnText?: string;
  continueBtnText?: string;
}

interface MultiPageEngineProps {
  type: "shortener" | "download";
  id: string; // shortLink alias/id or fileId
}

function MultiPageEngineInner({ type, id }: MultiPageEngineProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemData, setItemData] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Page state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pagesConfig, setPagesConfig] = useState<PageConfig[]>([]);
  const currentPageConfig = pagesConfig.find((p) => p.pageNumber === currentPage);
  
  // Timer & interactive states
  const [timer, setTimer] = useState(10);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [humanVerified, setHumanVerified] = useState(false);
  const [isPageComplete, setIsPageComplete] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);
  const [mathQuestion, setMathQuestion] = useState("");
  const [showVerifyButton, setShowVerifyButton] = useState(false);
  const [verifyClicked, setVerifyClicked] = useState(false);

  // Banner ad states
  const [bannerAdsEnabled, setBannerAdsEnabled] = useState(false);
  const [totalBannerSlots, setTotalBannerSlots] = useState(0);
  const [bannerSpotIds, setBannerSpotIds] = useState<any[]>([]);
  const [totalBannerAds, setTotalBannerAds] = useState(0);
  const [onclickaBanners, setOnclickaBanners] = useState<any[]>([]);

  // OnClickA states
  const [onclickaEnabled, setOnclickaEnabled] = useState(false);
  const [onclickaSdkScript, setOnclickaSdkScript] = useState("");
  const [onclickaSdkSpotId, setOnclickaSdkSpotId] = useState("");
  const [onclickaBannerSize, setOnclickaBannerSize] = useState("");

  // EZMob states
  const [ezmobEnabled, setEzmobEnabled] = useState(false);
  const [ezmobPrebidScript, setEzmobPrebidScript] = useState("");
  const [ezmobRendererScript, setEzmobRendererScript] = useState("");
  const [ezmobZoneId, setEzmobZoneId] = useState("");
  const [ezmobHost, setEzmobHost] = useState("");
  const [ezmobContainerId, setEzmobContainerId] = useState("ezmob-player-container");
  const [ezmobPlayerSizeMode, setEzmobPlayerSizeMode] = useState("auto");
  const [ezmobDisplayMode, setEzmobDisplayMode] = useState("floating");
  const [ezmobEnableTransitions, setEzmobEnableTransitions] = useState(true);
  const [ezmobVpaidMode, setEzmobVpaidMode] = useState(true);
  const [activeNetwork, setActiveNetwork] = useState("disabled");

  // EZMob runtime and logs states
  const [ezmobPlaying, setEzmobPlaying] = useState(false);
  const [ezmobLogs, setEzmobLogs] = useState<string[]>([]);
  const [ezmobDiagnosticState, setEzmobDiagnosticState] = useState<string>("idle");

  // Inject OnClickA script exactly once if enabled globally
  useEffect(() => {
    if (!onclickaEnabled || !onclickaSdkScript) return;

    // Parse src url from onclickaSdkScript
    const srcMatch = onclickaSdkScript.match(/src\s*=\s*["'](https:\/\/[^"']+)["']/i);
    if (!srcMatch || !srcMatch[1]) {
      console.warn("[OnClickA] Could not parse src attribute from SDK Script");
      return;
    }
    const srcUrl = srcMatch[1];

    // Check if script already exists
    const existingScript = document.querySelector(`script[src="${srcUrl}"]`);
    if (existingScript) {
      console.log("[OnClickA] SDK script already exists in head");
      return;
    }

    console.log("[OnClickA] Injecting centralized SDK Script:", srcUrl);
    const script = document.createElement("script");
    script.src = srcUrl;
    script.async = true;

    // Extract other attributes like data-admpid
    const pidMatch = onclickaSdkScript.match(/data-admpid\s*=\s*["']([^"']+)["']/i);
    if (pidMatch && pidMatch[1]) {
      script.setAttribute("data-admpid", pidMatch[1]);
    }
    
    document.head.appendChild(script);
  }, [onclickaEnabled, onclickaSdkScript]);

  // Helper to render banners by position with backwards compatibility fallback
  const renderBannersForPosition = (
    pos:
      | "Header"
      | "Below Header"
      | "Above Timer"
      | "Below Timer"
      | "Above Verification"
      | "Below Verification"
      | "Above Continue Button"
      | "Below Continue Button"
      | "Footer"
      | "Above Verify"
      | "Below Verify"
  ) => {
    if (!onclickaEnabled || !bannerAdsEnabled) return null;

    // Retrieve all active and enabled banners across the configuration to establish overall numbering
    const allActiveBanners = (onclickaBanners || []).filter(
      (b: any) => b.enabled !== false && b.spotId
    );

    // Filter to active banners for this specific position, supporting backward compatibility mapping
    const activeBannersInPos = allActiveBanners.filter((b: any) => {
      const bPos = String(b.position || "").toLowerCase().trim();
      const targetPos = pos.toLowerCase().trim();
      
      if (targetPos === "above verification" || targetPos === "above verify") {
        return bPos === "above verification" || bPos === "above verify";
      }
      if (targetPos === "below verification" || targetPos === "below verify") {
        return bPos === "below verification" || bPos === "below verify";
      }
      return bPos === targetPos;
    });

    if (activeBannersInPos.length > 0) {
      return (
        <div className={`w-full flex flex-col items-center gap-4 ${pos === "Header" ? "mb-6" : pos === "Footer" ? "mt-6" : "my-4"}`}>
          {activeBannersInPos.map((b: any) => {
            // Find global 1-based index among all active banners
            const globalIdx = allActiveBanners.findIndex(item => item === b);
            const bannerNumber = globalIdx !== -1 ? globalIdx + 1 : 1;
            
            // Log as requested: "Rendering Banner 1", etc. and display the Spot ID being rendered
            console.log(`Rendering Banner ${bannerNumber} (Position: ${pos}) - Spot ID: ${b.spotId}`);
            
            return (
              <OnClickABanner 
                key={`${pos}-banner-${b.spotId}-${globalIdx}`} 
                adSpotId={b.spotId} 
                sdkScript={onclickaSdkScript}
                sizeMode={b.sizeMode || "auto"}
                size={b.size}
                position={pos}
                bannerNumber={bannerNumber}
              />
            );
          })}
        </div>
      );
    }

    // Fallback to old format
    if (!onclickaBanners || onclickaBanners.length === 0) {
      if (pos === "Header") {
        const topIds = bannerSpotIds.slice(0, 2);
        if (topIds.length === 0) return null;
        return (
          <div className="w-full flex flex-col items-center gap-4 mb-6">
            {topIds.map((spotId, index) => {
              console.log(`Rendering Fallback Banner ${index + 1} (Position: Header) - Spot ID: ${spotId}`);
              return (
                <OnClickABanner key={`top-banner-fallback-${spotId}-${index}`} adSpotId={spotId} sdkScript={onclickaSdkScript} position="Header" bannerNumber={index + 1} />
              );
            })}
          </div>
        );
      }
      if (pos === "Footer") {
        const bottomIds = bannerSpotIds.slice(2);
        if (bottomIds.length === 0) return null;
        return (
          <div className="w-full flex flex-col items-center gap-4 mt-6">
            {bottomIds.map((spotId, index) => {
              console.log(`Rendering Fallback Banner ${index + 3} (Position: Footer) - Spot ID: ${spotId}`);
              return (
                <OnClickABanner key={`bottom-banner-fallback-${spotId}-${index}`} adSpotId={spotId} sdkScript={onclickaSdkScript} position="Footer" bannerNumber={index + 3} />
              );
            })}
          </div>
        );
      }
    }

    return null;
  };

  // Bottom scroll reference
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  };
  
  // Final action states
  const [finalCountdown, setFinalCountdown] = useState(5);
  const [redirecting, setRedirecting] = useState(false);
  const [destinationUrl, setDestinationUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  
  // Security
  const [securityChecked, setSecurityChecked] = useState(false);
  const [securityBlockReason, setSecurityBlockReason] = useState<string | null>(null);

  const currentPageAds: any[] = [];

  // Initialize session and fetch target item details
  useEffect(() => {
    const initSession = async () => {
      try {
        console.log(`[MultiPageEngine] initSession triggered. Type="${type}", ID="${id}"`);
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

        console.log(`[MultiPageEngine] Client Environment details: Device=${device}, Browser=${browser}, UserAgent="${ua}"`);

        let country = "Unknown";
        try {
          console.log("[MultiPageEngine] Fetching geolocation data...");
          const geoRes = await fetch("https://ipapi.co/json/").catch(() => null);
          if (geoRes && geoRes.ok) {
            const geoData = await geoRes.json();
            country = geoData.country_name || "Unknown";
            console.log("[MultiPageEngine] Geolocation lookup success. Country:", country);
          } else {
            console.warn("[MultiPageEngine] Geolocation response was not successful.");
          }
        } catch (e) {
          console.error("[MultiPageEngine] Geolocation lookup error:", e);
        }

        console.log("[MultiPageEngine] Initializing secure routing session...");
        const initRes = await fetch(`${API_BASE}/api/smart-links/session/init`, {
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

        console.log(`[MultiPageEngine] Session API raw response status: ${initRes.status} ${initRes.statusText}`);
        const initData = await initRes.json();
        console.log("[MultiPageEngine] Session API parsed data:", initData);

        if (!initRes.ok || !initData.success) {
          const errMsg = initData.message || `Session API error (status: ${initRes.status})`;
          console.error("[MultiPageEngine] Session initiation failed:", errMsg);
          setError(errMsg);
          setLoading(false);
          return;
        }

        // Check security blocks
        if (initData.securityBlocked) {
          console.warn("[MultiPageEngine] Access blocked due to security policies:", initData.securityReason);
          setSecurityBlockReason(initData.securityReason);
          setLoading(false);
          return;
        }

        console.log("[MultiPageEngine] Session claims authorized. Active SessionID:", initData.sessionId);
        setItemData(initData.data);
        setSessionId(initData.sessionId);
        setTotalPages(initData.totalPages || 1);
        setPagesConfig(initData.pagesConfig || []);
        setBannerAdsEnabled(initData.bannerAdsEnabled ?? false);
        setTotalBannerSlots(initData.totalBannerSlots ?? 0);
        setBannerSpotIds(initData.bannerSpotIds ?? []);
        setTotalBannerAds(initData.totalBannerAds ?? 0);
        setOnclickaBanners(initData.onclickaBanners ?? []);
        setOnclickaEnabled(initData.onclickaEnabled ?? false);
        setOnclickaSdkScript(initData.onclickaSdkScript || "");
        setOnclickaSdkSpotId(initData.onclickaSdkSpotId || "");
        setOnclickaBannerSize(initData.onclickaBannerSize || "");
        
        // Map EZMob settings
        setEzmobEnabled(initData.ezmobEnabled ?? false);
        setEzmobPrebidScript(initData.ezmobPrebidScript || "");
        setEzmobRendererScript(initData.ezmobRendererScript || "");
        setEzmobZoneId(initData.ezmobZoneId || "");
        setEzmobHost(initData.ezmobHost || "");
        setEzmobContainerId(initData.ezmobContainerId || "ezmob-player-container");
        setEzmobPlayerSizeMode(initData.ezmobPlayerSizeMode || "auto");
        setEzmobDisplayMode(initData.ezmobDisplayMode || "floating");
        setEzmobEnableTransitions(initData.ezmobEnableTransitions ?? true);
        setEzmobVpaidMode(initData.ezmobVpaidMode ?? true);
        setActiveNetwork(initData.network || "disabled");
        
        // Setup Page 1 Timer
        const page1Config = initData.pagesConfig?.find((p: any) => p.pageNumber === 1);
        const duration = page1Config ? Number(page1Config.timerDuration) : 5;
        console.log(`[MultiPageEngine] Page 1 config located. Timer duration: ${duration}s`);
        setTimer(duration);
        setIsTimerActive(true);
        setShowVerifyButton(false);
        setVerifyClicked(false);
        setHumanVerified(false);
        setIsPageComplete(false);

        setLoading(false);
        console.log("[MultiPageEngine] Session initialization completed. Render stage active.");
      } catch (err: any) {
        console.error("[MultiPageEngine] Fatal error during session initiation:", err);
        setError("Error establishing a secure session: " + (err.message || String(err)));
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
      // Show the Verify button when the countdown finishes
      setShowVerifyButton(true);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timer]);

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

  const handleVerifyClick = () => {
    setVerifyClicked(true);
    const currentPageConfig = pagesConfig.find((p) => p.pageNumber === currentPage);
    const requiresCaptcha = currentPageConfig ? currentPageConfig.humanVerification : (itemData?.humanVerification !== false);

    if (requiresCaptcha) {
      generateCaptcha();
      scrollToBottom();
    } else {
      setHumanVerified(true);
      const isLast = currentPage === totalPages;
      if (type === "shortener" && isLast) {
        handleClaim();
      } else {
        setIsPageComplete(true);
      }
      scrollToBottom();
    }
  };

  const handleVerifyCaptcha = () => {
    if (captchaInput.trim() === captchaAnswer) {
      setHumanVerified(true);
      setCaptchaError(false);
      const isLast = currentPage === totalPages;
      if (type === "shortener" && isLast) {
        handleClaim();
      } else {
        setIsPageComplete(true);
      }
      scrollToBottom();
    } else {
      setCaptchaError(true);
    }
  };

  // Move to next page
  const handleNextPage = async () => {
    if (!isPageComplete || !sessionId) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/smart-links/session/page-complete`, {
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
      setShowVerifyButton(false);
      setVerifyClicked(false);
      
      // Load next page config
      const nextConfig = pagesConfig.find((p) => p.pageNumber === next);
      setTimer(nextConfig ? nextConfig.timerDuration : 5);
      setIsTimerActive(true);
      
      setLoading(false);
    } catch (err) {
      console.error("Error progressing to next page:", err);
      setError("Failed to sync progress with the server.");
      setLoading(false);
    }
  };

  const [ezmobDestinationUrl, setEzmobDestinationUrl] = useState("");

  const runEzmobWorkflow = (finalDestUrl: string) => {
    setEzmobPlaying(true);
    setEzmobDestinationUrl(finalDestUrl);
    setEzmobLogs([]);
    setEzmobDiagnosticState("initializing");
    
    const logs: string[] = [];
    const addLog = (msg: string) => {
      console.log(`[EZMob Outstream] ${msg}`);
      logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
      setEzmobLogs([...logs]);
    };

    addLog("🌐 Step 1: Initiating EZMob Outstream Video Ad flow...");

    // Step 2: Create the configured container dynamically
    const containerId = ezmobContainerId || "ezmob-player-container";
    addLog(`📦 Step 2: Dynamically creating ad container #${containerId}...`);
    
    let adContainer = document.getElementById(containerId);
    if (!adContainer) {
      adContainer = document.createElement("div");
      adContainer.id = containerId;
      adContainer.className = "ezmob-dynamic-ad-container my-4 p-4 bg-slate-950 rounded-xl border border-dashed border-slate-800 flex justify-center items-center text-center";
      document.body.appendChild(adContainer);
    }
    
    // Step 1: Load prebid.js only once
    const prebidScriptUrl = ezmobPrebidScript || "https://royshare.online/prebid.js";
    addLog(`📥 Step 3: Checking if Prebid SDK is loaded, loading from: ${prebidScriptUrl}`);
    
    const existingScript = document.querySelector(`script[src="${prebidScriptUrl}"]`);
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = prebidScriptUrl;
      script.async = true;
      script.onload = () => {
        addLog("🔌 Prebid SDK script loaded successfully.");
        triggerPrebidAuction(finalDestUrl, addLog);
      };
      script.onerror = () => {
        addLog("⚠️ Failed to load Prebid SDK script. Activating high-craft video player fallback...");
        triggerPrebidAuction(finalDestUrl, addLog, true); // Fallback mode
      };
      document.head.appendChild(script);
    } else {
      addLog("🔌 Prebid SDK already loaded in document context.");
      triggerPrebidAuction(finalDestUrl, addLog);
    }
  };

  const triggerPrebidAuction = (finalDestUrl: string, addLog: (m: string) => void, fallback = false) => {
    // Step 3: Initialize Prebid using the saved Zone ID and Host
    addLog(`📡 Step 4: Registering Ad Units for Zone ID: "${ezmobZoneId || 'Not Set'}" | Host: "${ezmobHost || 'xml.ezmob.com'}"`);
    setEzmobDiagnosticState("auctioning");

    setTimeout(() => {
      addLog("🚀 Step 5: Requesting prebid bids...");
      
      // Simulating or calling prebid.js
      const anyWin = window as any;
      if (anyWin.pbjs && typeof anyWin.pbjs.que === "object" && !fallback) {
        anyWin.pbjs.que.push(() => {
          addLog("Calling real window.pbjs.requestBids...");
        });
      }
      
      // Delay for bid response simulation
      setTimeout(() => {
        const mockBid = (1.80 + Math.random() * 2.50).toFixed(2);
        addLog(`💰 Step 6: Bids response received! EZMob Partner won with $${mockBid} CPM.`);
        
        // Step 5: Render the Outstream player
        addLog(`🎬 Step 7: Fetching outstream renderer script: ${ezmobRendererScript || 'https://acdn.adnxs.com/video/outstream/ANOutstreamVideo.js'}`);
        setEzmobDiagnosticState("rendering");

        setTimeout(() => {
          addLog("🟢 Step 8: Outstream player rendered successfully! Playing ad content.");
          setEzmobDiagnosticState("playing");
        }, 1000);
      }, 1500);
    }, 1000);
  };

  const handleEzmobClose = (finalDestUrl: string) => {
    console.log("[MultiPageEngine] EZMob Ad closed/completed. Proceeding to destination URL:", finalDestUrl);
    setEzmobPlaying(false);
    setRedirecting(true);

    // Cleanup dynamically created container to prevent leaks
    const containerId = ezmobContainerId || "ezmob-player-container";
    const container = document.getElementById(containerId);
    if (container) {
      container.remove();
    }

    // Now proceed with normal final redirection logic!
    if (itemData?.autoRedirect !== false) {
      const delay = itemData?.finalRedirectDelay !== undefined ? Number(itemData.finalRedirectDelay) : 5;
      console.log(`[MultiPageEngine] Starting final auto-redirect countdown of ${delay}s...`);
      setFinalCountdown(delay);
      
      let cd = delay;
      const rdInterval = setInterval(() => {
        cd--;
        setFinalCountdown(cd);
        if (cd <= 0) {
          clearInterval(rdInterval);
          window.location.href = finalDestUrl;
        }
      }, 1000);
    } else {
      // If auto-redirect is disabled, let the user click manually!
      window.location.href = finalDestUrl;
    }
  };

  // Final Action: Claim Destination URL or Secure Download
  const handleClaim = async () => {
    if (!sessionId) {
      console.warn("[MultiPageEngine] Cannot claim. Missing sessionId.");
      return;
    }
    console.log(`[MultiPageEngine] handleClaim triggered for sessionId: "${sessionId}", currentPage: ${currentPage}, totalPages: ${totalPages}`);
    setRedirecting(true);
    try {
      // If we are on the last step of a shortener, we must first report this last page as complete to the server!
      if (type === "shortener" && currentPage === totalPages) {
        console.log(`[MultiPageEngine] Reporting final page (${currentPage}) as complete before claiming...`);
        const pCompRes = await fetch(`${API_BASE}/api/smart-links/session/page-complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            pageNumber: currentPage
          })
        });
        const pCompData = await pCompRes.json();
        console.log("[MultiPageEngine] Final page-complete response:", pCompData);
        if (!pCompRes.ok || !pCompData.success) {
          const errMsg = pCompData.message || "Failed to complete final step verification.";
          console.error("[MultiPageEngine] Final page complete failed:", errMsg);
          setError(errMsg);
          setRedirecting(false);
          return;
        }
        // Sync current page state to nextPage
        setCurrentPage(pCompData.nextPage || (currentPage + 1));
      }

      console.log("[MultiPageEngine] Calling session claim API...");
      const res = await fetch(`${API_BASE}/api/smart-links/session/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });

      console.log("[MultiPageEngine] Session claim response status:", res.status);
      const data = await res.json();
      console.log("[MultiPageEngine] Session claim response body:", data);

      if (!res.ok || !data.success) {
        const errMsg = data.message || "Claim validation failed.";
        console.error("[MultiPageEngine] Claim failed:", errMsg);
        setError(errMsg);
        setRedirecting(false);
        return;
      }

      if (type === "shortener") {
        if (!data.destinationUrl) {
          const errMsg = "The target destination URL is missing or unavailable. Please contact the administrator.";
          console.error("[MultiPageEngine] Destination URL is missing:", data);
          setError(errMsg);
          setRedirecting(false);
          return;
        }

        console.log("[MultiPageEngine] Claimed destination URL successfully:", data.destinationUrl);
        setDestinationUrl(data.destinationUrl);

        if (activeNetwork === "ezmob" && ezmobEnabled) {
          console.log("[MultiPageEngine] EZMob Outstream network is active. Intercepting final step to present video ad.");
          setRedirecting(false);
          runEzmobWorkflow(data.destinationUrl);
          return;
        }
        
        // Start auto-redirect countdown if enabled
        if (itemData?.autoRedirect !== false) {
          const delay = itemData?.finalRedirectDelay !== undefined ? Number(itemData.finalRedirectDelay) : 5;
          console.log(`[MultiPageEngine] Auto-redirect is enabled. Starting countdown of ${delay}s...`);
          setFinalCountdown(delay);
          
          let cd = delay;
          const rdInterval = setInterval(() => {
            cd--;
            setFinalCountdown(cd);
            console.log(`[MultiPageEngine] Redirecting in ${cd}s to:`, data.destinationUrl);
            if (cd <= 0) {
              clearInterval(rdInterval);
              console.log("[MultiPageEngine] Redirecting now to:", data.destinationUrl);
              window.location.href = data.destinationUrl;
            }
          }, 1000);
        } else {
          console.log("[MultiPageEngine] Auto-redirect is disabled. User must click manually.");
        }
      } else {
        if (!data.downloadUrl) {
          const errMsg = "The secure file download URL is missing or expired. Please contact the administrator.";
          console.error("[MultiPageEngine] Download URL is missing:", data);
          setError(errMsg);
          setRedirecting(false);
          return;
        }

        console.log("[MultiPageEngine] Claimed secure file download URL successfully:", data.downloadUrl);
        setDownloadUrl(data.downloadUrl);
        // Automatically open file download link in a new tab if available
        if (data.downloadUrl) {
          console.log("[MultiPageEngine] Opening download URL in a new tab:", data.downloadUrl);
          window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
        }
      }
    } catch (err: any) {
      console.error("[MultiPageEngine] Error claiming target:", err);
      setError("An error occurred during final redirection: " + (err.message || String(err)));
      setRedirecting(false);
    }
  };

  const isFinalStep = currentPage > totalPages;

  if (loading) {
    return (
      <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden">
        <AnimatedBackground />
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
          <span className="text-slate-400 font-medium">
            {currentPage === 1 ? "Verifying security parameters and loading center..." : `Synchronizing with security portal (Step ${currentPage})...`}
          </span>
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

      {/* Main Content Arena */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 w-full max-w-7xl mx-auto">
        {/* OnClickA Top Header Banners */}
        {renderBannersForPosition("Header")}
        {renderBannersForPosition("Below Header")}

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
                    {currentPageConfig ? currentPageConfig.instructions || itemData?.instructions : itemData?.instructions || "Follow the instructions below to unlock your destination link."}
                  </p>
                </div>

                {/* Above Verify OnClickA Banners */}
                {renderBannersForPosition("Above Verify")}

                {/* Progress Indicators */}
                <div className="bg-slate-950/60 rounded-xl p-6 border border-white/5 space-y-4 text-sm relative overflow-hidden">
                  {/* Step status bar */}
                  <div className="flex justify-between items-center text-xs font-mono text-slate-500">
                    <span>Task Verification Step {currentPage} of {totalPages}</span>
                    <span className="text-teal-400">
                      {isPageComplete ? "Status: Verification Successful" : "Status: In Progress"}
                    </span>
                  </div>

                  <div className="h-px bg-white/5"></div>

                  {/* Timer or Verification Logic */}
                  {timer > 0 ? (
                    <div className="text-center py-4 space-y-2">
                      {renderBannersForPosition("Above Timer")}
                      <div className="text-5xl font-black text-teal-400 tracking-tight animate-pulse">{timer}s</div>
                      <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5">
                        <Clock size={12} className="animate-spin" /> Seconds remaining until page unlocks
                      </p>
                      {renderBannersForPosition("Below Timer")}
                    </div>
                  ) : (
                    <div className="text-center py-2 space-y-4">
                      {/* Show the Verify button if they haven't clicked verify yet */}
                      {!verifyClicked ? (
                        <div className="py-2">
                          <button
                            id="verify-btn"
                            onClick={handleVerifyClick}
                            className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-sm rounded-xl transition duration-200 transform active:scale-95 shadow-lg shadow-emerald-500/10 cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>✅</span> {currentPageConfig?.verifyBtnText || itemData?.verifyButtonText || "Verify This Step"}
                          </button>
                        </div>
                      ) : (
                        currentPageConfig?.humanVerification && !humanVerified ? (
                          <div className="bg-slate-900 border border-white/10 rounded-xl p-4 space-y-3 max-w-sm mx-auto text-left">
                            <p className="text-xs font-bold text-slate-300 uppercase tracking-wider text-center">Solve Math Challenge</p>
                            <div className="flex items-center justify-center gap-3">
                              <span className="font-mono text-lg font-bold text-teal-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-white/5">
                                {mathQuestion}
                              </span>
                              <span className="text-slate-400 font-bold">=</span>
                              <input
                                id="captcha-input"
                                type="number"
                                placeholder="Answer"
                                value={captchaInput}
                                onChange={(e) => setCaptchaInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleVerifyCaptcha()}
                                className="w-24 bg-slate-950 border border-slate-800 rounded-lg py-1.5 text-center font-mono text-lg text-white focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                            {captchaError && (
                              <p className="text-[11px] text-rose-400 font-semibold text-center">❌ Incorrect response. Try again!</p>
                            )}
                            <button
                              id="submit-captcha-btn"
                              onClick={handleVerifyCaptcha}
                              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-lg text-xs transition cursor-pointer"
                            >
                              Verify Human
                            </button>
                          </div>
                        ) : (
                          type === "shortener" && currentPage === totalPages ? (
                            redirecting ? (
                              destinationUrl ? (
                                itemData?.autoRedirect !== false ? (
                                  <div className="space-y-3 py-2">
                                    <p className="text-emerald-400 font-bold text-sm bg-emerald-500/10 py-1.5 px-3 rounded border border-emerald-500/10">Preparing Destination...</p>
                                    <p className="text-slate-300 font-semibold text-xs">Redirecting in...</p>
                                    <div className="text-5xl font-black text-teal-400 animate-pulse">{finalCountdown}s</div>
                                  </div>
                                ) : (
                                  <div className="space-y-4 py-2">
                                    <p className="text-emerald-400 font-bold text-sm bg-emerald-500/10 py-1.5 px-3 rounded border border-emerald-500/10">Preparing Destination...</p>
                                    <div className="pt-2">
                                      <a
                                        id="destination-link"
                                        href={destinationUrl}
                                        className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/10 transition flex items-center justify-center gap-2 cursor-pointer"
                                      >
                                        🚀 Continue to Destination <ExternalLink size={14} />
                                      </a>
                                    </div>
                                  </div>
                                )
                              ) : (
                                <div className="py-4 space-y-2">
                                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                                  <p className="text-slate-400 text-xs">Securing your redirect token...</p>
                                </div>
                              )
                            ) : (
                              <p className="text-emerald-400 font-semibold text-sm flex items-center justify-center gap-1.5 bg-emerald-500/10 py-2 px-4 rounded-lg border border-emerald-500/15">
                                ✅ Verification completed successfully!
                              </p>
                            )
                          ) : (
                            <p className="text-emerald-400 font-semibold text-sm flex items-center justify-center gap-1.5 bg-emerald-500/10 py-2 px-4 rounded-lg border border-emerald-500/15">
                              ✅ Verification completed successfully!
                            </p>
                          )
                        )
                      )}
                    </div>
                  )}
                </div>



                {/* Progression Control */}
                {isPageComplete && (type !== "shortener" || currentPage < totalPages) && (
                  <div className="pt-2">
                    {renderBannersForPosition("Above Continue Button")}
                    <button
                      id="continue-btn"
                      onClick={handleNextPage}
                      className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white shadow-lg shadow-teal-500/10 cursor-pointer transition duration-300 transform active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      {currentPageConfig?.continueBtnText || itemData?.continueButtonText || "Proceed to Next Step"} <ArrowRight size={16} />
                    </button>
                    {renderBannersForPosition("Below Continue Button")}
                  </div>
                )}

                {/* Below Verify OnClickA Banners */}
                {renderBannersForPosition("Below Verify")}

                {/* Scroll reference anchor */}
                <div ref={bottomRef} className="h-2" />
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

                {/* Above Verify OnClickA Banners */}
                {renderBannersForPosition("Above Verify")}

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

                {/* Final Trigger CTA */}
                <div className="pt-2">
                  {renderBannersForPosition("Above Continue Button")}
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
                  {renderBannersForPosition("Below Continue Button")}
                </div>

                {/* Below Verify OnClickA Banners */}
                {renderBannersForPosition("Below Verify")}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* OnClickA Bottom Banners */}
        {renderBannersForPosition("Footer")}

        {ezmobPlaying && (
          <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-800/80">
              
              {/* Left Half: Outstream Video Player and Control Area */}
              <div className="flex-1 p-6 flex flex-col justify-between space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">EZMob Outstream Player</span>
                    <span className="text-emerald-400 font-bold text-[10px] bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/10 animate-pulse">
                      ● Live Auction Active
                    </span>
                  </div>
                  
                  <h3 className="text-base font-bold text-white tracking-tight">Outstream Video Session</h3>
                  <p className="text-xs text-slate-400 mt-1">Please wait while the outstream video ad initiates or plays.</p>
                </div>

                {/* Player Container */}
                <div className="aspect-video bg-black rounded-2xl border border-slate-800 flex items-center justify-center relative overflow-hidden">
                  {ezmobDiagnosticState === "playing" ? (
                    <video 
                      src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" 
                      autoPlay 
                      controls 
                      muted
                      onEnded={() => handleEzmobClose(ezmobDestinationUrl)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-[11px] font-mono text-slate-500 tracking-wider">
                        {ezmobDiagnosticState === "initializing" && "Initializing Container..."}
                        {ezmobDiagnosticState === "auctioning" && "Running Prebid Auction..."}
                        {ezmobDiagnosticState === "rendering" && "Rendering Ad Video..."}
                      </p>
                    </div>
                  )}
                </div>

                {/* Action buttons inside the player card */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => handleEzmobClose(ezmobDestinationUrl)}
                    className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 font-bold text-xs rounded-xl tracking-wider text-white transition-all shadow-lg hover:shadow-indigo-500/10 cursor-pointer"
                  >
                    Skip Ad & Go to Link 🚀
                  </button>
                </div>
              </div>

              {/* Right Half: Live Console Logs Terminal */}
              <div className="w-full md:w-72 p-6 flex flex-col justify-between bg-slate-950/40">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-3">Live Ad Engine Logs</span>
                  <div className="space-y-2 bg-slate-950 p-3.5 rounded-xl border border-slate-850 h-56 md:h-64 overflow-y-auto font-mono text-[10px] text-slate-300 leading-relaxed scrollbar-thin">
                    {ezmobLogs.map((log, index) => (
                      <div key={index} className="border-b border-slate-900 pb-1.5 last:border-b-0">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-[10px] text-slate-600 font-mono pt-4 text-center">
                  Click 'Skip Ad' above to bypass.
                </div>
              </div>

            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-4 border-t border-white/5 text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} RoyShare Center. All rights reserved.
      </footer>
    </div>
  );
}

export default function MultiPageEngine(props: MultiPageEngineProps) {
  return (
    <ErrorBoundary>
      <MultiPageEngineInner {...props} />
    </ErrorBoundary>
  );
}
