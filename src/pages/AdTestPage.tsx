import { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Activity, 
  Terminal, 
  Globe, 
  RefreshCw,
  Info,
  Layers,
  Cpu,
  Radio,
  FileCode,
  ShieldAlert,
  MapPin,
  Check
} from "lucide-react";

interface DebugLog {
  scriptLoaded: "PASS" | "FAIL" | "PENDING";
  bannerContainerFound: "PASS" | "FAIL" | "PENDING";
  sdkInitialized: "PASS" | "FAIL" | "PENDING";
  requestSent: "PASS" | "FAIL" | "PENDING";
  httpStatus: string;
  response: string;
  adRendered: "PASS" | "FAIL" | "PENDING";
  fillStatus: "Yes" | "No" | "PENDING";
  liveAdPreview: "PASS" | "FAIL" | "PENDING";
  sdkError: string;
  failureReason: string;
}

interface GlobalObjStatus {
  name: string;
  present: boolean;
  type: string;
  details: any;
}

interface InterceptedRequest {
  id: string;
  time: string;
  type: "FETCH" | "XHR" | "RESOURCE_TIMING";
  url: string;
  method?: string;
  status: string;
  responsePreview?: string;
}

export default function AdTestPage() {
  const [adConfig, setAdConfig] = useState<{
    enabled: boolean;
    verified: boolean;
    script: string;
    network: string;
    bannerContainerCode: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [debugLog, setDebugLog] = useState<DebugLog>({
    scriptLoaded: "PENDING",
    bannerContainerFound: "PENDING",
    sdkInitialized: "PENDING",
    requestSent: "PENDING",
    httpStatus: "N/A",
    response: "Awaiting initialization...",
    adRendered: "PENDING",
    fillStatus: "PENDING",
    liveAdPreview: "PENDING",
    sdkError: "None detected",
    failureReason: "None detected"
  });

  const [globalStatuses, setGlobalStatuses] = useState<GlobalObjStatus[]>([]);
  const [interceptedRequests, setInterceptedRequests] = useState<InterceptedRequest[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [ocManInspector, setOcManInspector] = useState<any>(null);
  
  // Diagnostic State Machine: IDLE -> RUNNING -> COMPLETED
  const [diagnosticState, setDiagnosticState] = useState<"IDLE" | "RUNNING" | "COMPLETED">("IDLE");
  
  const isMounted = useRef(true);
  const auditHasRun = useRef(false);

  // References to safely clean up monkeypatches and observers without memory leaks
  const cleanupRefs = useRef<{
    restoreFetch?: () => void;
    restoreXHR?: () => void;
    disconnectObserver?: () => void;
    removeEventListeners?: () => void;
  }>({});

  // Refs to prevent stale closures inside asynchronous monkeypatched interceptors
  const addLogRef = useRef<(msg: string) => void>(() => {});
  const updateDebugRef = useRef<(key: keyof DebugLog, value: any) => void>(() => {});

  // Standard logging helper
  const addLog = (msg: string) => {
    if (!isMounted.current) return;
    setConsoleLogs(prev => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 59)
    ]);
  };

  // Sync refs on render
  useEffect(() => {
    addLogRef.current = addLog;
  });

  const runAudit = async () => {
    if (diagnosticState === "RUNNING") return;

    // Safety cleanup of any lingering callbacks from prior runs
    if (cleanupRefs.current.restoreFetch) cleanupRefs.current.restoreFetch();
    if (cleanupRefs.current.restoreXHR) cleanupRefs.current.restoreXHR();
    if (cleanupRefs.current.disconnectObserver) cleanupRefs.current.disconnectObserver();
    if (cleanupRefs.current.removeEventListeners) cleanupRefs.current.removeEventListeners();

    setDiagnosticState("RUNNING");
    setLoading(true);
    setError(null);
    setConsoleLogs([]);
    setInterceptedRequests([]);
    setOcManInspector(null);
    setGlobalStatuses([]);

    const initialDebugLog: DebugLog = {
      scriptLoaded: "PENDING",
      bannerContainerFound: "PENDING",
      sdkInitialized: "PENDING",
      requestSent: "PENDING",
      httpStatus: "N/A",
      response: "Running audit...",
      adRendered: "PENDING",
      fillStatus: "PENDING",
      liveAdPreview: "PENDING",
      sdkError: "None detected",
      failureReason: "None detected"
    };
    setDebugLog(initialDebugLog);

    // Keep local mirror to bypass stale react closures in callbacks
    const localDebugLog = { ...initialDebugLog };
    const updateLocalDebug = (key: keyof DebugLog, value: any) => {
      localDebugLog[key] = value;
      setDebugLog(prev => ({ ...prev, [key]: value }));
    };
    updateDebugRef.current = updateLocalDebug;

    addLogRef.current("Initializing deep runtime audit. This will perform a deterministic, clean 5-second assessment...");

    // 1. Monkeypatch fetch to log outgoing requests
    const nativeFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      const isAdReq = url.includes("onclicka") || url.includes("onclckmn") || url.includes("clickadu") || url.includes("groleeguls") || url.includes("wa-") || url.includes("ntvpwpush.com") || url.includes("bid.onclcktg.com") || url.includes("ssp.zog.link");
      
      if (isAdReq) {
        addLogRef.current(`[FETCH INITIATED] Outgoing request to: ${url}`);
        updateDebugRef.current('requestSent', 'PASS');
        
        const newReq: InterceptedRequest = {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString(),
          type: "FETCH",
          url: url,
          method: "GET",
          status: "Pending..."
        };
        setInterceptedRequests(prev => [newReq, ...prev]);
      }

      try {
        const response = await nativeFetch.apply(this, args);
        if (isAdReq) {
          addLogRef.current(`[FETCH RESPONSE] Status: ${response.status} ${response.statusText} for URL: ${url}`);
          updateDebugRef.current('httpStatus', `${response.status} ${response.statusText}`);
          
          setInterceptedRequests(prev => prev.map(r => r.url === url ? { ...r, status: `${response.status} ${response.statusText}` } : r));

          try {
            const clone = response.clone();
            const text = await clone.text();
            const truncatedText = text.length > 500 ? text.slice(0, 500) + "..." : text;
            updateDebugRef.current('response', truncatedText || "Empty Response");
            addLogRef.current(`[FETCH BODY PREVIEW] ${truncatedText}`);
            
            setInterceptedRequests(prev => prev.map(r => r.url === url ? { ...r, responsePreview: truncatedText } : r));
          } catch (_) {
            updateDebugRef.current('response', "Response text unreadable");
          }
        }
        return response;
      } catch (err: any) {
        if (isAdReq) {
          addLogRef.current(`[FETCH ERROR] Request failed/blocked: ${err.message}`);
          updateDebugRef.current('httpStatus', 'Failed/Blocked');
          updateDebugRef.current('sdkError', err.message || String(err));
          
          setInterceptedRequests(prev => prev.map(r => r.url === url ? { ...r, status: "FAILED/BLOCKED", responsePreview: err.message } : r));
        }
        throw err;
      }
    };
    cleanupRefs.current.restoreFetch = () => {
      window.fetch = nativeFetch;
    };

    // 2. Monkeypatch XMLHttpRequest to log outgoing requests
    const nativeXHR = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      const urlStr = typeof url === 'string' ? url : (url as URL).toString();
      const isAdReq = urlStr.includes("onclicka") || urlStr.includes("onclckmn") || urlStr.includes("clickadu") || urlStr.includes("groleeguls") || urlStr.includes("wa-") || urlStr.includes("ntvpwpush.com") || urlStr.includes("bid.onclcktg.com") || urlStr.includes("ssp.zog.link");
      
      if (isAdReq) {
        addLogRef.current(`[XHR INITIATED] Outgoing request: ${method} to: ${urlStr}`);
        updateDebugRef.current('requestSent', 'PASS');

        const newReq: InterceptedRequest = {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString(),
          type: "XHR",
          url: urlStr,
          method: method,
          status: "Pending..."
        };
        setInterceptedRequests(prev => [newReq, ...prev]);
        
        const self = this;
        const originalOnReadyStateChange = this.onreadystatechange;
        this.onreadystatechange = function() {
          if (self.readyState === 4) {
            addLogRef.current(`[XHR RESPONSE] Status: ${self.status} for URL: ${urlStr}`);
            updateDebugRef.current('httpStatus', String(self.status));
            
            const text = self.responseText ? (self.responseText.length > 500 ? self.responseText.slice(0, 500) + "..." : self.responseText) : "Empty Response";
            updateDebugRef.current('response', text);
            addLogRef.current(`[XHR BODY PREVIEW] ${text}`);

            setInterceptedRequests(prev => prev.map(r => r.url === urlStr ? { ...r, status: String(self.status), responsePreview: text } : r));
          }
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments as any);
          }
        };
      }
      return nativeXHR.call(this, method, url, ...rest);
    };
    cleanupRefs.current.restoreXHR = () => {
      XMLHttpRequest.prototype.open = nativeXHR;
    };

    // 3. Register global SDK error listeners
    const errorHandler = (event: ErrorEvent) => {
      const msg = event.message || "";
      const filename = event.filename || "";
      if (msg.includes("onclicka") || msg.includes("onclckmn") || msg.includes("clickadu") || filename.includes("onclicka") || msg.includes("ocMan")) {
        addLogRef.current(`[SDK ERROR] Uncaught JS Error: ${msg} in ${filename}`);
        updateDebugRef.current('sdkError', `${msg} (${filename}:${event.lineno})`);
      }
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason ? String(event.reason) : "";
      if (reason.includes("onclicka") || reason.includes("onclckmn") || reason.includes("clickadu") || reason.includes("ocMan")) {
        addLogRef.current(`[SDK REJECTION] Unhandled Promise Rejection: ${reason}`);
        updateDebugRef.current('sdkError', `Promise Rejection: ${reason}`);
      }
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);
    cleanupRefs.current.removeEventListeners = () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
    };

    // 4. Setup MutationObserver to watch for iframe/ad elements reactively
    const observer = new MutationObserver(() => {
      const container = document.getElementById("onclicka-inpage-ad-stage");
      const bannerElInStage = container?.firstElementChild;
      const hasInjectedContent = bannerElInStage && bannerElInStage.childNodes.length > 0;
      const iframePresent = container && (
                            !!container.querySelector('iframe') ||
                            !!document.querySelector('iframe[src*="onclicka"]') || 
                            !!document.querySelector('iframe[src*="clickadu"]') || 
                            !!document.querySelector('[id^="wa-"] iframe') || 
                            !!document.querySelector('[class^="wa-"] iframe')
                          );

      if (hasInjectedContent || iframePresent) {
        addLogRef.current("[RENDERED] OnClickA advertisement rendered (iframe or container nodes detected)!");
        updateDebugRef.current("adRendered", "PASS");
        updateDebugRef.current("fillStatus", "Yes");
        updateDebugRef.current("liveAdPreview", "PASS");
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    cleanupRefs.current.disconnectObserver = () => {
      observer.disconnect();
    };

    // 5. Fetch Firestore configuration
    addLogRef.current("Step 1: Fetching advertisement configuration from Firestore...");
    let dbConfig: any = null;
    try {
      const docRef = doc(db, "settings", "advertisement");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        throw new Error("No settings/advertisement document exists in Firestore.");
      }
      dbConfig = docSnap.data();
      addLogRef.current(`Config loaded: enabled=${dbConfig.enabled}, verified=${dbConfig.verified}, network=${dbConfig.network}`);
      
      setAdConfig({
        enabled: dbConfig.enabled ?? false,
        verified: dbConfig.verified ?? false,
        script: dbConfig.adsScriptCode || dbConfig.script || "",
        network: dbConfig.network || "onclicka",
        bannerContainerCode: dbConfig.bannerContainerCode || dbConfig.bannerContainer || ""
      });
    } catch (err: any) {
      addLogRef.current(`Error fetching Firestore config: ${err.message}`);
      setError(err.message || "Failed to fetch Firestore config.");
      updateLocalDebug("scriptLoaded", "FAIL");
      updateLocalDebug("failureReason", `Firestore config fetch error: ${err.message}`);
      setLoading(false);
      setDiagnosticState("COMPLETED");
      if (cleanupRefs.current.restoreFetch) cleanupRefs.current.restoreFetch();
      if (cleanupRefs.current.restoreXHR) cleanupRefs.current.restoreXHR();
      if (cleanupRefs.current.disconnectObserver) cleanupRefs.current.disconnectObserver();
      if (cleanupRefs.current.removeEventListeners) cleanupRefs.current.removeEventListeners();
      return;
    }

    if (!dbConfig.enabled || !dbConfig.verified) {
      addLogRef.current("Ad settings are disabled or not verified in Firestore. Terminating diagnostic.");
      updateLocalDebug("scriptLoaded", "FAIL");
      updateLocalDebug("failureReason", "Ad settings are disabled or not verified in Firestore database.");
      setLoading(false);
      setDiagnosticState("COMPLETED");
      if (cleanupRefs.current.restoreFetch) cleanupRefs.current.restoreFetch();
      if (cleanupRefs.current.restoreXHR) cleanupRefs.current.restoreXHR();
      if (cleanupRefs.current.disconnectObserver) cleanupRefs.current.disconnectObserver();
      if (cleanupRefs.current.removeEventListeners) cleanupRefs.current.removeEventListeners();
      return;
    }

    // Extract attributes
    const scriptCode = dbConfig.script || "";
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
        addLogRef.current(`Parsed loader script URL: ${src}`);
        addLogRef.current(`Parsed attributes: ${JSON.stringify(attributes)}`);
      }
    } catch (e: any) {
      addLogRef.current(`Warning parsing script attributes: ${e.message}`);
    }

    // 6. Check if OnClickA script is already injected
    const existingScript = document.querySelector('script[src*="onclicka"]') || 
                           document.querySelector('script[src*="onclckmn"]');

    if (existingScript) {
      addLogRef.current("Step 2: OnClickA script tag is ALREADY present in document.head. Respecting single-injection rule.");
      updateLocalDebug("scriptLoaded", "PASS");

      // Inject the Banner Container HTML into the preview area!
      addLogRef.current("Injecting Banner Container HTML into the staging target...");
      const bannerContainerCode = dbConfig.bannerContainerCode || dbConfig.bannerContainer || "";
      const targetStage = document.getElementById("onclicka-inpage-ad-stage");
      if (targetStage) {
        targetStage.innerHTML = bannerContainerCode;
        addLogRef.current("✅ Banner Container HTML successfully injected into the staging target!");
        updateLocalDebug("bannerContainerFound", "PASS");
      } else {
        addLogRef.current("❌ Error: Staging target #onclicka-inpage-ad-stage not found.");
        updateLocalDebug("bannerContainerFound", "FAIL");
      }
    } else {
      addLogRef.current("Step 2: No existing OnClickA script tag found. Injecting script tag once...");
      const scriptEl = document.createElement("script");
      scriptEl.src = src;
      Object.keys(attributes).forEach((key) => {
        scriptEl.setAttribute(key, attributes[key]);
      });
      scriptEl.setAttribute("data-cfasync", "false");
      scriptEl.async = true;

      const scriptLoadPromise = new Promise<boolean>((resolve) => {
        scriptEl.onload = () => resolve(true);
        scriptEl.onerror = () => resolve(false);
        // Safety timeout of 5 seconds
        setTimeout(() => resolve(false), 5000);
      });

      document.head.appendChild(scriptEl);

      const isLoaded = await scriptLoadPromise;
      if (isLoaded) {
        addLogRef.current("OnClickA script loaded successfully (onload triggered).");
        updateLocalDebug("scriptLoaded", "PASS");
        (window as any).__onclickaScriptLoaded = true;

        // Inject the Banner Container HTML into the preview area!
        addLogRef.current("Injecting Banner Container HTML into the staging target...");
        const bannerContainerCode = dbConfig.bannerContainerCode || dbConfig.bannerContainer || "";
        const targetStage = document.getElementById("onclicka-inpage-ad-stage");
        if (targetStage) {
          targetStage.innerHTML = bannerContainerCode;
          addLogRef.current("✅ Banner Container HTML successfully injected into the staging target!");
          updateLocalDebug("bannerContainerFound", "PASS");
        } else {
          addLogRef.current("❌ Error: Staging target #onclicka-inpage-ad-stage not found.");
          updateLocalDebug("bannerContainerFound", "FAIL");
        }
      } else {
        addLogRef.current("OnClickA script failed to load (or timed out). AdBlocker or CSP blocked execution.");
        updateLocalDebug("scriptLoaded", "FAIL");
        updateLocalDebug("failureReason", "Network blocked script (AdBlocker or Content Security Policy blocked onclicka.js)");
        (window as any).__onclickaScriptLoaded = false;
        updateLocalDebug("bannerContainerFound", "FAIL");
        
        // Finalize immediately
        setLoading(false);
        setDiagnosticState("COMPLETED");
        if (cleanupRefs.current.restoreFetch) cleanupRefs.current.restoreFetch();
        if (cleanupRefs.current.restoreXHR) cleanupRefs.current.restoreXHR();
        if (cleanupRefs.current.disconnectObserver) cleanupRefs.current.disconnectObserver();
        if (cleanupRefs.current.removeEventListeners) cleanupRefs.current.removeEventListeners();
        return;
      }
    }

    setLoading(false);

    // 7. Active Observation Phase
    addLogRef.current("Step 3: Script confirmed. Running deterministic observation phase to capture async SDK triggers, requests, and rendering...");

    const checkSDKNamespace = () => {
      const win = window as any;
      const oc = win.ocMan || win.a3klsam || win.wa || win.onclicka || win.OnClickA;
      
      const statuses: GlobalObjStatus[] = [
        {
          name: "window.ocMan",
          present: !!win.ocMan,
          type: win.ocMan ? typeof win.ocMan : "N/A",
          details: win.ocMan ? {
            tagId: win.ocMan.tagId,
            version: win.ocMan.version,
            customDomain: win.ocMan.customDomain,
            sessionState: win.ocMan.sessionState ? "Configured" : "N/A",
            customSettings: win.ocMan.customSettings ? "Loaded" : "N/A"
          } : null
        },
        {
          name: "window.a3klsam",
          present: !!win.a3klsam,
          type: win.a3klsam ? typeof win.a3klsam : "N/A",
          details: win.a3klsam ? "Alias of ocMan" : null
        },
        {
          name: "window.wa",
          present: !!win.wa,
          type: win.wa ? typeof win.wa : "N/A",
          details: win.wa ? "Alternate SDK namespace" : null
        },
        {
          name: "window.onclicka",
          present: !!win.onclicka,
          type: win.onclicka ? typeof win.onclicka : "N/A",
          details: null
        },
        {
          name: "window.OnClickA",
          present: !!win.OnClickA,
          type: win.OnClickA ? typeof win.OnClickA : "N/A",
          details: null
        }
      ];
      setGlobalStatuses(statuses);

      if (win.ocMan) {
        updateLocalDebug("sdkInitialized", "PASS");
        const inspectorData: any = {};
        try {
          const keys = Object.getOwnPropertyNames(win.ocMan).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(win.ocMan)));
          keys.forEach(k => {
            if (typeof win.ocMan[k] === "function") {
              inspectorData[k + "()"] = "[Function]";
            } else {
              inspectorData[k] = win.ocMan[k];
            }
          });
          setOcManInspector(inspectorData);
        } catch (_) {}
      }
    };

    // Initial check
    checkSDKNamespace();

    // Check again at midpoint (2.5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 2500));
    checkSDKNamespace();

    // Check again at end (2.5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 2500));
    checkSDKNamespace();

    // Secondary fallback: Audit Performance Resource Timings
    try {
      const resources = window.performance.getEntriesByType("resource");
      const adRequests = resources.filter(r => 
        (r.name.includes("onclicka") || r.name.includes("clickadu") || r.name.includes("onclckmn") || r.name.includes("groleeguls") || r.name.includes("wa-") || r.name.includes("ntvpwpush.com") || r.name.includes("bid.onclcktg.com") || r.name.includes("ssp.zog.link")) &&
        !r.name.endsWith("onclicka.js")
      );

      if (adRequests.length > 0) {
        updateLocalDebug("requestSent", "PASS");
        adRequests.forEach((res: any) => {
          setInterceptedRequests(prev => {
            const exists = prev.some(r => r.url === res.name);
            if (exists) return prev;
            return [{
              id: Math.random().toString(),
              time: new Date().toLocaleTimeString(),
              type: "RESOURCE_TIMING",
              url: res.name,
              status: `Loaded (~${res.duration.toFixed(0)}ms)`,
              responsePreview: `Transfer Size: ${res.transferSize || 0} bytes. Protocol: ${res.nextHopProtocol || "N/A"}`
            }, ...prev];
          });
        });
      }
    } catch (_) {}

    // Final DOM render check
    const container = document.getElementById("onclicka-inpage-ad-stage");
    const bannerElInStage = container?.firstElementChild;
    const hasInjectedContent = bannerElInStage && bannerElInStage.childNodes.length > 0;
    const iframePresent = container && (
                          !!container.querySelector('iframe') ||
                          !!document.querySelector('iframe[src*="onclicka"]') || 
                          !!document.querySelector('iframe[src*="clickadu"]') || 
                          !!document.querySelector('[id^="wa-"] iframe') || 
                          !!document.querySelector('[class^="wa-"] iframe')
                        );

    if (hasInjectedContent || iframePresent) {
      updateLocalDebug("adRendered", "PASS");
      updateLocalDebug("fillStatus", "Yes");
      updateLocalDebug("liveAdPreview", "PASS");
    }

    // 8. Compile Final Report
    addLogRef.current("Step 4: Observation window closed. Compiling final report...");

    if (localDebugLog.bannerContainerFound === "PENDING") {
      if (container && container.innerHTML.trim().length > 0) {
        updateLocalDebug("bannerContainerFound", "PASS");
      } else {
        updateLocalDebug("bannerContainerFound", "FAIL");
      }
    }

    if (localDebugLog.sdkInitialized === "PENDING") {
      updateLocalDebug("sdkInitialized", "FAIL");
      updateLocalDebug("failureReason", "Global namespace 'window.ocMan' is not defined after script load.");
    }

    if (localDebugLog.requestSent === "PENDING") {
      updateLocalDebug("requestSent", "FAIL");
      if (localDebugLog.sdkInitialized === "PASS") {
        updateLocalDebug("failureReason", "SDK is initialized but sent no request (requires manual trigger or Telegram client view).");
      } else {
        updateLocalDebug("failureReason", "Request could not be sent because SDK failed to initialize.");
      }
    }

    if (localDebugLog.adRendered === "PENDING" || localDebugLog.adRendered === "FAIL") {
      updateLocalDebug("adRendered", "FAIL");
      updateLocalDebug("fillStatus", "No");
      updateLocalDebug("liveAdPreview", "FAIL");
      if (localDebugLog.requestSent === "PASS") {
        let reason = "No fill";
        const errorMsg = localDebugLog.sdkError.toLowerCase();
        if (errorMsg.includes("csp") || errorMsg.includes("content security policy")) {
          reason = "Content Security Policy (CSP) blocked resources";
        } else if (errorMsg.includes("domain") || errorMsg.includes("origin")) {
          reason = "Domain restriction (This domain is not allowed/whitelisted by OnClickA)";
        } else if (errorMsg.includes("geo") || errorMsg.includes("country")) {
          reason = "Geo restriction (No campaigns available for this IP geographic location)";
        } else if (errorMsg.includes("telegram") || errorMsg.includes("tgwebapp")) {
          reason = "Telegram WebView restriction (SDK requires active Telegram client)";
        }
        updateLocalDebug("failureReason", reason);
      } else if (localDebugLog.scriptLoaded === "FAIL") {
        updateLocalDebug("failureReason", "Script failed to load or was blocked by AdBlocker/network filter.");
      }
    }

    if (localDebugLog.scriptLoaded === "PASS" && localDebugLog.bannerContainerFound === "PASS" && localDebugLog.sdkInitialized === "PASS" && localDebugLog.requestSent === "PASS" && localDebugLog.adRendered === "PASS") {
      updateLocalDebug("failureReason", "None (All direct SDK namespace audit indicators passed successfully!)");
    }

    // 9. Remove all monkeypatches and listeners completely to guarantee clean state
    if (cleanupRefs.current.restoreFetch) cleanupRefs.current.restoreFetch();
    if (cleanupRefs.current.restoreXHR) cleanupRefs.current.restoreXHR();
    if (cleanupRefs.current.disconnectObserver) cleanupRefs.current.disconnectObserver();
    if (cleanupRefs.current.removeEventListeners) cleanupRefs.current.removeEventListeners();

    addLogRef.current("Audit completed. Diagnostic state set to COMPLETED.");
    setDiagnosticState("COMPLETED");
  };

  const handleManualInit = () => {
    const oc = (window as any).ocMan;
    if (oc) {
      addLog("Triggering manual initialization via window.ocMan.init()...");
      try {
        oc.tagId = adConfig?.script?.match(/data-admpid="(\d+)"/)?.[1] || oc.tagId || "447156";
        addLog(`Set ocMan.tagId to: ${oc.tagId}`);
        oc.init();
        addLog("Manual initialization call complete.");
      } catch (e: any) {
        addLog(`Manual init failed with error: ${e.message}`);
      }
    } else {
      addLog("Cannot manual init: window.ocMan is not defined.");
    }
  };

  // Run audit exactly once on mount, guarded against strict mode dual-mounting
  useEffect(() => {
    isMounted.current = true;
    if (!auditHasRun.current) {
      auditHasRun.current = true;
      runAudit();
    }
    return () => {
      isMounted.current = false;
      if (cleanupRefs.current.restoreFetch) cleanupRefs.current.restoreFetch();
      if (cleanupRefs.current.restoreXHR) cleanupRefs.current.restoreXHR();
      if (cleanupRefs.current.disconnectObserver) cleanupRefs.current.disconnectObserver();
      if (cleanupRefs.current.removeEventListeners) cleanupRefs.current.removeEventListeners();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#020617] text-[#f1f5f9] p-4 sm:p-8 font-sans antialiased selection:bg-blue-600 selection:text-white">
      
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-blue-500 font-mono text-xs uppercase tracking-wider mb-1">
            <Activity className="w-4 h-4 animate-pulse" /> Direct SDK Namespace Auditor
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            OnClickA Deep Auditing
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Directly monitoring <span className="text-blue-400 font-mono">window.ocMan</span> and intercepting network traffic on <span className="text-slate-300 font-mono">royshare.online/ad-test</span>.
          </p>
        </div>
        <div className="flex gap-2">
          {!!(window as any).ocMan && (
            <button
              onClick={handleManualInit}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-all active:scale-95"
            >
              <Cpu className="w-4 h-4" /> Force Manual Init
            </button>
          )}
          <button
            onClick={() => runAudit()}
            disabled={diagnosticState === "RUNNING"}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 border border-slate-700 hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all active:scale-95"
          >
            <RefreshCw className={`w-4 h-4 ${diagnosticState === "RUNNING" ? "animate-spin" : ""}`} /> Restart Diagnostic
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left column: Controls and detailed global namespace lists */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* PRISTINE FINAL AUDIT REPORT CARD */}
          {diagnosticState === "COMPLETED" && (
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border-2 border-blue-500/30 rounded-xl p-6 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-blue-600/15 text-blue-400 font-mono text-[10px] px-3 py-1 uppercase tracking-wider rounded-bl border-l border-b border-blue-500/20">
                Final Audit Report
              </div>
              
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="w-6 h-6 text-emerald-500" />
                <div>
                  <h3 className="text-lg font-bold text-white">Diagnostic Audit Completed</h3>
                  <p className="text-xs text-slate-400">All direct SDK namespace measurements and network interactions captured successfully.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-b border-slate-800 py-4 my-4">
                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">Loader Script Loaded</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.scriptLoaded === "PASS" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.scriptLoaded}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">Banner Container Found</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.bannerContainerFound === "PASS" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.bannerContainerFound}
                  </span>
                </div>
                
                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">SDK Initialized</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.sdkInitialized === "PASS" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.sdkInitialized}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">Request Sent</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.requestSent === "PASS" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.requestSent}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">HTTP Status</span>
                  <span className="text-sm font-semibold font-mono text-blue-400">
                    {debugLog.httpStatus}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">Ad Rendered</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.adRendered === "PASS" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.adRendered}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">Fill Status</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.fillStatus === "Yes" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.fillStatus}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-mono uppercase block">Live Ad Preview</span>
                  <span className={`text-sm font-semibold font-mono ${debugLog.liveAdPreview === "PASS" ? "text-emerald-400" : "text-rose-400"}`}>
                    {debugLog.liveAdPreview}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Failure Reason & Evidence</span>
                <div className="bg-slate-950 px-3 py-2 rounded border border-slate-800 text-xs font-mono text-slate-300">
                  {debugLog.failureReason}
                </div>
              </div>
            </div>
          )}

          {/* Main 8 Core States Dashboard */}
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Layers className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Live Core Audit States</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Core State 1: Loader Script Loaded */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">1. Loader Script Loaded</div>
                  <div>
                    {debugLog.scriptLoaded === "PASS" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> PASS
                      </span>
                    ) : debugLog.scriptLoaded === "FAIL" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Evidence:</span> {debugLog.scriptLoaded === "PASS" ? "onclicka.js fetched and parsed" : "Awaiting load callback"}
                </div>
              </div>

              {/* Core State 2: Banner Container Found */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">2. Banner Container Found</div>
                  <div>
                    {debugLog.bannerContainerFound === "PASS" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> PASS
                      </span>
                    ) : debugLog.bannerContainerFound === "FAIL" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Evidence:</span> {debugLog.bannerContainerFound === "PASS" ? "Staging area container found" : "Container not found in page"}
                </div>
              </div>

              {/* Core State 3: SDK Initialized */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">3. SDK Initialized</div>
                  <div>
                    {debugLog.sdkInitialized === "PASS" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> PASS
                      </span>
                    ) : debugLog.sdkInitialized === "FAIL" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Evidence:</span> {debugLog.sdkInitialized === "PASS" ? "window.ocMan / window.a3klsam active" : "Checking window namespace..."}
                </div>
              </div>

              {/* Core State 4: Request Sent */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">4. Request Sent</div>
                  <div>
                    {debugLog.requestSent === "PASS" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> PASS
                      </span>
                    ) : debugLog.requestSent === "FAIL" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Evidence:</span> {debugLog.requestSent === "PASS" ? "Outgoing fetch/xhr or timings captured" : "No outgoing ad requests logged"}
                </div>
              </div>

              {/* Core State 5: HTTP Status */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">5. HTTP Status</div>
                  <div>
                    <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full font-bold">
                      {debugLog.httpStatus}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Latest status returned:</span> {debugLog.httpStatus}
                </div>
              </div>

              {/* Core State 6: Ad Rendered */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">6. Ad Rendered</div>
                  <div>
                    {debugLog.adRendered === "PASS" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> PASS
                      </span>
                    ) : debugLog.adRendered === "FAIL" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Evidence:</span> {debugLog.adRendered === "PASS" ? "DOM container loaded elements" : "No iframe/DOM nodes injected"}
                </div>
              </div>

              {/* Core State 7: Fill Status */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">7. Fill Status</div>
                  <div>
                    {debugLog.fillStatus === "Yes" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> YES
                      </span>
                    ) : debugLog.fillStatus === "No" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> NO
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Response:</span> {debugLog.fillStatus === "Yes" ? "Ad content loaded" : "Awaiting fill status"}
                </div>
              </div>

              {/* Core State 8: Live Ad Preview */}
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 flex flex-col justify-between h-28">
                <div className="flex items-start justify-between">
                  <div className="text-xs text-slate-400 font-mono uppercase tracking-wider">8. Live Ad Preview</div>
                  <div>
                    {debugLog.liveAdPreview === "PASS" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-bold">
                        <Check className="w-3 h-3" /> PASS
                      </span>
                    ) : debugLog.liveAdPreview === "FAIL" ? (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold">
                        <XCircle className="w-3 h-3" /> FAIL
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                        <Loader2 className="w-3 h-3 animate-spin" /> PENDING
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-2">
                  <span className="text-slate-500">Live preview:</span> {debugLog.liveAdPreview === "PASS" ? "Live Ad Rendering is PASS" : "Awaiting rendering"}
                </div>
              </div>

            </div>

            {/* Core State 5: Ad Server Response Info */}
            <div className="mt-4 bg-slate-950 p-4 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <Radio className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-slate-300 font-semibold uppercase tracking-wider">5. Ad Server Response Received (HTTP status)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-slate-900 p-2 rounded border border-slate-800">
                  <div className="text-slate-500">STATUS CODE:</div>
                  <div className="text-blue-400 font-bold mt-0.5">{debugLog.httpStatus}</div>
                </div>
                <div className="bg-slate-900 p-2 rounded border border-slate-800 sm:col-span-3">
                  <div className="text-slate-500">LATEST REQUEST/RESPONSE TYPE:</div>
                  <div className="text-slate-300 truncate mt-0.5">
                    {interceptedRequests[0] ? `${interceptedRequests[0].type}: ${interceptedRequests[0].url}` : "None logged"}
                  </div>
                </div>
              </div>
            </div>

            {/* Core State 6: Exact failure reason */}
            <div className="mt-4 bg-slate-950 p-4 rounded-lg border border-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-slate-300 font-semibold uppercase tracking-wider">6. Specified Failure Reason & Evidence</span>
              </div>
              <div className="p-3 bg-amber-950/10 border border-amber-900/30 rounded flex items-start gap-2.5 text-xs">
                <Info className="w-4.5 h-4.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-300 uppercase tracking-wide">
                    {debugLog.failureReason !== "None detected" ? debugLog.failureReason : "Checking all indicators..."}
                  </div>
                  <p className="text-slate-400 mt-1 font-mono">
                    {debugLog.failureReason === "No fill" ? (
                      "SDK and communication are PASS, but the ad provider returned no campaign banners. This is normal for staging domains or fresh ad tag placements."
                    ) : debugLog.failureReason === "None detected" ? (
                      "The SDK is currently performing startup routines and fetching. Check the logs below for real-time trace events."
                    ) : (
                      "Please inspect the JavaScript Console Log and outgoing Intercepted Request items to verify network restrictions or CSP blocks."
                    )}
                  </p>
                </div>
              </div>
            </div>

          </div>

          {/* Deep inspection table of window variables */}
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Cpu className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Window Global Namespaces Audit</h2>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2">Global Property</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Inspection Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {globalStatuses.map((g, idx) => (
                    <tr key={idx} className="hover:bg-slate-950/30">
                      <td className="py-3 font-semibold text-blue-400">{g.name}</td>
                      <td className="py-3">
                        {g.present ? (
                          <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/10">Detected</span>
                        ) : (
                          <span className="text-slate-500">Absent</span>
                        )}
                      </td>
                      <td className="py-3 text-slate-400">{g.type}</td>
                      <td className="py-3 text-[10px] text-slate-400 max-w-xs truncate">
                        {g.details ? JSON.stringify(g.details) : "N/A"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live ocMan inspector panel */}
          {ocManInspector && (
            <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
              <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
                <FileCode className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-bold text-white">Live SDK Object Inspector (window.ocMan)</h2>
              </div>
              <p className="text-xs text-slate-400 mb-3 font-mono">
                Showing all real properties currently exposed by the loaded OnClickA SDK on <span className="text-blue-400">window.ocMan</span>.
              </p>
              <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 text-xs font-mono max-h-60 overflow-y-auto">
                <pre className="text-blue-300 whitespace-pre-wrap">
                  {JSON.stringify(ocManInspector, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Network request interceptor log */}
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Globe className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Intercepted Outgoing Ad Traffic</h2>
            </div>
            
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {interceptedRequests.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500 font-mono">
                  No outgoing ad request activity intercepted yet.
                </div>
              ) : (
                interceptedRequests.map((req) => (
                  <div key={req.id} className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono">
                    <div className="flex justify-between items-center mb-1">
                      <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded text-[10px] font-bold border border-blue-500/10">
                        {req.type}
                      </span>
                      <span className="text-slate-500 text-[10px]">{req.time}</span>
                    </div>
                    <div className="text-slate-300 break-all font-semibold mt-1">
                      {req.url}
                    </div>
                    <div className="mt-2 flex gap-4 text-[11px]">
                      <div>
                        <span className="text-slate-500">Method:</span> <span className="text-slate-300">{req.method || "GET"}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Status:</span>{" "}
                        <span className={req.status.includes("FAILED") || req.status.includes("Blocked") ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                          {req.status}
                        </span>
                      </div>
                    </div>
                    {req.responsePreview && (
                      <div className="mt-2 pt-2 border-t border-slate-900 text-[10px] text-slate-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
                        <span className="text-slate-500 font-semibold block mb-0.5">Response Preview:</span>
                        {req.responsePreview}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Right column: Active Ad Container and Event Console Logs */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Active Ad Stage */}
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <MapPin className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Render Stage</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Staging target centered for the OnClickA Inpage SDK. The ad code will dynamically inject elements inside this container once initialized.
            </p>

            <div className="relative bg-slate-950 border border-dashed border-slate-800 rounded-xl min-h-[250px] flex items-center justify-center p-4 overflow-hidden">
              <div 
                className="onclicka-ad-container my-2 min-h-[50px] w-full max-w-sm flex items-center justify-center text-xs text-slate-500 font-mono transition-all z-10"
                id="onclicka-inpage-ad-stage"
              >
                {/* SDK target */}
              </div>
              
              {/* Decorative grid */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:1rem_1rem] opacity-20"></div>
              
              <div className="absolute bottom-2 right-2 text-[9px] text-slate-600 font-mono">
                #onclicka-inpage-ad-stage
              </div>
            </div>
          </div>

          {/* Event and trace logs */}
          <div className="bg-slate-900/60 backdrop-blur-md rounded-xl border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <Terminal className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-white">Staging Diagnostic Log</h2>
            </div>
            
            <div className="bg-slate-950 rounded-lg p-3 font-mono text-[10px] border border-slate-800 h-96 overflow-y-auto space-y-1.5 select-text">
              {consoleLogs.length === 0 ? (
                <span className="text-slate-500">Awaiting events...</span>
              ) : (
                consoleLogs.map((log, i) => (
                  <div key={i} className="text-slate-300 leading-relaxed border-b border-slate-900/40 pb-1 last:border-0">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
