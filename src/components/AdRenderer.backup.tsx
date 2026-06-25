import { useState, useEffect } from 'react';
import AdScriptRenderer from './AdScriptRenderer';
import { db } from '../lib/firebase';
import { collection, query, getDocs } from 'firebase/firestore';

let globalAdsCache: any[] | null = null;
let adsPromise: Promise<any[]> | null = null;

export default function AdRenderer({ placementKey, targetPage = 'All Pages' }: { placementKey: string, targetPage?: string }) {
  const [ad, setAd] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const matchAd = (a: any) => {
      // Handle page match
      const matchesPage = a.targetPage === targetPage || a.targetPage === 'All Pages' || !a.targetPage;
      // Handle placement match
      const matchesPlacement = a.placement === placementKey;
      // Handle status match
      const matchesStatus = a.status === '🟢 Active';
      
      return matchesPage && matchesPlacement && matchesStatus;
    };

    const updateState = (ads: any[]) => {
      const validAds = ads.filter(matchAd);
      const chosenAd = validAds.length > 0 ? validAds[Math.floor(Math.random() * validAds.length)] : null;
      setAd(chosenAd);
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

  if (loading) return null;
  if (!ad) return null;

  // Direct Link ads are usually handled differently (e.g. popups or button clicks)
  if (ad.adType === 'Direct Link Ad') {
    return null;
  }

  // Render Adsterra or Monetag Native/Banner Scripts
  if (ad.adSource === 'Adsterra' || ad.adSource === 'Monetag') {
    return (
      <div className="w-full relative flex flex-col items-center my-2">
        <div className="w-full overflow-hidden flex justify-center items-center">
          <AdScriptRenderer scriptCode={ad.scriptCode} />
        </div>
      </div>
    );
  }

  return null;
}

export function useDirectLink(placementKey: string = 'Direct Link Slot', targetPage: string = 'All Pages') {
  const [directLinkUrl, setDirectLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    const matchAd = (a: any) => 
      a.placement === placementKey && 
      a.status === '🟢 Active' && 
      (a.targetPage === targetPage || a.targetPage === 'All Pages' || !a.targetPage);

    if (globalAdsCache) {
      const validAds = globalAdsCache.filter(matchAd);
      if (validAds.length > 0) {
        setDirectLinkUrl(validAds[0].scriptCode || null);
      }
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

    adsPromise.then(ads => {
      const validAds = ads.filter(matchAd);
      if (validAds.length > 0) {
        setDirectLinkUrl(validAds[0].scriptCode || null);
      }
    }).catch(console.error);
  }, [placementKey, targetPage]);

  return directLinkUrl;
}
