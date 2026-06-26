import { useEffect, useRef } from 'react';

interface AdScriptRendererProps {
  scriptCode: string;
  adType?: string;
  onStatusChange?: (
    status: 'Loaded' | 'Failed' | 'Pending',
    message: string,
    diagnostics?: any
  ) => void;
}

export default function AdScriptRenderer({ 
  scriptCode, 
  adType, 
  onStatusChange 
}: AdScriptRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const initCountRef = useRef(0);
  const lastInjectedRef = useRef<string | null>(null);
  const lastIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sync the callback ref to always have the latest function without triggering effect
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!scriptCode || !iframeRef.current) return;
    
    const iframe = iframeRef.current;

    // Check if we already injected this exact script code into this specific iframe element
    if (lastInjectedRef.current === scriptCode && lastIframeRef.current === iframe) {
      return;
    }

    lastInjectedRef.current = scriptCode;
    lastIframeRef.current = iframe;
    initCountRef.current++;

    const currentInitCount = initCountRef.current;
    let isCancelled = false;

    onStatusChangeRef.current?.('Pending', 'Waiting for script execution...', { 
      scriptInjected: 'Yes', 
      iframeCreated: 'Yes', 
      contentRendered: 'No', 
      containerHeight: 0, 
      containerWidth: 0, 
      domElementsCreated: 0,
      initCount: currentInitCount
    });

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      onStatusChangeRef.current?.('Failed', 'Could not access iframe document', {
        scriptInjected: 'No',
        iframeCreated: 'No',
        contentRendered: 'No',
        initCount: currentInitCount
      });
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
      onStatusChangeRef.current?.('Failed', e.message || 'Error writing to iframe', {
        scriptInjected: 'No',
        iframeCreated: 'Yes',
        contentRendered: 'No',
        initCount: currentInitCount
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
        domElementsCreated: allElements,
        initCount: currentInitCount
      };

      if (hasVisibleContent) {
        clearInterval(checkTimer);
        onStatusChangeRef.current?.('Loaded', 'Content loaded successfully', diagnostics);
      } else if (checks >= 20) { // 10 seconds timeout
        clearInterval(checkTimer);
        onStatusChangeRef.current?.('Failed', 'No Ad Content Returned', diagnostics);
      } else {
        onStatusChangeRef.current?.('Pending', 'Rendering...', diagnostics);
      }
    }, 500);

    return () => {
      isCancelled = true;
      clearInterval(checkTimer);
    };
  }, [scriptCode]);

  return (
    <iframe 
      ref={iframeRef} 
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-forms"
      className="w-full h-full min-h-[90px] flex flex-col items-center justify-center overflow-hidden border-none bg-transparent" 
    />
  );
}
