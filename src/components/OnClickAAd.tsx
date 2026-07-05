import React, { useEffect, useState } from "react";
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

  // Determine if we should show the ad on this page based on static rules
  const isAllowed = ALLOWED_PAGES.includes(pageName.toLowerCase()) && 
                    !FORBIDDEN_PAGES.includes(pageName.toLowerCase()) &&
                    !(pageName.toLowerCase() === "daily-bonus" && isDailyBonusScratchActive);

  // Fetch centralized ad settings from Firestore settings/advertisement
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
        console.error("Error loading centralized advertisement settings:", err);
        if (active) {
          setAdSettings({ enabled: false, verified: false, script: "" });
        }
      }
    };

    fetchSettings();
    return () => {
      active = false;
    };
  }, []);

  // Handle global script injection and page-specific visibility
  useEffect(() => {
    if (!adSettings) return;

    const { enabled, verified, script } = adSettings;

    // If disabled, unverified, or empty script, strictly block ads
    if (!enabled || !verified || !script) {
      document.body.classList.add("ads-blocked");
      return;
    }

    // Parse OnClickA script tag dynamically
    let src = "";
    const attributes: { [key: string]: string } = {};

    try {
      const parser = new DOMParser();
      const docObj = parser.parseFromString(script, "text/html");
      const parsedScript = docObj.querySelector("script");
      if (parsedScript) {
        src = parsedScript.getAttribute("src") || "";
        for (let i = 0; i < parsedScript.attributes.length; i++) {
          const attr = parsedScript.attributes[i];
          if (attr.name !== "src") {
            attributes[attr.name] = attr.value;
          }
        }
      }
    } catch (e) {
      console.error("Failed to parse ad script HTML:", e);
    }

    // If no valid source is found, do not proceed and block
    if (!src) {
      document.body.classList.add("ads-blocked");
      return;
    }

    // Inject the script if not already present in document
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (!existingScript) {
      console.log(`[OnClickA] Injecting centralized script: ${src}`);
      const scriptEl = document.createElement("script");
      scriptEl.src = src;
      // Copy other dynamic attributes (like data-wa-zone)
      Object.keys(attributes).forEach((key) => {
        scriptEl.setAttribute(key, attributes[key]);
      });
      scriptEl.setAttribute("data-cfasync", "false");
      scriptEl.async = true;
      document.head.appendChild(scriptEl);
    } else {
      console.log(`[OnClickA] Script already loaded, reusing: ${src}`);
    }

    // Control visibility classes on document body
    if (isAllowed) {
      console.log(`[OnClickA] Ad is ALLOWED on page: ${pageName}`);
      document.body.classList.remove("ads-blocked");
    } else {
      console.log(`[OnClickA] Ad is FORBIDDEN on page: ${pageName}`);
      document.body.classList.add("ads-blocked");
    }

    // Clean up visibility class on component unmount/page change
    return () => {
      document.body.classList.add("ads-blocked");
    };
  }, [adSettings, pageName, isAllowed]);

  return null;
};
