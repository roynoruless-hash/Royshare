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
import DownloadMaintenancePage from "./components/DownloadMaintenancePage";
import UrlMaintenancePage from "./components/UrlMaintenancePage";
import DailyBonusPage from "./pages/DailyBonusPage";
import EarnRewardsPage from "./pages/EarnRewardsPage";
import RewardTasksPage from "./pages/RewardTasksPage";
import VerifyWithdrawalPage from "./pages/VerifyWithdrawalPage";
import AdTestPage from "./pages/AdTestPage";

const ADMIN_AUTH_ENABLED = false;

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    fetch("/api/system-settings")
      .then(res => res.json())
      .then(data => {
        if (data && data.maintenanceMode === "🔴 ON") {
          setMaintenanceMode(true);
        }
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

  if (maintenanceMode) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-yellow-500/30 rounded-2xl p-8 text-center shadow-2xl">
          <div className="text-6xl mb-6">⚠️</div>
          <h1 className="text-3xl font-bold text-white mb-4">System Under Maintenance</h1>
          <p className="text-slate-400">Please try again later. We are currently performing system updates to improve your experience.</p>
        </div>
      </div>
    );
  }

  const downloadMatch = window.location.pathname.match(/^\/download\/([a-zA-Z0-9_-]+)/);
  if (downloadMatch) {
    const fileId = downloadMatch[1];
    return <DownloadMaintenancePage fileId={fileId} />;
  }

  const linkMatch = window.location.pathname.match(/^\/lnk\/([a-zA-Z0-9_-]+)/) || window.location.pathname.match(/^\/link\/([a-zA-Z0-9_-]+)/);
  if (linkMatch) {
    const linkId = linkMatch[1];
    return <UrlMaintenancePage linkId={linkId} />;
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

