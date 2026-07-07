import React, { useState, useRef, useEffect } from 'react';
import { Play, Trash2 } from 'lucide-react';

export default function AdTestingPage() {
  const [scriptInput, setScriptInput] = useState('');
  const [logs, setLogs] = useState<{timestamp: string, type: string, message: string}[]>([]);
  const sandboxRef = useRef<HTMLIFrameElement>(null);

  const addLog = (type: string, message: string) => {
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), type, message }]);
  };

  const runAd = () => {
    if (!sandboxRef.current) return;
    addLog('system', 'Initializing sandbox...');
    
    const sandboxDoc = sandboxRef.current.contentDocument;
    if (!sandboxDoc) return;

    sandboxDoc.open();
    sandboxDoc.write(`
      <html>
        <head>
          <script>
            window.onerror = (msg, url, line, col, error) => {
              window.parent.postMessage({type: 'log', level: 'error', message: \`\${msg} at \${line}:\${col}\`}, '*');
            };
            const consoleLog = console.log;
            console.log = (...args) => {
              window.parent.postMessage({type: 'log', level: 'info', message: args.join(' ')}, '*');
              consoleLog.apply(console, args);
            };
          </script>
        </head>
        <body>
          ${scriptInput}
        </body>
      </html>
    `);
    sandboxDoc.close();
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'log') {
        addLog(event.data.level, event.data.message);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white font-sans">
      <h1 className="text-2xl font-bold mb-6">EZMob Ad Testing & Diagnostics</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
            <h2 className="text-lg font-semibold mb-4">EZMob Script Input</h2>
            <textarea 
              value={scriptInput}
              onChange={(e) => setScriptInput(e.target.value)}
              className="w-full h-64 bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-sm"
              placeholder="Paste your ad script here..."
            />
            <div className="flex gap-2 mt-4">
              <button onClick={runAd} className="flex items-center gap-2 bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold"><Play size={16} /> Run</button>
              <button onClick={() => setScriptInput('')} className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-lg text-sm font-bold"><Trash2 size={16} /> Clear</button>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
          <h2 className="text-lg font-semibold mb-4">Live Sandbox Preview</h2>
          <iframe 
            ref={sandboxRef}
            className="w-full h-64 bg-white rounded-lg border-0"
            title="sandbox"
          />
        </div>
      </div>
      
      <div className="mt-6 bg-slate-900 p-6 rounded-xl border border-slate-800">
        <h2 className="text-lg font-semibold mb-4">Live Console</h2>
        <div className="h-64 overflow-y-auto bg-slate-950 p-4 rounded-lg font-mono text-xs">
          {logs.map((log, i) => (
            <div key={i} className={log.type === 'error' ? 'text-red-400' : 'text-slate-300'}>
              [{log.timestamp}] {log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
