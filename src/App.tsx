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

  const downloadMatch = window.location.pathname.match(/^\/download\/([a-zA-Z0-9_-]+)/);
  if (downloadMatch) {
    const fileId = downloadMatch[1];
    return <MultiPageEngine type="download" id={fileId} />;
  }

  const linkMatch = window.location.pathname.match(/^\/lnk\/([a-zA-Z0-9_-]+)/) || 
                    window.location.pathname.match(/^\/link\/([a-zA-Z0-9_-]+)/) ||
                    window.location.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)/);
  if (linkMatch) {
    const linkId = linkMatch[1];
    return <MultiPageEngine type="shortener" id={linkId} />;
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

