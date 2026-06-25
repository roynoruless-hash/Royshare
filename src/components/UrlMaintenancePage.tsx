import { useState, useEffect } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import AnimatedBackground from "./AnimatedBackground";
import AdRenderer from "./AdRenderer";

export default function UrlMaintenancePage({ linkId }: { linkId: string }) {
    const [linkData, setLinkData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const fetchLink = async () => {
            try {
                const docSnap = await getDoc(doc(db, "links", linkId));
                if (docSnap.exists() && docSnap.data().status !== "deleted") {
                    setLinkData(docSnap.data());
                } else {
                    setError("Short link not found or has been deleted.");
                }
            } catch (err: any) {
                console.error("Error loading short link details:", err);
                setError("Error loading link details.");
            } finally {
                setLoading(false);
            }
        };
        fetchLink();
    }, [linkId]);

    return (
        <div className="min-h-screen relative text-slate-200 font-sans flex flex-col justify-between overflow-hidden">
            <AnimatedBackground />
            
            {/* Header */}
            <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between border-b border-white/5">
                <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-teal-400 to-indigo-500 bg-clip-text text-transparent">
                    RoyShare
                </span>
            </header>

            {/* Top Banner Ad */}
            <div className="relative z-10 w-full max-w-xl mx-auto px-6 mt-2">
                <AdRenderer targetPage="URL Shortener" placementKey="Header Banner" />
            </div>

            {/* Content Container */}
            <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-xl bg-slate-900/80 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-2xl space-y-6">
                    <div className="text-center space-y-2">
                        <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
                            <span>🚧</span> RoyShare URL Center
                        </h1>
                        <p className="text-rose-400 font-semibold text-lg flex items-center justify-center gap-1.5 bg-rose-500/10 py-1.5 px-4 rounded-lg border border-rose-500/15">
                            ⚠️ URL Redirect System Under Maintenance
                        </p>
                    </div>

                    <div className="bg-slate-950/60 rounded-xl p-6 border border-white/5 space-y-4 text-sm">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-6 space-y-3">
                                <div className="w-8 h-8 border-4 border-teal-500/30 border-t-teal-500 rounded-full animate-spin"></div>
                                <span className="text-slate-400">Verifying short link...</span>
                            </div>
                        ) : error ? (
                            <div className="text-center py-4 text-slate-400">
                                <p className="text-lg font-medium text-slate-300">❌ Error</p>
                                <p className="mt-1">{error}</p>
                            </div>
                        ) : (
                            <>
                                <p className="text-slate-400 font-medium">This short link has been created successfully.</p>
                                
                                <div className="h-px bg-white/5 my-2"></div>
                                
                                <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-3 pt-2">
                                    <span className="text-slate-400 font-medium">Link ID:</span>
                                    <span className="text-white font-semibold break-all">{linkData.linkId || linkId}</span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Secondary Banner Ad */}
                    <AdRenderer targetPage="URL Shortener" placementKey="Secondary Banner" />

                    <div className="text-center text-slate-400 text-sm">
                        Please try again later.
                    </div>
                </div>
            </main>

            {/* Footer Banner Ad */}
            <div className="relative z-10 w-full max-w-xl mx-auto px-6 mb-2">
                <AdRenderer targetPage="URL Shortener" placementKey="Footer Banner" />
            </div>

            {/* Footer */}
            <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 border-t border-white/5 text-center text-xs text-slate-500">
                &copy; {new Date().getFullYear()} RoyShare. All rights reserved.
            </footer>
        </div>
    );
}
