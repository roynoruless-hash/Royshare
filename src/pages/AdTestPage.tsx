import { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Activity, 
  Terminal, 
  Settings, 
  AlertTriangle, 
  Globe, 
  RefreshCw 
} from "lucide-react";

interface DebugLog {
  scriptLoaded: "PASS" | "FAIL" | "PENDING";
  sdkInitialized: "PASS" | "FAIL" | "PENDING";
  requestSent: "PASS" | "FAIL" | "PENDING";
  httpStatus: string;
  response: string;
  adRendered: "PASS" | "FAIL" | "PENDING";
  sdkError: string;
}

export default function AdTestPage() {
  const [adConfig, setAdConfig] = useState<{
    enabled: boolean;
    verified: boolean;
    script: string;
    network: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [debugLog, setDebugLog] = useState<DebugLog>({
    scriptLoaded: "PENDING",
    sdkInitialized: "PENDING",
    requestSent: "PENDING",
    httpStatus: "N/A",
    response: "Awaiting initialization...",
    adRendered: "PENDING",
    sdkError: "None detected"
  });

  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const isMounted = useRef(true);

  // Helper to log console messages
  const addLog = (msg: string) => {
    setConsoleLogs(prev => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 49)
    ]);
  };

  const updateDebug = (key: keyof DebugLog, value: any) => {
    setDebugLog(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const fetchConfigAndInject = async () => {
    setLoading(true);
    setError(null);
    setConsoleLogs([]);
    setDebugLog({
      scriptLoaded: "PENDING",
      sdkInitialized: "PENDING",
      requestSent: "PENDING",
      httpStatus: "N/A",
      response: "Awaiting initialization...",
      adRendered: "PENDING",
      sdkError: "None detected"
    });

    addLog("Fetching advertisement configuration from Firestore settings/advertisement...");
    
    try {
      const docRef = doc(db, "settings", "advertisement");
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        throw new Error("Document 'settings/advertisement' does not exist in Firestore.");
      }

      const data = docSnap.data();
      addLog(`Config fetched successfully: enabled=${data.enabled}, verified=${data.verified}, network=${data.network}`);
      
      setAdConfig({
        enabled: data.enabled ?? false,
        verified: data.verified ?? false,
        script: data.script || "",
        network: data.network || "onclicka"
      });

      if (!data.enabled || !data.verified) {
        updateDebug("scriptLoaded", "FAIL");
        addLog("OnClickA is disabled or not verified in Firestore configuration.");
        setLoading(false);
        return;
      }

      const scriptCode = data.script || "";
      if (!scriptCode) {
        throw new Error("No script code found in advertisement settings.");
      }

      // Parse the script to extract src and attributes
      let src = "https://js.onclckmn.com/static/onclicka.js";
      const attributes: { [key: string]: string } = {};

      try {
        const parser = new DOMParser();
        const docObj = parser.parseFromString(scriptCode, "text/html");
        const parsedScript = docObj.querySelector("script");
        if (parsedScript) {
          src = parsedScript.getAttribute("src") || src;
          for (let i = 0; i < parsedScript.attributes.length; i++) {
            const attr = parsedScript.attributes[i];
            if (attr.name !== "src") {
              attributes[attr.name] = attr.value;
            }
          }
          addLog(`Parsed loader script URL: ${src}`);
          addLog(`Parsed loader attributes: ${JSON.stringify(attributes)}`);
        } else {
          addLog("DOMParser could not find script tag, using default URL and fallback attribute parsing.");
        }
      } catch (e: any) {
        addLog(`Warning parsing script with DOMParser: ${e.message}`);
      }

      // Check if loader script is already loaded
      const existingScript = document.querySelector(`script[src="${src}"]`);
      if (existingScript) {
        addLog("Existing OnClickA script tag found. Removing to trigger fresh instrumentation load.");
        existingScript.remove();
      }

      addLog("Injecting new OnClickA script tag to head...");
      const scriptEl = document.createElement("script");
      scriptEl.src = src;
      Object.keys(attributes).forEach((key) => {
        scriptEl.setAttribute(key, attributes[key]);
      });
      scriptEl.setAttribute("data-cfasync", "false");
      scriptEl.async = true;

      scriptEl.onload = () => {
        if (!isMounted.current) return;
        addLog("OnClickA script loaded successfully (onload triggered).");
        updateDebug("scriptLoaded", "PASS");
        (window as any).__onclickaScriptLoaded = true;
      };

      scriptEl.onerror = () => {
        if (!isMounted.current) return;
        addLog("OnClickA script failed to load (onerror triggered). Possible AdBlock/CSP interference.");
        updateDebug("scriptLoaded", "FAIL");
        (window as any).__onclickaScriptLoaded = false;
      };

      document.head.appendChild(scriptEl);
      setLoading(false);

    } catch (err: any) {
      addLog(`Error during ad initialization: ${err.message}`);
      setError(err.message || "Unknown error");
      updateDebug("scriptLoaded", "FAIL");
      setLoading(false);
    }
  };

  useEffect(() => {
    isMounted.current = true;

    // --- Monkeypatching Fetch & XHR to track ad network communication ---
    const nativeFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      const isAdReq = url.includes("onclicka") || url.includes("onclckmn") || url.includes("clickadu") || url.includes("groleeguls") || url.includes("wa-");
      
      if (isAdReq) {
        addLog(`[FETCH INITIATED] Outgoing request detected to: ${url}`);
        updateDebug('requestSent', 'PASS');
      }

      try {
        const response = await nativeFetch.apply(this, args);
        if (isAdReq) {
          addLog(`[FETCH RESPONSE] Status: ${response.status} ${response.statusText} for URL: ${url}`);
          updateDebug('httpStatus', `${response.status} ${response.statusText}`);
          try {
            const clone = response.clone();
            const text = await clone.text();
            const truncatedText = text.length > 300 ? text.slice(0, 300) + "..." : text;
            updateDebug('response', truncatedText || "Empty Response");
            addLog(`[FETCH BODY PREVIEW] ${truncatedText}`);
          } catch (_) {
            updateDebug('response', "Response text unreadable");
          }
        }
        return response;
      } catch (err: any) {
        if (isAdReq) {
          addLog(`[FETCH ERROR] Request failed/blocked: ${err.message}`);
          updateDebug('httpStatus', 'Failed/Blocked');
          updateDebug('sdkError', err.message || String(err));
        }
        throw err;
      }
    };

    const nativeXHR = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      const urlStr = typeof url === 'string' ? url : (url as URL).toString();
      const isAdReq = urlStr.includes("onclicka") || urlStr.includes("onclckmn") || urlStr.includes("clickadu") || urlStr.includes("groleeguls") || urlStr.includes("wa-");
      
      if (isAdReq) {
        addLog(`[XHR INITIATED] Outgoing request: ${method} to: ${urlStr}`);
        updateDebug('requestSent', 'PASS');
        
        const self = this;
        const originalOnReadyStateChange = this.onreadystatechange;
        this.onreadystatechange = function() {
          if (self.readyState === 4) {
            addLog(`[XHR RESPONSE] Status: ${self.status} for URL: ${urlStr}`);
            updateDebug('httpStatus', String(self.status));
            const text = self.responseText ? (self.responseText.length > 300 ? self.responseText.slice(0, 300) + "..." : self.responseText) : "Empty Response";
            updateDebug('response', text);
            addLog(`[XHR BODY PREVIEW] ${text}`);
          }
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments as any);
          }
        };
      }
      return nativeXHR.call(this, method, url, ...rest);
    };

    // --- Listeners for SDK Errors ---
    const errorHandler = (event: ErrorEvent) => {
      const msg = event.message || "";
      const filename = event.filename || "";
      if (msg.includes("onclicka") || msg.includes("onclckmn") || msg.includes("clickadu") || filename.includes("onclicka")) {
        addLog(`[SDK ERROR] Uncaught JavaScript Error: ${msg} in ${filename}`);
        updateDebug('sdkError', `${msg} (${filename}:${event.lineno})`);
      }
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason ? String(event.reason) : "";
      if (reason.includes("onclicka") || reason.includes("onclckmn") || reason.includes("clickadu")) {
        addLog(`[SDK REJECTION] Unhandled Promise Rejection: ${reason}`);
        updateDebug('sdkError', `Promise Rejection: ${reason}`);
      }
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);

    // Initial Fetch
    fetchConfigAndInject();

    // --- Periodic Audit Loop ---
    let checkCount = 0;
    const interval = setInterval(() => {
      checkCount++;

      // 1. Audit Script Element & Load Flag
      const scriptTagPresent = !!document.head.querySelector('script[src*="onclicka"]') || 
                               !!document.head.querySelector('script[src*="onclckmn"]');
      if (scriptTagPresent && debugLog.scriptLoaded === "PENDING") {
        updateDebug("scriptLoaded", "PASS");
      }

      // 2. Audit SDK object initialization on window
      const waObj = (window as any).wa || (window as any).onclicka || (window as any).OnClickA;
      if (waObj) {
        updateDebug("sdkInitialized", "PASS");
      } else if (checkCount > 10 && debugLog.sdkInitialized === "PENDING") {
        updateDebug("sdkInitialized", "FAIL");
      }

      // 3. Audit performance resource timings for ad network calls
      try {
        const resources = window.performance.getEntriesByType("resource");
        const adRequests = resources.filter(r => 
          (r.name.includes("onclicka") || r.name.includes("clickadu") || r.name.includes("onclckmn") || r.name.includes("groleeguls") || r.name.includes("wa-")) &&
          !r.name.endsWith("onclicka.js")
        );

        if (adRequests.length > 0) {
          updateDebug("requestSent", "PASS");
          if (debugLog.httpStatus === "N/A" || debugLog.httpStatus === "") {
            updateDebug("httpStatus", "200 OK (Resource Loaded)");
          }
          if (debugLog.response === "Awaiting initialization..." || debugLog.response === "No response captured yet.") {
            const lastReq = adRequests[adRequests.length - 1] as any;
            updateDebug("response", `Resource: ${lastReq.name}\nDuration: ${lastReq.duration.toFixed(1)}ms\nTransfer Size: ${lastReq.transferSize || 0} bytes`);
          }
        }
      } catch (_) {}

      // 4. Audit Ad Render (check container children or injected iframe)
      const container = document.getElementById("onclicka-inpage-ad-stage");
      const hasChild = container && container.children.length > 0;
      const iframePresent = !!document.querySelector('iframe[src*="onclicka"]') || 
                            !!document.querySelector('iframe[src*="clickadu"]') || 
                            !!document.querySelector('[id^="wa-"] iframe') || 
                            !!document.querySelector('[class^="wa-"] iframe');

      if (hasChild || iframePresent) {
        updateDebug("adRendered", "PASS");
      } else if (checkCount > 15) { // after ~7.5s with no renders
        if (debugLog.requestSent === "PASS") {
          updateDebug("adRendered", "FAIL");
          addLog("Ad request was sent, but no elements were rendered after 7 seconds. Likely 'No fill' or Geo/Domain restriction.");
        } else if (debugLog.scriptLoaded === "FAIL") {
          updateDebug("adRendered", "FAIL");
          addLog("Ad could not render because the loader script was blocked or failed to load.");
        }
      }

    }, 500);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
      // Restore native methods
      window.fetch = nativeFetch;
      XMLHttpRequest.prototype.open = nativeXHR;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#020617] text-[#f1f5f9] p-4 sm:p-8 font-sans antialiased selection:bg-blue-600 selection:text-white">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-blue-500 font-mono text-xs uppercase tracking-wider mb-1">
            <Activity className="w-4 h-4 animate-pulse" /> Live Runtime Diagnostic Environment
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            OnClickA Ad Diagnostics
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Dedicated sandbox running at <span className="text-slate-300 font-mono">royshare.online/ad-test</span> with zero SDKs or transitions.
          </p>
        </div>
        <div>
          <button
            onClick={fetchConfigAndInject}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-lg text-sm font-medium transition-all active:scale-95"
          >
            <RefreshCw className="w-4 h-4" /> Restart Diagnostic
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Side: Debug panel */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Settings className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Debug & Status Panel</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Stat 1: Script Loaded */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">1. Script Loaded</div>
                  <div className="text-sm font-semibold mt-1 font-mono text-slate-200">
                    {adConfig ? (adConfig.script ? "Configured in Db" : "No Script Code") : "Fetching..."}
                  </div>
                </div>
                <div>
                  {debugLog.scriptLoaded === "PASS" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" /> PASS
                    </span>
                  ) : debugLog.scriptLoaded === "FAIL" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> FAIL
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> PENDING
                    </span>
                  )}
                </div>
              </div>

              {/* Stat 2: SDK Initialized */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">2. SDK Initialized</div>
                  <div className="text-sm font-semibold mt-1 font-mono text-slate-200">
                    {debugLog.sdkInitialized === "PASS" ? "window.wa detected" : "Checking objects..."}
                  </div>
                </div>
                <div>
                  {debugLog.sdkInitialized === "PASS" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" /> PASS
                    </span>
                  ) : debugLog.sdkInitialized === "FAIL" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> FAIL
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> PENDING
                    </span>
                  )}
                </div>
              </div>

              {/* Stat 3: Request Sent */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">3. Request Sent</div>
                  <div className="text-sm font-semibold mt-1 font-mono text-slate-200">
                    {debugLog.requestSent === "PASS" ? "Ad request sent" : "Listening networks..."}
                  </div>
                </div>
                <div>
                  {debugLog.requestSent === "PASS" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" /> PASS
                    </span>
                  ) : debugLog.requestSent === "FAIL" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> FAIL
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> PENDING
                    </span>
                  )}
                </div>
              </div>

              {/* Stat 4: Ad Rendered */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">4. Ad Rendered</div>
                  <div className="text-sm font-semibold mt-1 font-mono text-slate-200">
                    {debugLog.adRendered === "PASS" ? "Ad node / iframe loaded" : "Monitoring DOM..."}
                  </div>
                </div>
                <div>
                  {debugLog.adRendered === "PASS" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" /> PASS
                    </span>
                  ) : debugLog.adRendered === "FAIL" ? (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> FAIL
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> PENDING
                    </span>
                  )}
                </div>
              </div>

            </div>

            {/* HTTP Status & Response section */}
            <div className="mt-5 space-y-4">
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400 font-mono mb-1">HTTP STATUS</div>
                <div className="text-sm font-bold font-mono text-blue-400">
                  {debugLog.httpStatus}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400 font-mono mb-1">INTERCEPTED RESPONSE / URI DETAILS</div>
                <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-32 bg-slate-900/40 p-2 rounded border border-slate-800/80">
                  {debugLog.response}
                </pre>
              </div>

              {debugLog.sdkError !== "None detected" && (
                <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs text-rose-400 font-semibold uppercase tracking-wider">SDK Error Detected</div>
                    <p className="text-xs text-rose-300 font-mono mt-1 whitespace-pre-wrap">{debugLog.sdkError}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Console / Event Log Panel */}
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Terminal className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Event & Console Log</h2>
            </div>
            <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs border border-slate-800 h-64 overflow-y-auto space-y-2 select-text">
              {consoleLogs.length === 0 ? (
                <span className="text-slate-500">No events logged yet.</span>
              ) : (
                consoleLogs.map((log, i) => (
                  <div key={i} className="text-slate-300 leading-relaxed border-b border-slate-900/50 pb-1 last:border-0">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Ad Container */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl flex flex-col h-full min-h-[480px]">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Globe className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Dedicated Ad Container</h2>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Below is the exact stage container centered for OnClickA inpage ad. If loaded, the SDK will dynamically inject elements directly here.
            </p>

            <div className="flex-1 flex items-center justify-center bg-slate-950 rounded-xl border border-dashed border-slate-800 relative overflow-hidden min-h-[300px]">
              
              {/* Dedicated stage container for OnClickA SDK */}
              <div 
                className="onclicka-ad-container my-4 min-h-[50px] w-full max-w-md flex flex-col items-center justify-center text-xs text-slate-500 font-mono transition-all z-10"
                id="onclicka-inpage-ad-stage"
              >
                {/* Loader script target stage */}
              </div>

              {/* Decorative Background Grid Pattern */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:1.5rem_1.5rem] opacity-30"></div>
              
              {/* Inner overlay status */}
              <div className="absolute top-3 left-3 text-[10px] font-mono text-slate-500 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
                #onclicka-inpage-ad-stage
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800/80 text-xs text-slate-500 space-y-1">
              <div>• Native element binding is used for maximum performance.</div>
              <div>• Ensure any browser-level AdBlock is turned off during testing.</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
