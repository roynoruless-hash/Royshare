import React, { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { Send } from "lucide-react";

export default function TelegramOrb({ onTriggerAdmin }: { onTriggerAdmin: () => void }) {
  const [progress, setProgress] = useState(0);
  const pressTimer = useRef<number | null>(null);
  const isTouch = useRef(false);
  
  const [tapCount, setTapCount] = useState(0);
  const tapTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pressTimer.current) {
        clearInterval(pressTimer.current);
      }
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
      }
    };
  }, []);

  const handleTap = () => {
    setTapCount(prev => prev + 1);
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => setTapCount(0), 2000);
    if (tapCount + 1 === 2) {
        onTriggerAdmin();
        setTapCount(0);
        clearTimeout(tapTimerRef.current!);
    }
  };

  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.type === "touchstart") {
      isTouch.current = true;
    } else if (e.type === "mousedown" && isTouch.current) {
      // Ignore simulated mouse event on mobile/touch screens
      return;
    }

    if (pressTimer.current) {
      clearInterval(pressTimer.current);
    }

    let startTime = Date.now();
    pressTimer.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      // Triggers precisely at 2 seconds (2000ms)
      const newProgress = Math.min((elapsed / 2000) * 100, 100);
      setProgress(newProgress);
      if (newProgress >= 100) {
        if (pressTimer.current) {
          clearInterval(pressTimer.current);
          pressTimer.current = null;
        }
        onTriggerAdmin();
        setProgress(0);
      }
    }, 50);
  };

  const endPress = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.type === "touchend" || e.type === "touchcancel") {
      // Allow simulated events to pass before resetting the touch flag
      setTimeout(() => {
        isTouch.current = false;
      }, 500);
    }

    if (pressTimer.current) {
        clearInterval(pressTimer.current);
        pressTimer.current = null;
    }
    setProgress(0);
  };

  return (
    <motion.button
      onClick={handleTap}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      whileHover={{ scale: 1.1 }}
      className="relative flex items-center justify-center w-32 h-32 mb-10 mx-auto cursor-pointer"
      animate={{ y: [0, -10, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      {/* Progress Ring */}
      <svg className="absolute w-full h-full -rotate-90">
          <circle 
            cx="64" cy="64" r="60" 
            className="stroke-slate-800 fill-none"
            strokeWidth="4"
          />
          <motion.circle 
            cx="64" cy="64" r="60" 
            className="stroke-blue-500 fill-none"
            strokeWidth="4"
            style={{ pathLength: progress / 100 }}
          />
      </svg>

      {/* Glow Ring */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 rounded-full bg-blue-500 blur-2xl"
      />
      
      {/* Orb Body */}
      <div className="relative w-24 h-24 bg-gradient-to-br from-blue-600 to-blue-700 rounded-full flex items-center justify-center shadow-2xl shadow-blue-500/50 overflow-hidden border border-white/10">
        <motion.div
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-[-30deg]"
        />
        <Send className="w-10 h-10 text-white relative z-10" />
      </div>

       {/* Particles */}
       {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 bg-blue-400 rounded-full"
          animate={{
            x: [0, Math.sin(i) * 80],
            y: [0, Math.cos(i) * 80],
            opacity: [0, 1, 0],
          }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </motion.button>
  );
}
