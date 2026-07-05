import React, { useEffect, useState, useRef } from "react";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface OnClickAAdProps {
  pageName: string;
  isDailyBonusScratchActive?: boolean;
}

// List of pages where ads are explicitly allowed
const ALLOWED_PAGES = [
  "shortener",
  "download",
  "human-verification",
  "dashboard",
  "home",
  "balance",
  "my-content",
  "my-links",
  "refer",
  "referral",
  "announcements",
  "settings",
  "daily-bonus",
  "profile"
];

// List of pages where ads are strictly forbidden
const FORBIDDEN_PAGES = [
  "earn-rewards",
  "rewards",
  "reward-tasks",
  "tasks",
  "video-rewards",
  "upload",
  "login",
  "register",
  "admin"
];

export const OnClickAAd: React.FC<OnClickAAdProps> = ({ pageName, isDailyBonusScratchActive = false }) => {
  const [adSettings, setAdSettings] = useState<{ enabled: boolean; verified: boolean; script: string } | null>(null);
  
  // Track events printed for the current page session
  const loggedEvents = useRef<Set<string>>(new Set());

  // Determine if we should show the ad on this page based on static rules
  const isAllowed = ALLOWED_PAGES.includes(pageName.toLowerCase()) && 
                    !FORBIDDEN_PAGES.includes(pageName.toLowerCase()) &&
                    !(pageName.toLowerCase() === "daily-bonus" && isDailyBonusScratchActive);

  const logEventOnce = (event: string) => {
    if (!loggedEvents.current.has(event)) {
      console.log(event);
      loggedEvents.current.add(event);
    }
  };

  // Fetch centralized ad settings
  useEffect(() => {
    let active = true;
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, "settings", "advertisement");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && active) {
          const data = docSnap.data();
          setAdSettings({
            enabled: data.enabled ?? false,
            verified: data.verified ?? false,
            script: data.script || ""
          });
        } else if (active) {
          setAdSettings({ enabled: false, verified: false, script: "" });
        }
      } catch (err) {
        console.error("[OnClickA] Error loading settings:", err);
        if (active) {
          setAdSettings({ enabled: false, verified: false, script: "" });
        }
      }
    };

    fetchSettings();
    return () => {
      active = false;
    };
  }, [pageName]);

  // Monitor ad loading and rendering status on allowed pages
  useEffect(() => {
    // Reset logged events whenever page changes
    loggedEvents.current.clear();

    if (!isAllowed) {
      logEventOnce("Blocked");
      document.body.classList.add("ads-blocked");
      return;
    }

    if (adSettings) {
      const { enabled, verified } = adSettings;
      if (!enabled || !verified) {
        logEventOnce("Blocked");
        document.body.classList.add("ads-blocked");
        return;
      }
    }

    // Since the page is allowed, remove the body class to display the ads
    document.body.classList.remove("ads-blocked");

    // Check script load status
    const isScriptPresent = !!document.head.querySelector('script[src*="onclicka"]') || 
                            !!document.head.querySelector('script[src*="onclckmn"]') ||
                            !!(window as any).__onclickaScriptLoaded ||
                            !!(window as any).ocMan ||
                            !!(window as any).a3klsam;

    if (!isScriptPresent && adSettings) {
      // If script failed to load or is missing, consider it blocked/failed
      const checkTimeout = setTimeout(() => {
        if (!document.head.querySelector('script[src*="onclicka"]') && 
            !document.head.querySelector('script[src*="onclckmn"]') &&
            !(window as any).ocMan &&
            !(window as any).a3klsam) {
          logEventOnce("Blocked");
        }
      }, 2000);
      return () => clearTimeout(checkTimeout);
    }

    // Monitor resource timing and DOM elements
    let checkCount = 0;
    const maxChecks = 12; // Check for up to 6 seconds (500ms intervals)
    
    const monitorInterval = setInterval(() => {
      checkCount++;

      // 1. Script loaded & SDK initialized
      const scriptFound = !!document.head.querySelector('script[src*="onclicka"]') || 
                          !!document.head.querySelector('script[src*="onclckmn"]') ||
                          (window as any).__onclickaScriptLoaded;

      const sdkFound = !!(window as any).ocMan || 
                       !!(window as any).a3klsam || 
                       !!(window as any).wa || 
                       !!(window as any).onclicka || 
                       !!(window as any).OnClickA;

      if (scriptFound) {
        logEventOnce("Script loaded");
      }
      if (sdkFound) {
        logEventOnce("SDK initialized");
      }

      // 2. Ad request sent
      try {
        const resources = window.performance.getEntriesByType("resource") as any[];
        const hasAdRequest = resources.some(r => 
          (r.name.includes("onclicka") || r.name.includes("clickadu") || r.name.includes("onclickmn") || r.name.includes("groleeguls") || r.name.includes("wa-")) &&
          !r.name.endsWith("onclicka.js") // Avoid treating the main loader script download as an ad-content request
        );

        if (hasAdRequest) {
          logEventOnce("Ad request sent");
        }
      } catch (err) {
        // Fallback or ignore timing error
      }

      // 3. Ad rendered
      const adContainer = document.querySelector('.onclicka-ad-container iframe, iframe[src*="onclicka"], iframe[src*="clickadu"], [id^="wa-"] iframe, [class^="wa-"] iframe');
      const hasAdRendered = !!adContainer || (document.querySelectorAll('.onclicka-ad-container > *').length > 0);

      if (hasAdRendered) {
        logEventOnce("Ad rendered");
      }

      // 4. No fill (Wait enough time, if request sent but no ad element was created)
      if (checkCount >= maxChecks) {
        clearInterval(monitorInterval);
        const requestSent = loggedEvents.current.has("Ad request sent");
        const rendered = loggedEvents.current.has("Ad rendered");
        if (requestSent && !rendered) {
          logEventOnce("No fill");
        } else if (!requestSent && !rendered) {
          // If no requests were sent and nothing rendered, it's also no fill or blocked
          logEventOnce("No fill");
        }
      }
    }, 500);

    // Clean up visibility on unmount but DO NOT remove script tag or duplicate it!
    return () => {
      clearInterval(monitorInterval);
      document.body.classList.add("ads-blocked");
    };
  }, [adSettings, isAllowed, pageName]);

  // Return a centered ad container div when allowed, ensuring 100% compatibility with TMA Inpage ads
  if (isAllowed) {
    return (
      <div 
        className="onclicka-ad-container my-4 min-h-[50px] w-full max-w-md flex items-center justify-center text-xs text-slate-500 font-mono transition-all"
        id="onclicka-inpage-ad-stage"
      >
        {/* Placeholder container where OnClickA SDK will inject TMA Inpage ad */}
      </div>
    );
  }

  return null;
};
