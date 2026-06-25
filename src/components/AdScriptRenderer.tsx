import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX, AlertCircle, Info } from 'lucide-react';

// Helpers to load stylesheets and scripts dynamically
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
    script.onerror = () => resolve(); // Always resolve so we don't break the load chain, but we'll check validity
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

export default function AdScriptRenderer({ 
  scriptCode, 
  adType, 
  onStatusChange 
}: { 
  scriptCode: string, 
  adType?: string, 
  onStatusChange?: (status: 'Loaded' | 'Failed' | 'Pending', message?: string, diagnostics?: any) => void 
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerInstanceRef = useRef<any>(null);

  const isVastVideo = adType === 'VAST Video Ad' || adType === 'VAST Video' || (scriptCode && (scriptCode.toLowerCase().includes('vast') || scriptCode.toLowerCase().includes('xml') || scriptCode.toLowerCase().includes('video')));

  const isInterstitial = adType === 'Interstitial Ad' || adType === 'Interstitial' || (scriptCode && (scriptCode.toLowerCase().includes('aclib') || scriptCode.toLowerCase().includes('runinterstitial')));

  // Extract Zone ID from the script code
  let savedZoneId = "11511010";
  if (scriptCode) {
    if (/^\d+$/.test(scriptCode.trim())) {
      savedZoneId = scriptCode.trim();
    } else {
      const match = scriptCode.match(/zoneId\s*:\s*['"]?(\d+)['"]?/i);
      if (match) {
        savedZoneId = match[1];
      }
    }
  }

  // State for Interstitial
  const [interstitialStep, setInterstitialStep] = useState<'pending' | 'script-loaded' | 'ready' | 'running' | 'success' | 'failed'>('pending');
  const [interstitialError, setInterstitialError] = useState<string | null>(null);

  // States for manual test button click in the Admin Preview
  const [manualTestClicked, setManualTestClicked] = useState(false);
  const [manualLibraryLoaded, setManualLibraryLoaded] = useState<'Yes' | 'No'>('No');
  const [manualRunInterstitialCalled, setManualRunInterstitialCalled] = useState<'Yes' | 'No'>('No');
  const [manualError, setManualError] = useState<string | null>(null);

  const handleTestInterstitial = () => {
    setManualTestClicked(true);
    setManualError(null);
    try {
      const aclib = (window as any).aclib;
      
      // 1. Print requested details to console:
      console.log("window.aclib:", aclib);
      console.log("zoneId:", savedZoneId);
      console.log("typeof aclib.runInterstitial:", aclib ? typeof aclib.runInterstitial : "undefined");
      
      const isLoaded = aclib !== undefined;
      setManualLibraryLoaded(isLoaded ? 'Yes' : 'No');

      if (!isLoaded) {
        throw new Error("window.aclib is not loaded on the page. Please wait until the script is fully loaded.");
      }

      if (typeof aclib.runInterstitial !== 'function') {
        throw new Error("aclib.runInterstitial is not a function or not available on the aclib object.");
      }

      // 2. Execute
      aclib.runInterstitial({
        zoneId: savedZoneId
      });
      setManualRunInterstitialCalled('Yes');
      console.log("runInterstitial Executed");
      console.log("Result: Success");
    } catch (err: any) {
      console.error("Test Interstitial Error:", err);
      const errMsg = err.message || String(err);
      setManualError(errMsg);
      setManualRunInterstitialCalled('No');
      console.log("Result: Failed - " + errMsg);
    }
  };

  useEffect(() => {
    if (!isInterstitial) return;

    let isMounted = true;
    onStatusChange?.('Pending', 'Initializing AdCash Interstitial...', {
      libraryLoaded: (window as any).aclib !== undefined ? 'Yes' : 'No',
      aclibAvailable: (window as any).aclib !== undefined ? 'Yes' : 'No',
      runExecuted: 'No',
      zoneId: savedZoneId,
      result: 'Pending'
    });

    const runAdCashInterstitial = async () => {
      try {
        setInterstitialStep('pending');

        // Prevent duplicate execution for this Zone ID
        (window as any).__executedAdCashInterstitials = (window as any).__executedAdCashInterstitials || {};
        if ((window as any).__executedAdCashInterstitials[savedZoneId]) {
          console.log(`AdCash Interstitial for zone ${savedZoneId} has already been executed. Preventing duplicate run.`);
          if (isMounted) {
            setInterstitialStep('success');
            onStatusChange?.('Loaded', 'AdCash Interstitial loaded successfully (cached/duplicate prevented).', {
              libraryLoaded: 'Yes',
              aclibAvailable: 'Yes',
              runExecuted: 'Yes',
              zoneId: savedZoneId,
              result: 'Success'
            });
          }
          return;
        }
        
        // 1. Load the library ONLY ONCE inside <head>
        let script = document.getElementById('aclib') as HTMLScriptElement;
        if (!script) {
          script = document.createElement('script');
          script.id = 'aclib';
          script.type = 'text/javascript';
          script.src = '//acscdn.com/script/aclib.js';
          script.async = true;
          document.head.appendChild(script);
        }

        // Wait for script to load or resolve immediately if already available
        await new Promise<void>((resolve, reject) => {
          if ((window as any).aclib !== undefined) {
            resolve();
            return;
          }
          
          const handleLoad = () => {
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
            resolve();
          };
          
          const handleError = (err: any) => {
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
            reject(new Error("AdCash script loaded but failed or errored out"));
          };
          
          script.addEventListener('load', handleLoad);
          script.addEventListener('error', handleError);

          // Fallback if it was already loading/loaded but window.aclib wasn't populated yet
          const checkTimer = setInterval(() => {
            if ((window as any).aclib !== undefined) {
              clearInterval(checkTimer);
              script.removeEventListener('load', handleLoad);
              script.removeEventListener('error', handleError);
              resolve();
            }
          }, 100);

          // Clean up checkTimer after 15 seconds
          setTimeout(() => {
            clearInterval(checkTimer);
          }, 15000);
        });

        if (!isMounted) return;
        console.log("Library Script Loaded");
        setInterstitialStep('script-loaded');

        // 2. Wait until window.aclib !== undefined (with fallback timer if only as a fallback)
        if ((window as any).aclib === undefined) {
          let attempts = 0;
          const maxAttempts = 100; // 5 seconds
          while ((window as any).aclib === undefined && attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 50));
            attempts++;
            if (!isMounted) return;
          }
        }

        if ((window as any).aclib === undefined) {
          throw new Error("window.aclib is still undefined after loading the script");
        }

        console.log("window.aclib Available");
        setInterstitialStep('ready');

        // 3. Zone ID
        console.log("Zone ID:", savedZoneId);

        // 4. Execute runInterstitial
        const aclib = (window as any).aclib;
        if (aclib && typeof aclib.runInterstitial === 'function') {
          setInterstitialStep('running');
          
          // Mark as executed BEFORE calling to prevent race conditions
          (window as any).__executedAdCashInterstitials[savedZoneId] = true;

          aclib.runInterstitial({
            zoneId: savedZoneId
          });
          
          console.log("runInterstitial Executed");
          console.log("Result: Success");
          
          if (isMounted) {
            setInterstitialStep('success');
            onStatusChange?.('Loaded', 'AdCash Interstitial loaded successfully.', {
              libraryLoaded: 'Yes',
              aclibAvailable: 'Yes',
              runExecuted: 'Yes',
              zoneId: savedZoneId,
              result: 'Success'
            });
          }
        } else {
          throw new Error("aclib.runInterstitial function is not defined on window.aclib");
        }

      } catch (err: any) {
        console.error("AdCash Interstitial error:", err);
        if (isMounted) {
          const msg = err.message || "Failed to load/run AdCash Interstitial";
          setInterstitialError(msg);
          setInterstitialStep('failed');
          console.log("Result: Failed - " + msg);
          onStatusChange?.('Failed', msg, {
            libraryLoaded: (window as any).aclib !== undefined ? 'Yes' : 'No',
            aclibAvailable: (window as any).aclib !== undefined ? 'Yes' : 'No',
            runExecuted: 'No',
            zoneId: savedZoneId,
            result: 'Failed'
          });
        }
      }
    };

    runAdCashInterstitial();

    return () => {
      isMounted = false;
    };
  }, [scriptCode, isInterstitial, savedZoneId]);

  // Extract VAST URL from script code or fallback to a default test tag if empty/invalid
  let vastUrl = "";
  if (scriptCode && scriptCode.trim().startsWith('http')) {
    vastUrl = scriptCode.trim();
  } else if (scriptCode) {
    const match = scriptCode.match(/https?:\/\/[^\s"']+/);
    if (match) {
      vastUrl = match[0];
    }
  }

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(15);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<'loaded' | 'playing' | 'started' | 'completed' | null>(null);
  const [statusText, setStatusText] = useState<'Loading Video Ad...' | '🟢 Video Loaded' | '🟢 Video Playing' | '🟢 Ad Started' | '🟢 Ad Completed' | 'No video ad available at this time.'>('Loading Video Ad...');
  const [noAdAvailable, setNoAdAvailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Diagnostic events log and waiting for interaction states
  const [diagnosticEvents, setDiagnosticEvents] = useState<{name: string, time: string}[]>([]);
  const [waitingForInteraction, setWaitingForInteraction] = useState(true);

  const addDiagnosticEvent = (name: string) => {
    const time = new Date().toLocaleTimeString();
    setDiagnosticEvents((prev) => [...prev, { name, time }]);
  };

  // Telemetry Diagnostics required by the user
  const [vastRequestSent, setVastRequestSent] = useState<'Yes' | 'No'>('No');
  const [vastResponseReceived, setVastResponseReceived] = useState<'Yes' | 'No'>('No');
  const [adStartedState, setAdStartedState] = useState<'Yes' | 'No'>('No');
  const [adCompletedState, setAdCompletedState] = useState<'Yes' | 'No'>('No');
  const [vastErrorMessage, setVastErrorMessage] = useState<string>('None');

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

  // Standard Banner Script Code Execution (keeps existing banner function unchanged)
  useEffect(() => {
    if (isVastVideo || isInterstitial) return;
    if (!scriptCode || !iframeRef.current) return;
    
    const iframe = iframeRef.current;
    let isCancelled = false;

    onStatusChange?.('Pending', 'Waiting for script execution...', { 
      scriptInjected: 'Yes', 
      iframeCreated: 'Yes', 
      contentRendered: 'No', 
      containerHeight: 0, 
      containerWidth: 0, 
      domElementsCreated: 0 
    });

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      onStatusChange?.('Failed', 'Could not access iframe document');
      return;
    }

    try {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; overflow: hidden; background: transparent; color: white; }
            </style>
          </head>
          <body>
            ${scriptCode}
          </body>
        </html>
      `);
      doc.close();
    } catch (e: any) {
      onStatusChange?.('Failed', e.message || 'Error writing to iframe', {
        scriptInjected: 'No',
        iframeCreated: 'Yes',
        contentRendered: 'No'
      });
      return;
    }

    let checks = 0;
    const initialElements = doc.querySelectorAll('*').length;
    
    const checkTimer = setInterval(() => {
      if (isCancelled) return;
      
      checks++;
      const innerIframes = doc.querySelectorAll('iframe');
      const allElements = doc.querySelectorAll('*').length;
      
      const hasVisibleContent = innerIframes.length > 0 || (allElements > initialElements + 2);
      
      const diagnostics = {
        scriptInjected: 'Yes',
        iframeCreated: 'Yes',
        contentRendered: hasVisibleContent ? 'Yes' : 'No',
        containerHeight: doc.body?.scrollHeight || 0,
        containerWidth: doc.body?.scrollWidth || 0,
        domElementsCreated: allElements
      };

      if (hasVisibleContent) {
        clearInterval(checkTimer);
        onStatusChange?.('Loaded', '', diagnostics);
      } else if (checks >= 20) { // 10 seconds timeout
        clearInterval(checkTimer);
        onStatusChange?.('Failed', 'No Ad Content Returned', diagnostics);
      } else {
        onStatusChange?.('Pending', 'Rendering...', diagnostics);
      }
    }, 500);

    return () => {
      isCancelled = true;
      clearInterval(checkTimer);
    };
  }, [scriptCode, isVastVideo]);

  // VAST Player initialization and Script Loader Logic
  useEffect(() => {
    if (!isVastVideo) return;

    let isMounted = true;

    // Save references to original network and global handlers
    const originalFetch = window.fetch;
    const originalXhrOpen = XMLHttpRequest.prototype.open;

    // Diagnostic hook to intercept and log fetch requests
    window.fetch = function(...args) {
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.url || String(args[0] || '');
        if (isMounted && url) {
          addDiagnosticEvent(`Fetch Request: ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
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
          addDiagnosticEvent(`XHR Request: [${method}] ${urlStr.substring(0, 100)}${urlStr.length > 100 ? '...' : ''}`);
        }
      } catch (err) {
        console.error("XHR intercept error", err);
      }
      return originalXhrOpen.apply(this, [method, url, ...rest] as any);
    };

    // Global error handlers
    const handleErrorEvent = (event: ErrorEvent) => {
      if (isMounted) {
        addDiagnosticEvent(`JS Global Error: ${event.message || 'Unknown message'} at ${event.filename || 'unknown'}:${event.lineno || 0}`);
      }
    };
    
    const handleRejectionEvent = (event: PromiseRejectionEvent) => {
      if (isMounted) {
        const reason = event.reason;
        const msg = reason ? (reason.message || String(reason)) : 'Unknown rejection';
        addDiagnosticEvent(`Promise Rejected: ${msg}`);
      }
    };

    window.addEventListener('error', handleErrorEvent);
    window.addEventListener('unhandledrejection', handleRejectionEvent);

    onStatusChange?.('Pending', 'Loading Video Ad...');
    setStatusText('Loading Video Ad...');

    if (!scriptCode || scriptCode.trim() === '') {
      setNoAdAvailable(true);
      setStatusText('No video ad available at this time.');
      onStatusChange?.('Failed', 'No video ad available at this time.');
      setVastErrorMessage("VAST script input is empty.");
      setErrorMessage("VAST script input is empty.");
      return;
    }

    if (!vastUrl) {
      setNoAdAvailable(true);
      setStatusText('No video ad available at this time.');
      onStatusChange?.('Failed', 'No valid VAST URL provided.');
      setVastErrorMessage("No VAST URL configured.");
      setErrorMessage("No valid VAST URL configured.");
      return;
    }

    const loadResourcesAndInit = async () => {
      try {
        addDiagnosticEvent("Loading stylesheet video-js.css...");
        await loadStylesheet("https://vjs.zencdn.net/8.10.0/video-js.css");
        
        addDiagnosticEvent("Loading stylesheet videojs-contrib-ads.css...");
        await loadStylesheet("https://cdnjs.cloudflare.com/ajax/libs/videojs-contrib-ads/6.9.0/videojs-contrib-ads.css");
        
        addDiagnosticEvent("Loading stylesheet videojs-ima.css...");
        await loadStylesheet("https://cdnjs.cloudflare.com/ajax/libs/videojs-ima/1.11.0/videojs-ima.css");

        if (!isMounted) return;

        // Step 1: Load Video.js
        addDiagnosticEvent("Loading video.min.js library...");
        await loadScript("https://vjs.zencdn.net/8.10.0/video.min.js");
        const videojsOk = await waitForCondition(() => (window as any).videojs !== undefined);
        if (!videojsOk) {
          throw new Error("Video.js library (video.min.js) failed to load. Check your network or CDN status.");
        }
        addDiagnosticEvent("Video.js loaded successfully.");
        if (!isMounted) return;

        // Load IMA SDK
        addDiagnosticEvent("Loading Google IMA3 SDK...");
        await loadScript("https://imasdk.googleapis.com/js/sdkloader/ima3.js");
        const googleImaOk = await waitForCondition(() => (window as any).google !== undefined && (window as any).google.ima !== undefined);
        if (!googleImaOk) {
          throw new Error("Google IMA SDK (ima3.js) failed to load. If you are using an ad-blocker, please disable it to run VAST ads.");
        }
        addDiagnosticEvent("Google IMA SDK loaded successfully.");
        if (!isMounted) return;

        // Step 2: Load videojs-contrib-ads
        addDiagnosticEvent("Loading videojs-contrib-ads plugin...");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/videojs-contrib-ads/6.9.0/videojs-contrib-ads.min.js");
        const contribAdsOk = await waitForCondition(() => {
          const vjs = (window as any).videojs;
          return vjs && (typeof vjs.prototype?.ads === 'function' || typeof vjs.fn?.ads === 'function');
        });
        if (!contribAdsOk) {
          throw new Error("videojs-contrib-ads.min.js plugin failed to load or integrate with Video.js.");
        }
        addDiagnosticEvent("videojs-contrib-ads loaded successfully.");
        if (!isMounted) return;
        
        // Step 3: Load videojs-ima
        addDiagnosticEvent("Loading videojs-ima plugin...");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/videojs-ima/1.11.0/videojs-ima.min.js");
        const vjsImaOk = await waitForCondition(() => {
          const vjs = (window as any).videojs;
          return vjs && (typeof vjs.prototype?.ima === 'function' || typeof vjs.fn?.ima === 'function');
        });
        if (!vjsImaOk) {
          throw new Error("videojs-ima.min.js plugin failed to load or integrate with Video.js.");
        }
        addDiagnosticEvent("videojs-ima loaded successfully.");
        if (!isMounted) return;

        // Step 4: Wait until ALL libraries are fully loaded. Then setup player.
        addDiagnosticEvent("All libraries fully loaded. Preparing player...");
        setupActualPlayer();
      } catch (err: any) {
        console.error("Failed to load videojs or Google IMA library:", err);
        console.log("Exact Exception Stack:", err.stack || err);
        if (isMounted) {
          const msg = err.message || "Failed to load external dependencies";
          setVastErrorMessage(msg);
          setErrorMessage(msg);
          setStatusText('No video ad available at this time.');
          addDiagnosticEvent(`Failure: ${msg}`);
          onStatusChange?.('Failed', msg);
        }
      }
    };

    loadResourcesAndInit();

    return () => {
      isMounted = false;
      
      // Restore original handlers
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalXhrOpen;
      window.removeEventListener('error', handleErrorEvent);
      window.removeEventListener('unhandledrejection', handleRejectionEvent);

      if (playerInstanceRef.current) {
        try {
          playerInstanceRef.current.dispose();
        } catch (e) {
          console.error("Error disposing VideoJS player:", e);
        }
      }
    };
  }, [scriptCode, isVastVideo]);

  const setupActualPlayer = async () => {
    const videojs = (window as any).videojs;
    const google = (window as any).google;

    // Double check window-level dependencies
    const hasVideoJS = typeof videojs !== "undefined";
    const hasGoogle = typeof google !== "undefined";
    const hasImaSDK = hasGoogle && google.ima !== undefined;
    const hasContribAds = hasVideoJS && (typeof videojs.prototype?.ads === 'function' || typeof videojs.fn?.ads === 'function');
    const hasImaPlugin = hasVideoJS && (typeof videojs.prototype?.ima === 'function' || typeof videojs.fn?.ima === 'function');

    if (!hasVideoJS || !hasImaSDK || !hasContribAds || !hasImaPlugin) {
      console.log("AdScriptRenderer: Dependency double-check failed, retrying in 200ms...");
      setTimeout(() => setupActualPlayer(), 200);
      return;
    }

    try {
      const playerElement = document.getElementById('vast-player');
      if (!playerElement) {
        console.log("AdScriptRenderer: vast-player element not found, retrying in 200ms...");
        setTimeout(() => setupActualPlayer(), 200); // Retry mounting
        return;
      }

      // Re-initialize player if existing
      if (playerInstanceRef.current) {
        try {
          playerInstanceRef.current.dispose();
        } catch (e) {}
        playerInstanceRef.current = null;
      }

      addDiagnosticEvent("Creating VideoJS player...");

      // Initialize VideoJS Player with NO fallback contents/sample videos
      const player = videojs('vast-player', {
        controls: true,
        autoplay: true,
        preload: 'auto',
        fluid: true,
        muted: isMuted
      });

      playerInstanceRef.current = player;

      if (!player || typeof player.ima !== "function") {
        console.log("AdScriptRenderer: Player created but player.ima is missing, waiting and retrying in 200ms...");
        try {
          player.dispose();
        } catch(e) {}
        playerInstanceRef.current = null;
        setTimeout(() => setupActualPlayer(), 200);
        return;
      }

      addDiagnosticEvent("VideoJS player created successfully.");

      // Set up IMA plugin with savedVastUrl
      addDiagnosticEvent("Calling player.ima() with VAST URL...");
      const savedVastUrl = vastUrl;
      try {
        player.ima({
          adTagUrl: savedVastUrl
        });
        addDiagnosticEvent("player.ima() initialized.");
      } catch (imaErr: any) {
        console.error("player.ima() execution exception:", imaErr);
        const excMsg = `player.ima() Exception: ${imaErr.message || String(imaErr)}`;
        setErrorMessage(excMsg);
        setVastErrorMessage(excMsg);
        addDiagnosticEvent(`Exception: ${excMsg}`);
        throw imaErr; // stops further setup
      }

      // Register the requested events to listen and display in the diagnostics panel
      const eventsToListen = [
        'adsready',
        'adstart',
        'adend',
        'adskip',
        'adtimeout',
        'adserror',
        'loadedmetadata',
        'playing',
        'ended',
        'error'
      ];

      eventsToListen.forEach(evt => {
        player.on(evt, (e: any) => {
          let detail = "";
          if (evt === 'adserror' || evt === 'aderror') {
            const adError = e?.detail?.getError?.() || e?.error?.getError?.() || e?.getError?.();
            if (adError) {
              detail = ` (Error ${adError.getErrorCode()}: ${adError.getMessage()})`;
            }
          } else if (evt === 'error') {
            const pError = player.error();
            if (pError) {
              detail = ` (Code ${pError.code}: ${pError.message})`;
            }
          }
          
          addDiagnosticEvent(`Event Fired: ${evt}${detail}`);
          console.log(`VAST Event Captured: ${evt}`, e);

          // Update UI states based on events
          if (evt === 'adstart') {
            setStep('started');
            setIsPlaying(true);
            setAdStartedState('Yes');
            setStatusText('🟢 Ad Started');
            onStatusChange?.('Pending', '🟢 Ad Started', { adStarted: 'Yes', adCompleted: 'No' });
          } else if (evt === 'playing') {
            setStep('playing');
            setIsPlaying(true);
            setStatusText('🟢 Video Playing');
            onStatusChange?.('Pending', '🟢 Video Playing', { adStarted: 'Yes', adCompleted: 'No' });
          } else if (evt === 'adend' || evt === 'ended') {
            setStep('completed');
            setIsPlaying(false);
            setAdCompletedState('Yes');
            setStatusText('🟢 Ad Completed');
            onStatusChange?.('Loaded', '🟢 Ad Completed', { adStarted: 'Yes', adCompleted: 'Yes' });
          } else if (evt === 'adserror' || evt === 'error') {
            const errDetail = e ? (e.message || JSON.stringify(e)) : "Unknown Player Error";
            setVastErrorMessage(errDetail);
            setErrorMessage(errDetail);
          }
        });
      });

      // Special events on IMA plugins:
      player.on('ads-manager-loaded', () => {
        addDiagnosticEvent("IMA Ads Manager loaded.");
        setVastResponseReceived('Yes');
        setVastErrorMessage('None');
      });

      player.on('ads-loader-error', (event: any) => {
        const errorMsg = getImaErrorMessage(event);
        addDiagnosticEvent(`Ads Loader Error: ${errorMsg}`);
        setVastResponseReceived('No');
        setVastErrorMessage(errorMsg);
        setErrorMessage(errorMsg);
        setNoAdAvailable(true);
        setStatusText('No video ad available at this time.');
        onStatusChange?.('Failed', errorMsg);
      });

      player.on('aderror', (event: any) => {
        const errorMsg = getImaErrorMessage(event);
        addDiagnosticEvent(`Ad Error: ${errorMsg}`);
        setVastResponseReceived('No');
        setVastErrorMessage(errorMsg);
        setErrorMessage(errorMsg);
        setStatusText('No video ad available at this time.');
        onStatusChange?.('Failed', errorMsg);
      });

      // 7. Automatically call player.ima.initializeAdDisplayContainer() after first user interaction.
      // 8. Trigger player.play().
      let initializedContainer = false;
      const initContainerOnInteraction = () => {
        if (initializedContainer) return;
        initializedContainer = true;
        setWaitingForInteraction(false);
        
        console.log("First user interaction detected. Initializing container & triggering play...");
        addDiagnosticEvent("User Interaction: Initializing IMA container");
        
        try {
          if (player && player.ima && typeof player.ima.initializeAdDisplayContainer === 'function') {
            player.ima.initializeAdDisplayContainer();
          }
          if (player && typeof player.play === 'function') {
            player.play();
          }
        } catch (err: any) {
          console.error("Error during interaction initialization / play:", err);
          addDiagnosticEvent(`Interaction exception: ${err.message || String(err)}`);
        }
      };

      // Register interaction handlers on window
      window.addEventListener('click', initContainerOnInteraction, { once: true });
      window.addEventListener('touchstart', initContainerOnInteraction, { once: true });
      window.addEventListener('keydown', initContainerOnInteraction, { once: true });

      // Trigger initial loading states
      setStatusText('🟢 Video Loaded');
      setVastRequestSent('Yes');
      onStatusChange?.('Pending', '🟢 Video Loaded', { adStarted: 'No', adCompleted: 'No' });

      // Request ads
      addDiagnosticEvent("Requesting VAST ads...");
      player.ima.requestAds();

    } catch (err: any) {
      console.error("Player setup error:", err);
      console.log("Exact Exception Stack:", err.stack || err);
      const msg = err.message || "Failed to initialize VideoJS player";
      setErrorMessage(msg);
      setVastErrorMessage(msg);
      addDiagnosticEvent(`Setup Error: ${msg}`);
      setStatusText('No video ad available at this time.');
      onStatusChange?.('Failed', msg);
    }
  };

  if (isVastVideo) {
    return (
      <div id="vast-video-validation-wrapper" className="w-full max-w-xl bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-4 flex flex-col space-y-4">
        {/* Main Video Element Section */}
        <div className="aspect-video bg-black rounded-xl relative group flex items-center justify-center overflow-hidden border border-slate-800">
          {errorMessage && (
            <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center z-30 space-y-2">
              <AlertCircle size={32} className="text-red-500" />
              <p className="text-sm font-bold text-slate-200">VAST Video Load Error</p>
              <p className="text-xs text-red-400 font-mono break-all max-w-sm">{errorMessage}</p>
            </div>
          )}

          {waitingForInteraction && !errorMessage && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20 cursor-pointer animate-pulse">
              <Play size={40} className="text-blue-500 fill-blue-500/20 mb-2" />
              <p className="text-sm font-bold text-slate-100">Tap / Click anywhere to play Ad</p>
              <p className="text-[10px] text-slate-400 mt-1 font-mono">Autoplay policy requires first user interaction</p>
            </div>
          )}

          <div className={`w-full h-full ${errorMessage ? 'hidden' : ''}`} data-vjs-player="true">
            <video 
              id="vast-player" 
              className="video-js vjs-default-skin vjs-big-play-centered w-full h-full" 
              controls 
              playsInline
              preload="auto"
            />
          </div>
        </div>

        {/* Real-time Status Panel */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3">
          <div className="text-xs font-bold text-slate-400 mb-2.5 flex items-center justify-between">
            <span>Video Player Validation Status</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-extrabold ${noAdAvailable ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
              {noAdAvailable ? 'BLOCKED/EMPTY' : 'LIVE'}
            </span>
          </div>
          
          {noAdAvailable ? (
            <div className="p-3 bg-red-950/20 rounded-lg border border-red-900/30 text-red-400 font-semibold text-xs flex items-center gap-2">
              <AlertCircle size={16} />
              <span>No video ad available at this time.</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
                <span className={step !== null ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                  {step !== null ? '🟢' : '⚫'}
                </span>
                <span className={step !== null ? 'text-slate-200' : 'text-slate-500'}>Video Loaded</span>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
                <span className={(step === 'playing' || step === 'started' || step === 'completed') ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                  {(step === 'playing' || step === 'started' || step === 'completed') ? '🟢' : '⚫'}
                </span>
                <span className={(step === 'playing' || step === 'started' || step === 'completed') ? 'text-slate-200' : 'text-slate-500'}>Video Playing</span>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
                <span className={(step === 'started' || step === 'completed') ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                  {(step === 'started' || step === 'completed') ? '🟢' : '⚫'}
                </span>
                <span className={(step === 'started' || step === 'completed') ? 'text-slate-200' : 'text-slate-500'}>Ad Started</span>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
                <span className={step === 'completed' ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                  {step === 'completed' ? '🟢' : '⚫'}
                </span>
                <span className={step === 'completed' ? 'text-slate-200' : 'text-slate-500'}>Ad Completed</span>
              </div>
            </div>
          )}
        </div>

        {/* Telemetry Diagnostics Panel with requested keys */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3">
          <div className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1">
            <Info size={13} className="text-blue-400" />
            <span>VAST Diagnostics Debugger</span>
          </div>
          <div className="space-y-1.5 text-[10px] font-mono text-slate-300">
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">VAST URL Loaded:</span>
              <span className="text-blue-400 truncate max-w-[240px]" title={vastUrl}>{vastUrl || "None"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">VAST Request Sent:</span>
              <span className={vastRequestSent === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {vastRequestSent}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">VAST Response Received:</span>
              <span className={vastResponseReceived === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {vastResponseReceived}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Ad Started:</span>
              <span className={adStartedState === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {adStartedState}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Ad Completed:</span>
              <span className={adCompletedState === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {adCompletedState}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1 text-red-400">
              <span className="text-slate-400">Error Message:</span>
              <span className="truncate max-w-[240px]" title={vastErrorMessage}>{vastErrorMessage}</span>
            </div>

            {/* Diagnostic Events Log - Displays every event inside the diagnostics panel */}
            <div className="mt-3 border-t border-slate-800 pt-2">
              <span className="text-slate-400 block mb-1">Captured Event Log:</span>
              <div className="max-h-24 overflow-y-auto bg-slate-950/60 p-2 rounded border border-slate-800/80 space-y-1">
                {diagnosticEvents.length === 0 ? (
                  <div className="text-slate-600 italic text-[9px]">No events received yet...</div>
                ) : (
                  diagnosticEvents.map((evt, idx) => (
                    <div key={idx} className="flex justify-between text-[9px] text-slate-300 font-mono">
                      <span className="text-blue-400 truncate max-w-[200px]" title={evt.name}>{evt.name}</span>
                      <span className="text-slate-500 shrink-0">{evt.time}</span>
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

  if (isInterstitial) {
    return (
      <div id="adcash-interstitial-validation-wrapper" className="w-full max-w-xl bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl p-4 flex flex-col space-y-4 text-left">
        {/* Status Indicator Banner */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-3 min-h-[140px]">
          <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center border border-blue-500/20">
            <Info size={24} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-200">AdCash Interstitial Ad Slot</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs font-mono">
              Zone ID: {savedZoneId || "None"}
            </p>
          </div>
        </div>

        {/* Real-time Status Panel */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3">
          <div className="text-xs font-bold text-slate-400 mb-2.5 flex items-center justify-between">
            <span>Interstitial Validation Status</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-extrabold ${interstitialStep === 'failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
              {interstitialStep === 'failed' ? 'ERROR' : 'ACTIVE'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
              <span className={(interstitialStep !== 'pending') ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                {(interstitialStep !== 'pending') ? '🟢' : '⚫'}
              </span>
              <span className={(interstitialStep !== 'pending') ? 'text-slate-200' : 'text-slate-500'}>Script Loaded</span>
            </div>
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
              <span className={(interstitialStep === 'ready' || interstitialStep === 'running' || interstitialStep === 'success') ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                {(interstitialStep === 'ready' || interstitialStep === 'running' || interstitialStep === 'success') ? '🟢' : '⚫'}
              </span>
              <span className={(interstitialStep === 'ready' || interstitialStep === 'running' || interstitialStep === 'success') ? 'text-slate-200' : 'text-slate-500'}>aclib Available</span>
            </div>
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
              <span className={(interstitialStep === 'running' || interstitialStep === 'success') ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                {(interstitialStep === 'running' || interstitialStep === 'success') ? '🟢' : '⚫'}
              </span>
              <span className={(interstitialStep === 'running' || interstitialStep === 'success') ? 'text-slate-200' : 'text-slate-500'}>runInterstitial</span>
            </div>
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/40 rounded-lg">
              <span className={interstitialStep === 'success' ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                {interstitialStep === 'success' ? '🟢' : '⚫'}
              </span>
              <span className={interstitialStep === 'success' ? 'text-slate-200' : 'text-slate-500'}>Result: Success</span>
            </div>
          </div>
        </div>

        {/* Telemetry Diagnostics Panel */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3">
          <div className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1">
            <Info size={13} className="text-blue-400" />
            <span>AdCash Interstitial Diagnostics Debugger</span>
          </div>
          <div className="space-y-1.5 text-[10px] font-mono text-slate-300">
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Library Loaded</span>
              <span className={interstitialStep !== 'pending' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {interstitialStep !== 'pending' ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">window.aclib Available</span>
              <span className={(interstitialStep === 'ready' || interstitialStep === 'running' || interstitialStep === 'success') ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {(interstitialStep === 'ready' || interstitialStep === 'running' || interstitialStep === 'success') ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">Zone ID</span>
              <span className="text-emerald-400 font-bold">{savedZoneId || 'None'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
              <span className="text-slate-400">runInterstitial Executed</span>
              <span className={(interstitialStep === 'running' || interstitialStep === 'success') ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                {(interstitialStep === 'running' || interstitialStep === 'success') ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between text-slate-300 pt-0.5">
              <span className="text-slate-400 font-bold">Result:</span>
              <span className={interstitialStep === 'success' ? 'text-emerald-400 font-bold' : (interstitialStep === 'failed' ? 'text-red-400 font-bold font-extrabold' : 'text-yellow-400 font-bold')}>
                {interstitialStep === 'success' ? 'Success' : (interstitialStep === 'failed' ? 'Failed' : 'Pending')}
              </span>
            </div>
            {interstitialStep === 'failed' && (
              <div className="flex justify-between text-red-400 pt-1 border-t border-slate-800/60">
                <span className="text-slate-400">Error Message:</span>
                <span className="truncate max-w-[240px] font-bold text-red-400" title={interstitialError || "Unknown Error"}>{interstitialError || "Unknown Error"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Manual Interactive Tester */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-3 flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-300">Manual Interactive Tester</span>
              <span className="text-[10px] text-slate-500 font-mono">Verify runtime aclib methods</span>
            </div>
            <button
              onClick={handleTestInterstitial}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-semibold text-xs rounded-lg transition-all shadow-md shadow-blue-900/30 flex items-center gap-1.5"
            >
              <Play size={12} /> Test Interstitial
            </button>
          </div>

          {manualTestClicked && (
            <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800 text-xs font-mono space-y-1.5 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Library Loaded</span>
                <span className={manualLibraryLoaded === 'Yes' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  {manualLibraryLoaded}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">window.aclib Available</span>
                <span className={manualLibraryLoaded === 'Yes' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  {manualLibraryLoaded}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Zone ID</span>
                <span className="text-emerald-400 font-bold">
                  {savedZoneId || 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">runInterstitial Executed</span>
                <span className={manualRunInterstitialCalled === 'Yes' ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                  {manualRunInterstitialCalled}
                </span>
              </div>
              <div className="flex justify-between pt-0.5 border-t border-slate-800">
                <span className="text-slate-400 font-bold">Result:</span>
                <span className={manualRunInterstitialCalled === 'Yes' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold font-extrabold'}>
                  {manualRunInterstitialCalled === 'Yes' ? 'Success' : 'Failed'}
                </span>
              </div>
              {manualError && (
                <div className="text-red-400 mt-1 pt-1 border-t border-slate-800 flex flex-col">
                  <span className="text-slate-400 text-[10px] font-bold">Error Message:</span>
                  <span className="break-all whitespace-pre-wrap text-[11px] leading-relaxed mt-0.5 font-bold text-red-400">{manualError}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <iframe 
      ref={iframeRef} 
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-forms"
      className="w-full h-full min-h-[90px] flex flex-col items-center justify-center overflow-hidden border-none bg-transparent" 
    />
  );
}
