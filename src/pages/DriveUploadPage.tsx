import { useState, useEffect, useRef } from "react";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { 
  Cloud, 
  UploadCloud, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  ArrowLeft, 
  Copy, 
  ExternalLink, 
  FileIcon,
  HardDrive
} from "lucide-react";

export default function DriveUploadPage() {
  const [tgId, setTgId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "disconnected" | "idle" | "uploading" | "finalizing" | "success" | "error">("checking");
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  
  // Progress states
  const [progress, setProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0); // bytes per second
  const [remainingTime, setRemainingTime] = useState(0); // seconds
  const [uploadedSize, setUploadedSize] = useState(0); // bytes
  const [totalSize, setTotalSize] = useState(0); // bytes
  
  // Result states
  const [royshareLink, setRoyshareLink] = useState("");
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    // Get tg_id from query parameters or Telegram WebApp
    const params = new URLSearchParams(window.location.search);
    let id = params.get("tg_id") || params.get("tgId");

    const tg = (window as any).Telegram?.WebApp;
    if (!id && tg?.initDataUnsafe?.user?.id) {
      id = String(tg.initDataUnsafe.user.id);
    }

    if (id) {
      setTgId(id);
      checkDriveConnection(id);
    } else {
      setPhase("error");
      setError("Telegram user session not detected. Please open this page from the Telegram Bot.");
    }
  }, []);

  const checkDriveConnection = async (userId: string) => {
    try {
      const response = await fetch(`/api/google-drive/status?tg_id=${userId}`);
      if (!response.ok) {
        throw new Error("Failed to check connection status.");
      }
      const data = await response.json();
      if (data.connected) {
        setUserEmail(data.email || "Connected Account");
        setPhase("idle");
      } else {
        setPhase("disconnected");
      }
    } catch (err: any) {
      setPhase("error");
      setError(err.message || "An error occurred while validating Google Drive status.");
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    const maxSize = 10 * 1024 * 1024 * 1024; // 10 GB
    if (file.size > maxSize) {
      setError("File exceeds the maximum size limit of 10 GB.");
      return;
    }
    setError(null);
    setSelectedFile(file);
  };

  const startUpload = async () => {
    if (!selectedFile || !tgId) return;

    setError(null);
    setPhase("uploading");
    setProgress(0);
    setUploadSpeed(0);
    setRemainingTime(0);
    setUploadedSize(0);
    setTotalSize(selectedFile.size);

    try {
      // Step 1: Initiate resumable upload session on server
      const initResponse = await fetch("/api/google-drive/initiate-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tg_id: tgId,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type
        })
      });

      if (!initResponse.ok) {
        const errData = await initResponse.json();
        throw new Error(errData.error || "Failed to initiate resumable upload session.");
      }

      const { uploadUrl } = await initResponse.json();

      // Step 2: Upload directly to Google's Resumable session URL
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", selectedFile.type || "application/octet-stream");

      const startTime = Date.now();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const loaded = event.loaded;
          const total = event.total;
          const percent = Math.round((loaded / total) * 100);
          
          const now = Date.now();
          const duration = (now - startTime) / 1000; // seconds
          const speed = duration > 0 ? loaded / duration : 0; // bytes/sec
          
          const remainingBytes = total - loaded;
          const remainingTimeSec = speed > 0 ? remainingBytes / speed : 0;

          setProgress(percent);
          setUploadedSize(loaded);
          setUploadSpeed(speed);
          setRemainingTime(remainingTimeSec);
        }
      };

      xhr.onload = async () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try {
            const googleResponse = JSON.parse(xhr.responseText);
            const driveFileId = googleResponse.id;

            if (!driveFileId) {
              throw new Error("Google Drive API response did not include a File ID.");
            }

            // Step 3: Finalize upload on the server
            setPhase("finalizing");
            const finalizeResponse = await fetch("/api/google-drive/finalize-upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                tg_id: tgId,
                driveFileId,
                fileName: selectedFile.name,
                fileSize: selectedFile.size,
                mimeType: selectedFile.type
              })
            });

            if (!finalizeResponse.ok) {
              const errData = await finalizeResponse.json();
              throw new Error(errData.error || "Failed to finalize the upload with RoyShare server.");
            }

            const finalizeData = await finalizeResponse.json();
            setRoyshareLink(finalizeData.royshareLink);
            setPhase("success");
          } catch (err: any) {
            setPhase("error");
            setError(err.message || "An error occurred while finalizing the file.");
          }
        } else {
          setPhase("error");
          setError(`Google Drive upload failed with status code ${xhr.status}.`);
        }
      };

      xhr.onerror = () => {
        setPhase("error");
        setError("A network error occurred during upload. Please check your internet connection and try again.");
      };

      xhr.send(selectedFile);

    } catch (err: any) {
      setPhase("error");
      setError(err.message || "An unexpected error occurred during initiation.");
    }
  };

  const cancelUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      setPhase("idle");
      setSelectedFile(null);
      setProgress(0);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(royshareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return "calculating...";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const triggerPicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <div id="drive-upload-container" className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-4">
      <div id="drive-upload-card" className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 md:p-8">
        
        {/* HEADER */}
        <div id="upload-header" className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Cloud className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">RoyShare Cloud</h1>
              <p className="text-xs text-slate-400">Large File Direct Uploader</p>
            </div>
          </div>
          {phase === "idle" && (
            <div className="flex items-center gap-1.5 text-xs bg-slate-800/80 px-2.5 py-1 rounded-full text-slate-300">
              <HardDrive className="w-3.5 h-3.5 text-blue-400" />
              <span className="truncate max-w-[150px]">{userEmail}</span>
            </div>
          )}
        </div>

        {/* ERROR DISPLAY */}
        {error && (
          <div id="upload-error-alert" className="mb-6 p-4 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-sm flex gap-3 items-start">
            <XCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <div>
              <p className="font-semibold">Upload Error</p>
              <p className="opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* PHASE 1: CHECKING STATUS */}
        {phase === "checking" && (
          <div id="checking-loader" className="flex flex-col items-center py-12 text-center">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-300 font-medium">Validating connection status...</p>
            <p className="text-xs text-slate-500 mt-1">Please keep this tab open</p>
          </div>
        )}

        {/* PHASE 2: DISCONNECTED / NOT CONNECTED */}
        {phase === "disconnected" && (
          <div id="disconnected-message" className="flex flex-col items-center py-8 text-center">
            <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center text-amber-500 mb-4 border border-amber-500/20">
              <XCircle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Google Drive Disconnected</h2>
            <p className="text-sm text-slate-400 max-w-sm mb-6">
              You must link your Google Drive account before using the Large File Upload service.
            </p>
            <a 
              href={`https://royshare.onrender.com/api/google-drive/connect?tg_id=${tgId}`}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition text-sm flex items-center gap-2 shadow-lg shadow-blue-600/20"
            >
              <Cloud className="w-4 h-4" /> Connect Google Drive
            </a>
          </div>
        )}

        {/* PHASE 3: IDLE / READY FOR SELECTION */}
        {phase === "idle" && (
          <div id="idle-dropzone-view" className="space-y-6">
            {!selectedFile ? (
              <div 
                id="dropzone-area"
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={triggerPicker}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center min-h-[220px] ${
                  isDragActive 
                    ? "border-blue-500 bg-blue-500/5 text-blue-400" 
                    : "border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:bg-slate-950/20"
                }`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                />
                <UploadCloud className="w-12 h-12 text-slate-500 mb-4 animate-bounce" />
                <p className="text-white font-medium mb-1">Drag & drop your file here</p>
                <p className="text-xs text-slate-400 mb-2">or click to browse your local storage</p>
                <span className="text-[10px] uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-semibold">
                  Max Size: 10 GB
                </span>
              </div>
            ) : (
              <div id="selected-file-view" className="p-4 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg text-blue-400">
                  <FileIcon className="w-8 h-8" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{formatBytes(selectedFile.size)}</p>
                </div>
                <button 
                  onClick={() => setSelectedFile(null)} 
                  className="text-xs text-rose-400 hover:text-rose-300 font-semibold uppercase tracking-wider px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 transition"
                >
                  Clear
                </button>
              </div>
            )}

            <div id="actions-footer" className="flex gap-3">
              <button
                disabled={!selectedFile}
                onClick={startUpload}
                className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm transition text-center flex items-center justify-center gap-2 ${
                  selectedFile
                    ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
                    : "bg-slate-800 text-slate-500 cursor-not-allowed"
                }`}
              >
                <UploadCloud className="w-4 h-4" /> Start Secure Upload
              </button>
            </div>
          </div>
        )}

        {/* PHASE 4: UPLOADING */}
        {phase === "uploading" && (
          <div id="uploading-progress-view" className="space-y-6">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <p className="text-sm font-medium text-slate-300 truncate flex-1">
                Uploading: <span className="text-white font-semibold">{selectedFile?.name}</span>
              </p>
              <span className="text-sm font-bold text-blue-400">{progress}%</span>
            </div>

            {/* PROGRESS BAR */}
            <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-150 ease-out"
                style={{ width: `${progress}%` }}
              ></div>
            </div>

            {/* SPEED & DETAILS */}
            <div className="grid grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/50">
              <div>
                <p className="text-xs text-slate-500">Speed</p>
                <p className="text-sm font-bold text-white mt-0.5">{formatBytes(uploadSpeed)}/s</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Remaining Time</p>
                <p className="text-sm font-bold text-white mt-0.5">{formatTime(remainingTime)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Uploaded</p>
                <p className="text-sm font-bold text-white mt-0.5">
                  {formatBytes(uploadedSize)} <span className="text-slate-500 font-normal">/ {formatBytes(totalSize)}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Storage Target</p>
                <p className="text-sm font-bold text-emerald-400 mt-0.5">Google Drive</p>
              </div>
            </div>

            <button 
              onClick={cancelUpload}
              className="w-full py-2.5 bg-slate-800 hover:bg-rose-950/30 hover:text-rose-400 text-slate-300 rounded-xl font-semibold text-xs transition uppercase tracking-wider border border-slate-700/50 hover:border-rose-900/30"
            >
              Cancel Upload
            </button>
          </div>
        )}

        {/* PHASE 5: FINALIZING */}
        {phase === "finalizing" && (
          <div id="finalizing-view" className="flex flex-col items-center py-10 text-center">
            <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
            <h3 className="text-lg font-bold text-white">Generating RoyShare Link...</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              We are finalizing permissions on your connected Google Drive so visitors can download directly and securely.
            </p>
          </div>
        )}

        {/* PHASE 6: SUCCESS */}
        {phase === "success" && (
          <div id="success-results-view" className="space-y-6">
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-400 border border-emerald-500/20 mb-4 animate-bounce">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-white">Upload Successful!</h2>
              <p className="text-xs text-slate-400 mt-1">
                Your RoyShare URL is ready and your Telegram Bot has been notified.
              </p>
            </div>

            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center gap-3">
              <input 
                type="text" 
                readOnly 
                value={royshareLink} 
                className="bg-transparent border-none text-sm text-blue-400 font-semibold focus:ring-0 flex-1 min-w-0"
              />
              <button 
                onClick={copyToClipboard}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition relative"
                title="Copy Link"
              >
                <Copy className="w-4 h-4" />
                {copied && (
                  <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded shadow font-semibold">
                    Copied!
                  </span>
                )}
              </button>
            </div>

            <div className="flex gap-3">
              <a 
                href={royshareLink}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 border border-slate-700"
              >
                <ExternalLink className="w-4 h-4" /> Open Link
              </a>
              <button 
                onClick={() => {
                  setSelectedFile(null);
                  setPhase("idle");
                  setRoyshareLink("");
                }}
                className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold text-sm transition text-center shadow-lg shadow-blue-600/20"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* PHASE 7: GENERAL ERROR STATE / RETRY */}
        {phase === "error" && !error?.includes("session not detected") && (
          <div id="error-retry-action" className="flex flex-col items-center py-4">
            <button 
              onClick={() => {
                setError(null);
                setPhase("idle");
                setSelectedFile(null);
              }}
              className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-sm transition border border-slate-700"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
