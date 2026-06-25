import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, AlertCircle, Info } from 'lucide-react';

const loadStylesheet = (url: string): Promise<void> => {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${url}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
};

const loadScript = (url: string): Promise<void> => {
  return new Promise((resolve) => {
    if (document.querySelector(`script[src="${url}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });
};

const waitForCondition = (conditionFn: () => boolean, maxWaitMs = 15000, pollIntervalMs = 50): Promise<boolean> => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (conditionFn()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startTime > maxWaitMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, pollIntervalMs);
  });
};

interface RewardVideoPlayerProps {
  scriptCode: string;
  onComplete: () => void;
}

export default function RewardVideoPlayer({ scriptCode, onComplete }: RewardVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  // Telemetry Diagnostics required by the user
  const [vastRequestSent, setVastRequestSent] = useState<'Yes' | 'No'>('No');
  const [vastResponseReceived, setVastResponseReceived] = useState<'Yes' | 'No'>('No');
  const [adStartedState, setAdStartedState] = useState<'Yes' | 'No'>('No');
  const [adCompletedState, setAdCompletedState] = useState<'Yes' | 'No'>('No');
  const [vastErrorMessage, setVastErrorMessage] = useState<string>('None');

  // Extract VAST URL - Use ONLY the VAST URL provided by the admin! NO fallback/demo!
  let savedVastUrl = "";
  if (scriptCode && scriptCode.trim().startsWith('http')) {
    savedVastUrl = scriptCode.trim();
  } else if (scriptCode) {
    const match = scriptCode.match(/https?:\/\/[^\s"']+/);
    if (match) {
      savedVastUrl = match[0];
    }
  }

  const addLog = (msg: string) => {
    console.log(`[RewardVideoPlayer] ${msg}`);
    setDebugLog(prev => [...prev.slice(-4), msg]);
  };

  const getImaErrorMessage = (event: any): string => {
    if (!event) return "Empty VAST response or Ad Loading Error";
    const adError = event.detail?.getError?.() || event.error?.getError?.() || event.data?.getError?.() || event.getError?.();
    if (adError) {
      const code = adError.getErrorCode();
      const message = adError.getMessage();
      return `AdError ${code}: ${message}`;
    }
    const message = event.message || event.error?.message || event.detail?.message;
    if (message) return message;
    return "VAST response empty or failed to load";
  };

  useEffect(() => {
    let isMounted = true;

    // Save references to original network and global handlers
    const originalFetch = window.fetch;
    const originalXhrOpen = XMLHttpRequest.prototype.open;

    // Diagnostic hook to intercept and log fetch requests
    window.fetch = function(...args) {
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.url || String(args[0] || '');
        if (isMounted && url) {
          addLog(`Fetch Request: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
        }
      } catch (err) {
        console.error("Fetch intercept error", err);
      }
      return originalFetch.apply(this, args);
    };

    // Diagnostic hook to intercept and log XHR requests
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      try {
        const urlStr = String(url || '');
        if (isMounted && urlStr) {
          addLog(`XHR Request: [${method}] ${urlStr.substring(0, 100)}${urlStr.length > 100 ? '...' : ''}`);
        }
      } catch (err) {
        console.error("XHR intercept error", err);
      }
      return originalXhrOpen.apply(this, [method, url, ...rest] as any);
    };

    // Global error handlers
    const handleErrorEvent = (event: ErrorEvent) => {
      if (isMounted) {
        addLog(`JS Global Error: ${event.message || 'Unknown message'} at ${event.filename || 'unknown'}:${event.lineno || 0}`);
      }
    };
    
    const handleRejectionEvent = (event: PromiseRejectionEvent) => {
      if (isMounted) {
        const reason = event.reason;
        const msg = reason ? (reason.message || String(reason)) : 'Unknown rejection';
        addLog(`Promise Rejected: ${msg}`);
      }
    };

    window.addEventListener('error', handleErrorEvent);
    window.addEventListener('unhandledrejection', handleRejectionEvent);

    if (!savedVastUrl) {
      setErrorMessage("No valid VAST URL provided by the administrator.");
      setVastErrorMessage("No VAST URL configured.");
      setLoading(false);
      return;
    }

    const initResources = async () => {
      try {
        addLog("Loading VideoJS Stylesheets...");
        await loadStylesheet("https://vjs.zencdn.net/8.10.0/video-js.css");
        await loadStylesheet("https://cdnjs.cloudflare.com/ajax/libs/videojs-contrib-ads/6.9.0/videojs-contrib-ads.css");
        await loadStylesheet("https://cdnjs.cloudflare.com/ajax/libs/videojs-ima/1.11.0/videojs-ima.css");

        if (!isMounted) return;

        addLog("Loading VideoJS Library...");
        await loadScript("https://vjs.zencdn.net/8.10.0/video.min.js");
        const videojsOk = await waitForCondition(() => (window as any).videojs !== undefined);
        console.log("VideoJS Loaded: " + (videojsOk ? "Yes" : "No"));
        addLog("VideoJS Loaded: " + (videojsOk ? "Yes" : "No"));
        if (!isMounted) return;

        addLog("Loading Google IMA SDK...");
        await loadScript("https://imasdk.googleapis.com/js/sdkloader/ima3.js");
        const googleImaOk = await waitForCondition(() => (window as any).google !== undefined && (window as any).google.ima !== undefined);
        console.log("Google IMA Loaded: " + (googleImaOk ? "Yes" : "No"));
        addLog("Google IMA Loaded: " + (googleImaOk ? "Yes" : "No"));
        if (!isMounted) return;

        addLog("Loading videojs-contrib-ads...");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/videojs-contrib-ads/6.9.0/videojs-contrib-ads.min.js");
        const contribAdsOk = await waitForCondition(() => {
          const vjs = (window as any).videojs;
          return vjs && (typeof vjs.prototype?.ads === 'function' || typeof vjs.fn?.ads === 'function');
        });
        console.log("Contrib Ads Loaded: " + (contribAdsOk ? "Yes" : "No"));
        addLog("Contrib Ads Loaded: " + (contribAdsOk ? "Yes" : "No"));
        if (!isMounted) return;

        addLog("Loading videojs-ima plugin...");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/videojs-ima/1.11.0/videojs-ima.min.js");
        const vjsImaOk = await waitForCondition(() => {
          const vjs = (window as any).videojs;
          return vjs && (typeof vjs.prototype?.ima === 'function' || typeof vjs.fn?.ima === 'function');
        });
        console.log("videojs-ima Loaded: " + (vjsImaOk ? "Yes" : "No"));
        addLog("videojs-ima Loaded: " + (vjsImaOk ? "Yes" : "No"));
        if (!isMounted) return;

        addLog("All external resources loaded.");
        setLoading(false);
        
        // Initialize player in next tick
        setTimeout(() => {
          if (isMounted) {
            setupPlayer();
          }
        }, 100);

      } catch (err: any) {
        console.error("Resource load error:", err);
        console.log("Exact Exception Stack:", err.stack || err);
        if (isMounted) {
          const msg = err.message || "Failed to load external player assets";
          setErrorMessage(msg);
          setVastErrorMessage(msg);
          setLoading(false);
        }
      }
    };

    initResources();

    return () => {
      isMounted = false;

      // Restore original handlers
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalXhrOpen;
      window.removeEventListener('error', handleErrorEvent);
      window.removeEventListener('unhandledrejection', handleRejectionEvent);

      if (playerRef.current) {
        try {
          addLog("Disposing player...");
          playerRef.current.dispose();
        } catch (e) {
          console.error("Player dispose error:", e);
        }
      }
    };
  }, [scriptCode]);

  const setupPlayer = async () => {
    const videojs = (window as any).videojs;
    const google = (window as any).google;

    // 1. Check window-level dependencies first
    const hasVideoJS = typeof videojs !== "undefined";
    const hasGoogle = typeof google !== "undefined";
    const hasImaSDK = hasGoogle && google.ima !== undefined;
    const hasContribAds = hasVideoJS && (typeof videojs.prototype?.ads === 'function' || typeof videojs.fn?.ads === 'function');
    const hasImaPlugin = hasVideoJS && (typeof videojs.prototype?.ima === 'function' || typeof videojs.fn?.ima === 'function');

    if (!hasVideoJS || !hasImaSDK || !hasContribAds || !hasImaPlugin) {
      addLog("Dependency check failed. Waiting and retrying in 200ms...");
      setTimeout(() => setupPlayer(), 200);
      return;
    }

    try {
      const playerElement = document.getElementById('reward-video-player');
      if (!playerElement) {
        addLog("Player DOM element not found, waiting and retrying in 200ms...");
        setTimeout(() => setupPlayer(), 200);
        return;
      }

      // Re-initialize player
      if (playerRef.current) {
        try {
          playerRef.current.dispose();
        } catch (e) {}
        playerRef.current = null;
      }

      const player = videojs('reward-video-player', {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: true,
        muted: false
      });

      playerRef.current = player;

      // 2. Wait until player is fully initialized and player.ima exists
      if (!player || typeof player.ima !== "function") {
        addLog("Player created but player.ima is missing, waiting and retrying in 200ms...");
        try {
          player.dispose();
        } catch(e) {}
        playerRef.current = null;
        setTimeout(() => setupPlayer(), 200);
        return;
      }

      // Prints as requested
      console.log("VideoJS Loaded: Yes");
      console.log("Google IMA Loaded: Yes");
      console.log("Contrib Ads Loaded: Yes");
      console.log("videojs-ima Loaded: Yes");
      console.log("Player Created: Yes");
      console.log("player.ima Exists: Yes");

      addLog("VideoJS Loaded: Yes");
      addLog("Google IMA Loaded: Yes");
      addLog("Contrib Ads Loaded: Yes");
      addLog("videojs-ima Loaded: Yes");
      addLog("Player Created: Yes");
      addLog("player.ima Exists: Yes");

      // Progress bar updates
      player.on('timeupdate', () => {
        const cur = player.currentTime();
        const dur = player.duration() || 15;
        setCurrentTime(Math.floor(cur));
        setDuration(Math.floor(dur));
        setProgress((cur / dur) * 100);
      });

      player.on('play', () => {
        setIsPlaying(true);
        setStarted(true);
      });

      player.on('pause', () => {
        setIsPlaying(false);
      });

      addLog("Configuring Google IMA plugin with VAST URL...");
      player.ima({
        adTagUrl: savedVastUrl
      });

      // Listen for ads manager loaded event
      player.on('ads-manager-loaded', () => {
        addLog("IMA Ads Manager loaded successfully.");
        setVastResponseReceived('Yes');
        console.log("VAST Response Received: Yes");
        setVastErrorMessage('None');
      });

      // Listen for IMA errors
      player.on('ads-loader-error', (event: any) => {
        const errorMsg = getImaErrorMessage(event);
        addLog(`IMA ads loader error: ${errorMsg}`);
        setVastResponseReceived('No');
        console.log("VAST Response Received: No");
        setVastErrorMessage(errorMsg);
        setErrorMessage(errorMsg);
      });

      player.on('aderror', (event: any) => {
        const errorMsg = getImaErrorMessage(event);
        addLog(`IMA ad playback error: ${errorMsg}`);
        setVastResponseReceived('No');
        console.log("VAST Response Received: No");
        setVastErrorMessage(errorMsg);
        setErrorMessage(errorMsg);
      });

      player.on('adstart', () => {
        addLog("IMA VAST Ad Started!");
        setAdStartedState('Yes');
        setIsPlaying(true);
        setStarted(true);
      });

      player.on('adplaying', () => {
        addLog("IMA VAST Ad Playing...");
        setIsPlaying(true);
      });

      player.on('adend', () => {
        addLog("IMA VAST Ad Completed successfully!");
        setAdCompletedState('Yes');
        handleAdComplete();
      });

    } catch (err: any) {
      console.error("Player setup error:", err);
      console.log("Exact Exception Stack:", err.stack || err);
      addLog(`Exact Exception Stack: ${err.stack || err}`);
      const msg = err.message || "Failed to initialize VideoJS player";
      setErrorMessage(msg);
      setVastErrorMessage(msg);
      // Wait and retry
      setTimeout(() => setupPlayer(), 1000);
    }
  };

  const handleStartPlay = () => {
    if (!playerRef.current) return;
    
    addLog(`User clicked Play. Requesting VAST Tag: ${savedVastUrl}`);
    setStarted(true);
    setIsPlaying(true);
    setVastRequestSent('Yes');
    console.log("VAST Request Sent");

    try {
      // IMA standard initialization call on user action
      if (playerRef.current.ima && (window as any).google?.ima) {
        playerRef.current.ima.initializeAdDisplayContainer();
        playerRef.current.ima.requestAds();
      } else {
        const msg = "IMA plugin not active or loaded.";
        setVastResponseReceived('No');
        setVastErrorMessage(msg);
        setErrorMessage(msg);
      }
    } catch (e: any) {
      console.warn("IMA init on interaction skipped:", e);
      const msg = e.message || String(e);
      setVastResponseReceived('No');
      setVastErrorMessage(msg);
      setErrorMessage(msg);
    }

    playerRef.current.play().catch((err: any) => {
      console.error("Play request rejected:", err);
    });
  };

  const handleAdComplete = () => {
    setCompleted(true);
    setIsPlaying(false);
    onComplete();
  };

  const handleRestart = () => {
    setCompleted(false);
    setStarted(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setProgress(0);
    setVastRequestSent('No');
    setVastResponseReceived('No');
    setAdStartedState('No');
    setAdCompletedState('No');
    setVastErrorMessage('None');
    setErrorMessage(null);
    
    setTimeout(() => {
      if (playerRef.current) {
        playerRef.current.currentTime(0);
      }
    }, 100);
  };

  return (
    <div className="w-full flex flex-col space-y-4">
      {/* Real Video Player Container */}
      <div className="aspect-video bg-black rounded-xl overflow-hidden relative border border-slate-800 shadow-lg flex items-center justify-center">
        {loading && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center space-y-3 z-30">
            <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-slate-400 font-mono">Initializing Real Player...</p>
          </div>
        )}

        {errorMessage && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center z-30 space-y-3">
            <AlertCircle size={36} className="text-red-500" />
            <p className="text-sm font-bold text-slate-200">VAST Video Load Error</p>
            <p className="text-xs text-red-400 font-mono break-all max-w-sm">{errorMessage}</p>
            <button 
              onClick={handleRestart}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
            >
              <RotateCcw size={12} /> Try Again
            </button>
          </div>
        )}

        {/* The Exact Video Element Required */}
        <div className={`w-full h-full ${loading || errorMessage ? 'hidden' : 'block'}`} data-vjs-player="true">
          <video 
            ref={videoRef}
            id="reward-video-player"
            className="video-js vjs-default-skin w-full h-full"
            controls
            playsInline
            preload="auto"
          />
        </div>

        {/* Beautiful Custom Start Overlay to meet Play target and bypass autoplay restrictions */}
        {!loading && !started && !completed && !errorMessage && (
          <div 
            onClick={handleStartPlay}
            className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center cursor-pointer p-6 text-center transition-all hover:bg-slate-950/70 z-20"
          >
            <div className="w-16 h-16 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105">
              <Play size={28} className="ml-1" />
            </div>
            <p className="text-base font-extrabold text-white mt-4 tracking-wide uppercase">Click to Play Sponsor's Ad</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">Loads external high-definition VAST video stream from AdCash</p>
          </div>
        )}

        {/* Video Completed Overlay */}
        {completed && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20">
            <div className="w-14 h-14 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg mb-3 font-bold text-xl">
              ✓
            </div>
            <p className="text-base font-extrabold text-emerald-400">Ad Completed successfully!</p>
            <p className="text-xs text-slate-300 mt-1">Sponsor rewards credited successfully. Claim your coins below.</p>
            <button 
              onClick={handleRestart}
              className="mt-4 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
            >
              <RotateCcw size={12} /> Watch Again
            </button>
          </div>
        )}
      </div>

      {/* Progress & Telemetry Section */}
      {!loading && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-slate-400 flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-amber-500 animate-pulse' : 'bg-slate-600'}`}></span>
              Video Progress:
            </span>
            <span className={completed ? 'text-emerald-400' : 'text-amber-400'}>
              {progress ? Math.floor(progress) : 0}% ({currentTime}s / {duration || 15}s)
            </span>
          </div>

          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
            <div 
              className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full transition-all duration-300 rounded-full" 
              style={{ width: `${progress || 0}%` }}
            ></div>
          </div>

          {/* Telemetry Diagnostics Required by User */}
          <div className="bg-slate-950 rounded-lg p-3 border border-slate-800/80 mt-1">
            <div className="text-[11px] font-extrabold text-slate-400 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Info size={12} className="text-amber-500" />
              <span>VAST Ad Telemetry Diagnostics</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">VAST Request Sent:</span>
                <span className={vastRequestSent === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-400 font-semibold'}>
                  {vastRequestSent}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">VAST Response Received:</span>
                <span className={vastResponseReceived === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-400 font-semibold'}>
                  {vastResponseReceived}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">Ad Started:</span>
                <span className={adStartedState === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-400 font-semibold'}>
                  {adStartedState}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1">
                <span className="text-slate-500">Ad Completed:</span>
                <span className={adCompletedState === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-400 font-semibold'}>
                  {adCompletedState}
                </span>
              </div>
              <div className="col-span-2 flex flex-col gap-1 pt-1">
                <span className="text-slate-500">Error Message:</span>
                <span className={`text-[11px] ${vastErrorMessage !== 'None' ? 'text-red-400 font-semibold break-all' : 'text-slate-400'}`}>
                  {vastErrorMessage}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
