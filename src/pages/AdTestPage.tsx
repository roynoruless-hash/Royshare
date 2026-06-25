import { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, getDocs, query } from 'firebase/firestore';

export default function AdTestPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [selectedAd, setSelectedAd] = useState<any>(null);
  const [scriptInput, setScriptInput] = useState('');
  const [renderMode, setRenderMode] = useState<'iframe' | 'native'>('iframe');
  
  const [diagnostics, setDiagnostics] = useState({
    scriptLoaded: 'No',
    externalRequestSent: 'No',
    cspBlocked: 'No',
    sandboxBlocked: 'No',
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nativeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchAds = async () => {
      const q = query(collection(db, "ads"));
      const snapshot = await getDocs(q);
      const fetchedAds: any[] = [];
      snapshot.forEach(doc => {
        fetchedAds.push({ id: doc.id, ...doc.data() });
      });
      setAds(fetchedAds);
    };
    fetchAds();
  }, []);

  const handleTest = () => {
    const code = scriptInput || (selectedAd ? selectedAd.scriptCode : '');
    if (!code) return;

    setDiagnostics({
      scriptLoaded: 'No',
      externalRequestSent: 'No',
      cspBlocked: 'No',
      sandboxBlocked: 'No',
    });

    if (renderMode === 'iframe') {
      const iframe = iframeRef.current;
      if (!iframe) return;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { margin: 0; padding: 0; background: #fff; color: #000; min-height: 100vh; display: flex; justify-content: center; align-items: center; }
            </style>
            <script>
              // Monitor external requests
              const originalFetch = window.fetch;
              window.fetch = function() {
                window.parent.postMessage({ type: 'EXTERNAL_REQ' }, '*');
                return originalFetch.apply(this, arguments);
              };
              const originalXhrOpen = XMLHttpRequest.prototype.open;
              XMLHttpRequest.prototype.open = function() {
                window.parent.postMessage({ type: 'EXTERNAL_REQ' }, '*');
                return originalXhrOpen.apply(this, arguments);
              };

              // Monitor CSP or Sandbox errors
              document.addEventListener('securitypolicyviolation', (e) => {
                window.parent.postMessage({ type: 'CSP_ERROR', details: e.violatedDirective }, '*');
              });

              window.addEventListener('error', function(e) {
                if (e.message && e.message.toLowerCase().includes('sandbox')) {
                  window.parent.postMessage({ type: 'SANDBOX_ERROR' }, '*');
                }
              });

              const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                  mutation.addedNodes.forEach((node) => {
                    if (node.tagName === 'SCRIPT' && node.src) {
                       window.parent.postMessage({ type: 'EXTERNAL_REQ' }, '*');
                    }
                    if (node.tagName === 'IFRAME') {
                       window.parent.postMessage({ type: 'SCRIPT_LOADED' }, '*');
                    }
                  });
                });
              });
              observer.observe(document.documentElement, { childList: true, subtree: true });

              window.onload = () => {
                window.parent.postMessage({ type: 'SCRIPT_LOADED' }, '*');
              };
            </script>
          </head>
          <body>
            ${code}
            <script>
              // Check if anything rendered after a short delay
              setTimeout(() => {
                if (document.body.innerHTML.length > code.length + 50) {
                   window.parent.postMessage({ type: 'SCRIPT_LOADED' }, '*');
                }
              }, 2000);
            </script>
          </body>
        </html>
      `;
      iframe.srcdoc = htmlContent;
    } else {
      // Native Appending
      const container = nativeContainerRef.current;
      if (!container) return;
      container.innerHTML = '';
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(code, 'text/html');
      
      Array.from(doc.body.childNodes).forEach(node => {
        if (node.nodeName === 'SCRIPT') {
          const oldScript = node as HTMLScriptElement;
          const newScript = document.createElement('script');
          Array.from(oldScript.attributes).forEach(attr => {
            newScript.setAttribute(attr.name, attr.value);
          });
          if (oldScript.textContent) {
            newScript.textContent = oldScript.textContent;
          }
          container.appendChild(newScript);
          setDiagnostics(prev => ({ ...prev, scriptLoaded: 'Yes (Appended)' }));
          if (newScript.src) {
            setDiagnostics(prev => ({ ...prev, externalRequestSent: 'Yes (DOM Insert)' }));
          }
        } else {
          container.appendChild(node.cloneNode(true));
        }
      });
      
      setTimeout(() => {
        if (container.querySelectorAll('iframe').length > 0) {
          setDiagnostics(prev => ({ ...prev, scriptLoaded: 'Yes (Iframe Injected)' }));
        }
      }, 2000);
    }
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (renderMode !== 'iframe' || !iframeRef.current || e.source !== iframeRef.current.contentWindow) return;

      if (e.data?.type === 'SCRIPT_LOADED') {
        setDiagnostics(prev => ({ ...prev, scriptLoaded: 'Yes' }));
      } else if (e.data?.type === 'EXTERNAL_REQ') {
        setDiagnostics(prev => ({ ...prev, externalRequestSent: 'Yes' }));
      } else if (e.data?.type === 'CSP_ERROR') {
        setDiagnostics(prev => ({ ...prev, cspBlocked: 'Yes' }));
      } else if (e.data?.type === 'SANDBOX_ERROR') {
        setDiagnostics(prev => ({ ...prev, sandboxBlocked: 'Yes' }));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [renderMode]);

  return (
    <div className="min-h-screen bg-[#020617] text-white p-8">
      <h1 className="text-3xl font-bold mb-8">Ad Diagnostics Test Page</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
            <h2 className="text-xl font-bold mb-4">Select Saved Ad</h2>
            <select 
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white mb-4"
              onChange={(e) => {
                const ad = ads.find(a => a.id === e.target.value);
                setSelectedAd(ad);
                if (ad) setScriptInput(ad.scriptCode);
              }}
            >
              <option value="">-- Select an Ad --</option>
              {ads.map(ad => (
                <option key={ad.id} value={ad.id}>{ad.adName} ({ad.adSource} - {ad.adType})</option>
              ))}
            </select>

            <h2 className="text-xl font-bold mb-4">Or Paste Script</h2>
            <textarea
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white h-32 font-mono text-sm mb-4"
              value={scriptInput}
              onChange={(e) => setScriptInput(e.target.value)}
              placeholder="Paste <script>..."
            />

            <div className="flex gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="mode" checked={renderMode === 'iframe'} onChange={() => setRenderMode('iframe')} className="text-blue-500 bg-slate-950" />
                <span>Iframe Mode (Safe)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="mode" checked={renderMode === 'native'} onChange={() => setRenderMode('native')} className="text-blue-500 bg-slate-950" />
                <span>Native DOM (createElement)</span>
              </label>
            </div>

            <button 
              onClick={handleTest}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold transition-all"
            >
              Run Test
            </button>
          </div>

          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
            <h2 className="text-xl font-bold mb-4">Diagnostics</h2>
            <div className="space-y-3 font-mono text-sm">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Script Loaded</span>
                <span className={diagnostics.scriptLoaded !== 'No' ? 'text-emerald-400' : 'text-slate-500'}>{diagnostics.scriptLoaded}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">External Request Sent</span>
                <span className={diagnostics.externalRequestSent !== 'No' ? 'text-emerald-400' : 'text-slate-500'}>{diagnostics.externalRequestSent}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">CSP Blocked</span>
                <span className={diagnostics.cspBlocked === 'Yes' ? 'text-red-400' : 'text-slate-500'}>{diagnostics.cspBlocked}</span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-slate-400">Sandbox Blocked</span>
                <span className={diagnostics.sandboxBlocked === 'Yes' ? 'text-red-400' : 'text-slate-500'}>{diagnostics.sandboxBlocked}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 flex flex-col">
          <h2 className="text-xl font-bold mb-4">Live Render ({renderMode})</h2>
          <div className="flex-1 bg-white rounded-xl overflow-hidden border border-slate-700 relative min-h-[400px]">
            {renderMode === 'iframe' ? (
              <iframe
                ref={iframeRef}
                className="w-full h-full border-none absolute inset-0"
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-forms"
              />
            ) : (
              <div ref={nativeContainerRef} className="w-full h-full absolute inset-0 p-4 overflow-auto text-black" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
