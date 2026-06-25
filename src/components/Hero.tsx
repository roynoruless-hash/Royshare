import { motion } from "motion/react";
import { Send } from "lucide-react";
import TelegramOrb from "./TelegramOrb";

export default function Hero({ onTriggerAdmin }: { onTriggerAdmin: () => void }) {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center pt-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center"
      >
        <TelegramOrb onTriggerAdmin={onTriggerAdmin}/>
        <h1 className="text-6xl md:text-8xl font-display font-medium text-white mb-6 tracking-tight">
          Share Smarter, <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
            Earn More.
          </span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10">
          Upload files, share links, earn rewards and manage downloads with our secure
          Telegram powered platform.
        </p>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="group relative inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full text-white font-semibold text-lg shadow-lg shadow-blue-500/20"
        >
          <span className="absolute inset-0 rounded-full animate-pulse bg-white/20" />
          <Send className="w-5 h-5" />
          Open Telegram Bot
        </motion.button>
      </motion.div>
    </section>
  );
}
