import { useState, useEffect } from 'react';
import AdScriptRenderer from './AdScriptRenderer';
import { db } from '../lib/firebase';
import { collection, query, getDocs } from 'firebase/firestore';

let globalAdsCache: any[] | null = null;
let adsPromise: Promise<any[]> | null = null;

// Helper to check if an ad is active
const isAdActive = (ad: any) => {
  if (!ad.status) return false;
  const statusStr = String(ad.status).toLowerCase();
  return statusStr.includes('active') || statusStr === 'active';
};

// Helper to check page matching
const matchesPage = (adPage: string, targetPage: string) => {
  if (!adPage || adPage === 'All Pages' || targetPage === 'All Pages') return true;
  const cleanAdPage = adPage.toLowerCase().replace('page', '').trim();
  const cleanTarget = targetPage.toLowerCase().replace('page', '').trim();
  return cleanAdPage === cleanTarget || cleanAdPage.includes(cleanTarget) || cleanTarget.includes(cleanAdPage);
};

export default function AdRenderer({ placementKey, targetPage = 'All Pages', fallback }: { placementKey: string, targetPage?: string, fallback?: any }) {
  const [adsToTry, setAdsToTry] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const updateState = (ads: any[]) => {
      // Filter for active and matching ads
      const matched = ads.filter(a => 
        isAdActive(a) && 
        matchesPage(a.targetPage, targetPage) && 
        a.placement === placementKey
      );

      // Sort according to Fallback Priority Order:
      // 1. Adsterra
      // 2. Monetag
      const sorted = [...matched].sort((x, y) => {
        const order: Record<string, number> = { 'Adsterra': 1, 'Monetag': 2 };
        const valX = order[x.adSource] || 99;
        const valY = order[y.adSource] || 99;
        return valX - valY;
      });

      setAdsToTry(sorted);
      setCurrentIndex(0);
      setRenderFailed(false);
      setLoading(false);
    };

    if (globalAdsCache) {
      updateState(globalAdsCache);
      return;
    }

    if (!adsPromise) {
      const q = query(collection(db, "ads"));
      adsPromise = getDocs(q).then(snapshot => {
        const ads: any[] = [];
        snapshot.forEach(doc => ads.push({ id: doc.id, ...doc.data() }));
        globalAdsCache = ads;
        return ads;
      });
    }

    adsPromise.then(updateState).catch(e => {
       console.error("Ad Fetch Error:", e);
       setLoading(false);
    });
  }, [placementKey, targetPage]);

  // If we are currently loading, display nothing
  if (loading) return null;

  // Check if we ran out of ads to try
  const activeAd = adsToTry[currentIndex];
  const allFailed = adsToTry.length === 0 || currentIndex >= adsToTry.length || renderFailed;

  if (allFailed) {
    const isAdminPage = typeof window !== 'undefined' && (
      window.location.pathname === '/ad-test' || 
      window.location.pathname.startsWith('/dashboard/admin')
    );

    if (isAdminPage) {
      return (
        <div className="w-full flex items-center justify-center p-4 bg-slate-950/30 border border-dashed border-slate-800 rounded-xl font-mono text-xs text-slate-500">
          No Ad Inventory Available (All fallback networks failed or empty)
        </div>
      );
    }

    // Public pages: completely hide the ad container
    return null;
  }

  // Skip rendering if it is a Direct Link Ad in a slot where we expect inline rendering
  if (activeAd.adType === 'Direct Link Ad' || activeAd.adType === 'Direct Link') {
    return null;
  }

  const handleStatusChange = (status: 'Pending' | 'Loaded' | 'Failed', msg?: string) => {
    if (status === 'Failed') {
      console.log(`Ad rendering failed for ${activeAd.adName || 'Ad'} (${activeAd.adSource}). trying next fallback...`);
      // Try next fallback ad in queue
      if (currentIndex + 1 < adsToTry.length) {
        setCurrentIndex(prev => prev + 1);
      } else {
        setRenderFailed(true);
      }
    }
  };

  return (
    <div className="w-full relative flex flex-col items-center my-2">
      <div className="w-full overflow-hidden flex justify-center items-center">
        <AdScriptRenderer 
          scriptCode={activeAd.scriptCode} 
          adType={activeAd.adType}
          onStatusChange={handleStatusChange}
        />
      </div>
    </div>
  );
}

export function useDirectLink(placementKey: string = 'Direct Link Slot', targetPage: string = 'All Pages') {
  const [directLinkUrl, setDirectLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    const matchAd = (a: any) => 
      a.placement === placementKey && 
      isAdActive(a) && 
      matchesPage(a.targetPage, targetPage);

    const selectLink = (ads: any[]) => {
      const matched = ads.filter(matchAd);
      // Fallback Priority sorting: Adsterra -> Monetag
      const sorted = [...matched].sort((x, y) => {
        const order: Record<string, number> = { 'Adsterra': 1, 'Monetag': 2 };
        const valX = order[x.adSource] || 99;
        const valY = order[y.adSource] || 99;
        return valX - valY;
      });

      if (sorted.length > 0) {
        setDirectLinkUrl(sorted[0].scriptCode || null);
      }
    };

    if (globalAdsCache) {
      selectLink(globalAdsCache);
      return;
    }

    if (!adsPromise) {
      const q = query(collection(db, "ads"));
      adsPromise = getDocs(q).then(snapshot => {
        const ads: any[] = [];
        snapshot.forEach(doc => ads.push({ id: doc.id, ...doc.data() }));
        globalAdsCache = ads;
        return ads;
      });
    }

    adsPromise.then(selectLink).catch(console.error);
  }, [placementKey, targetPage]);

  return directLinkUrl;
}
