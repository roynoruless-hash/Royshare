/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import AnimatedBackground from "./components/AnimatedBackground";
import Hero from "./components/Hero";
import Stats from "./components/Stats";
import Features from "./components/Features";
import WhyChooseUs from "./components/WhyChooseUs";
import CTA from "./components/CTA";
import Footer from "./components/Footer";
import AdminLogin from "./components/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import MultiPageEngine from "./components/MultiPageEngine";
import DailyBonusPage from "./pages/DailyBonusPage";
import EarnRewardsPage from "./pages/EarnRewardsPage";
import RewardTasksPage from "./pages/RewardTasksPage";
import VerifyWithdrawalPage from "./pages/VerifyWithdrawalPage";
import AdTestPage from "./pages/AdTestPage";
import CustomerSupportPage from "./pages/CustomerSupportPage";

const ADMIN_AUTH_ENABLED = false;

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    fetch("/api/system-settings")
      .then(res => res.json())
      .then(() => {
        setLoadingConfig(false);
      })
      .catch(err => {
        console.error(err);
        setLoadingConfig(false);
      });

    if (!ADMIN_AUTH_ENABLED) return;
    const checkSession = () => {
      const isLoggedIn = localStorage.getItem("isAdminLoggedIn") === "true";
      const expiryTime = localStorage.getItem("expiryTime");
      
      if (isLoggedIn && expiryTime) {
        if (new Date() < new Date(expiryTime)) {
             console.log("Session Restored");
             return; // Valid
        } else {
             console.log("Session Expired");
             localStorage.removeItem("isAdminLoggedIn");
             localStorage.removeItem("loginTime");
             localStorage.removeItem("expiryTime");
             localStorage.removeItem("adminPhoneNumber");
             console.log("Session Cleared");
         }
      }

      if (window.location.pathname === "/dashboard/admin") {
        window.location.href = "/";
      }
    };
    
    checkSession();
  }, []);

  if (loadingConfig) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (window.location.pathname === "/dashboard/admin") {
    return <AdminDashboard />;
  }

  // 1. Log incoming URL details for debugging
  console.log("[App.tsx] Incoming URL:", window.location.href);
  console.log("[App.tsx] Pathname:", window.location.pathname);
  console.log("[App.tsx] Search params:", window.location.search);

  // 2. Parse query parameters
  const params = new URLSearchParams(window.location.search);
  const redirectParam = params.get("redirect") || params.get("url") || params.get("id") || params.get("alias") || params.get("linkId") || params.get("gpl_token");
  
  let detectedLinkId: string | null = null;
  let detectedType: "shortener" | "download" | null = null;

  // Check pathname matches first
  const pathLinkMatch = window.location.pathname.match(/^\/lnk\/([a-zA-Z0-9_-]+)/) || 
                        window.location.pathname.match(/^\/link\/([a-zA-Z0-9_-]+)/) ||
                        window.location.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)/);

  const pathDownloadMatch = window.location.pathname.match(/^\/download\/([a-zA-Z0-9_-]+)/);

  if (pathLinkMatch) {
    detectedLinkId = pathLinkMatch[1];
    detectedType = "shortener";
    console.log("[App.tsx] Detected link ID from pathname:", detectedLinkId);
  } else if (pathDownloadMatch) {
    detectedLinkId = pathDownloadMatch[1];
    detectedType = "download";
    console.log("[App.tsx] Detected download ID from pathname:", detectedLinkId);
  }

  // 3. Fallback/Override from query parameters
  if (!detectedLinkId && redirectParam) {
    console.log("[App.tsx] Found redirect/id/url query parameter:", redirectParam);
    const decodedParam = decodeURIComponent(redirectParam);
    console.log("[App.tsx] Decoded redirect parameter:", decodedParam);

    try {
      if (decodedParam.startsWith("http://") || decodedParam.startsWith("https://")) {
        const parsedUrl = new URL(decodedParam);
        console.log("[App.tsx] Parsed full URL from query parameter:", parsedUrl.href);
        const qPathMatch = parsedUrl.pathname.match(/^\/lnk\/([a-zA-Z0-9_-]+)/) || 
                           parsedUrl.pathname.match(/^\/link\/([a-zA-Z0-9_-]+)/) ||
                           parsedUrl.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)/);
        const qDownloadMatch = parsedUrl.pathname.match(/^\/download\/([a-zA-Z0-9_-]+)/);
        
        if (qPathMatch) {
          detectedLinkId = qPathMatch[1];
          detectedType = "shortener";
        } else if (qDownloadMatch) {
          detectedLinkId = qDownloadMatch[1];
          detectedType = "download";
        }
      } else if (decodedParam.startsWith("/lnk/") || decodedParam.startsWith("/link/") || decodedParam.startsWith("/s/")) {
        const cleanParam = decodedParam.replace(/^\//, "");
        const parts = cleanParam.split("/");
        if (parts.length >= 2) {
          detectedLinkId = parts[1];
          detectedType = "shortener";
        }
      } else if (decodedParam.startsWith("/download/")) {
        const cleanParam = decodedParam.replace(/^\//, "");
        const parts = cleanParam.split("/");
        if (parts.length >= 2) {
          detectedLinkId = parts[1];
          detectedType = "download";
        }
      } else if (/^[a-zA-Z0-9_-]+$/.test(decodedParam)) {
        detectedLinkId = decodedParam;
        detectedType = "shortener";
      }
    } catch (e) {
      console.error("[App.tsx] Error parsing decoded redirectParam:", e);
    }
  }

  if (detectedLinkId && detectedType) {
    console.log(`[App.tsx] Directing to MultiPageEngine: type=${detectedType}, id=${detectedLinkId}`);
    return <MultiPageEngine type={detectedType} id={detectedLinkId} />;
  }

  if (window.location.pathname === "/daily-bonus") {
    return <DailyBonusPage />;
  }

  if (window.location.pathname === "/earn-rewards") {
    return <EarnRewardsPage />;
  }

  if (window.location.pathname === "/reward-tasks") {
    return <RewardTasksPage />;
  }

  const verifyMatch = window.location.pathname.match(/^\/verify-withdrawal\/([a-zA-Z0-9_-]+)/);
  if (verifyMatch) {
    const userId = verifyMatch[1];
    return <VerifyWithdrawalPage userId={userId} />;
  }

  if (window.location.pathname === "/ad-test") {
    return <AdTestPage />;
  }

  if (window.location.pathname === "/support" || window.location.pathname === "/customer-support") {
    return <CustomerSupportPage />;
  }

  return (
    <main className="min-h-screen">
      <AnimatedBackground />
      <Hero onTriggerAdmin={() => ADMIN_AUTH_ENABLED ? setIsModalOpen(true) : window.location.href = '/dashboard/admin'} />
      <Stats />
      <Features />
      <WhyChooseUs />
      <CTA />
      <Footer />
      {ADMIN_AUTH_ENABLED && <AdminLogin isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />}
    </main>
  );
}

