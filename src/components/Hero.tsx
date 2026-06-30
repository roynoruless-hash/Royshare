import { motion, useScroll, useTransform } from "motion/react";
import { Send, Cloud, Shield, Zap, Folder, Wallet, ChevronDown, CheckCircle2 } from "lucide-react";
import TelegramOrb from "./TelegramOrb";

const FloatingChip = ({ icon: Icon, text, delay, x, y }: { icon: any, text: string, delay: number, x: string, y: string }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.5 }}
    animate={{ 
      opacity: 1, 
      scale: 1,
      y: [0, -10, 0],
      x: [0, 5, 0]
    }}
    transition={{ 
      duration: 3, 
      delay, 
      repeat: Infinity, 
      ease: "easeInOut" 
    }}
    style={{ left: x, top: y }}
    className="absolute hidden lg:flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-full shadow-2xl z-20 pointer-events-none"
  >
    <Icon className="w-4 h-4 text-blue-400" />
    <span className="text-white/80 text-sm font-medium">{text}</span>
  </motion.div>
);

const TrustBadge = ({ icon: Icon, text }: { icon: any, text: string }) => (
  <motion.div
    whileHover={{ scale: 1.05, backgroundColor: "rgba(255, 255, 255, 0.1)" }}
    className="flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl transition-all duration-300"
  >
    <Icon className="w-4 h-4 text-blue-400" />
    <span className="text-white/70 text-sm font-medium">{text}</span>
  </motion.div>
);

const WorkflowStep = ({ icon: Icon, text, delay }: { icon: any, text: string, delay: number }) => (
  <motion.div
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 0.5, delay }}
    className="flex items-center gap-4 p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl group hover:bg-white/10 transition-all"
  >
    <div className="p-3 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-xl group-hover:scale-110 transition-transform">
      <Icon className="w-6 h-6 text-blue-400" />
    </div>
    <span className="text-white font-medium">{text}</span>
    <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
  </motion.div>
);

const WorkflowCard = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 1 }}
    className="relative p-6 lg:p-8 rounded-3xl bg-slate-900/40 border border-white/10 backdrop-blur-xl shadow-2xl overflow-hidden group w-full max-w-md mx-auto lg:mx-0"
  >
    {/* Decorative glow */}
    <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/20 rounded-full blur-[80px]" />
    <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/20 rounded-full blur-[80px]" />

    <div className="relative space-y-4">
      <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
        <Zap className="w-5 h-5 text-blue-400" />
        RoyShare Workflow
      </h3>
      
      <WorkflowStep icon={Cloud} text="Upload File" delay={0.2} />
      
      <div className="flex justify-center py-1">
        <motion.div
          animate={{ y: [0, 5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <ChevronDown className="w-6 h-6 text-blue-400/50" />
        </motion.div>
      </div>

      <WorkflowStep icon={Folder} text="Google Drive" delay={0.4} />

      <div className="flex justify-center py-1">
        <motion.div
          animate={{ y: [0, 5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
        >
          <ChevronDown className="w-6 h-6 text-blue-400/50" />
        </motion.div>
      </div>

      <WorkflowStep icon={Send} text="RoyShare Link" delay={0.6} />

      <div className="flex justify-center py-1">
        <motion.div
          animate={{ y: [0, 5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
        >
          <ChevronDown className="w-6 h-6 text-blue-400/50" />
        </motion.div>
      </div>

      <WorkflowStep icon={Wallet} text="Wallet Rewards" delay={0.8} />
    </div>
  </motion.div>
);

export default function Hero({ onTriggerAdmin }: { onTriggerAdmin: () => void }) {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2], [1, 0.9]);

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-32 pb-20 px-6 overflow-hidden bg-slate-950">
      {/* Background Elements */}
      <div className="absolute inset-0 z-0">
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{ 
            scale: [1.1, 1, 1.1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px]" 
        />
      </div>

      <motion.div 
        style={{ opacity, scale }}
        className="relative z-10 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center w-full"
      >
        {/* Left Side: Content */}
        <div className="text-center lg:text-left relative">
          <TelegramOrb onTriggerAdmin={onTriggerAdmin} />

          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-white mb-6 tracking-tight leading-[1.1]"
          >
            Share Smarter.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500">
              Earn Faster.
            </span>
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="text-lg md:text-xl text-slate-400 max-w-xl mx-auto lg:mx-0 mb-10 leading-relaxed"
          >
            Secure cloud file sharing powered by Telegram and Google Drive.
            <br className="hidden md:block" />
            Upload files, shorten URLs, track downloads and earn rewards from one powerful dashboard.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-12"
          >
            <motion.button
              whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(59, 130, 246, 0.5)" }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-10 py-5 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white font-bold text-lg shadow-xl flex items-center justify-center gap-3"
            >
              🚀 Start Sharing
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05, backgroundColor: "rgba(255, 255, 255, 0.1)" }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-10 py-5 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-white font-bold text-lg transition-all"
            >
              ✨ View Features
            </motion.button>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="flex flex-wrap justify-center lg:justify-start gap-4"
          >
            <TrustBadge icon={Cloud} text="Google Drive Storage" />
            <TrustBadge icon={Send} text="Telegram Integration" />
            <TrustBadge icon={Shield} text="Secure Encryption" />
          </motion.div>
        </div>

        {/* Right Side: Workflow Visual */}
        <div className="relative">
          <WorkflowCard />
          
          {/* Floating Chips around the Workflow Card */}
          <FloatingChip icon={Zap} text="Fast" delay={0} x="85%" y="10%" />
          <FloatingChip icon={Cloud} text="Cloud" delay={1} x="-10%" y="20%" />
          <FloatingChip icon={Wallet} text="Rewards" delay={2} x="90%" y="60%" />
          <FloatingChip icon={Shield} text="Secure" delay={1.5} x="-5%" y="75%" />
          <FloatingChip icon={Folder} text="Upload" delay={0.5} x="10%" y="-5%" />
        </div>
      </motion.div>

      {/* Scroll Indicator */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
      >
        <span className="text-white/40 text-xs font-bold uppercase tracking-[0.2em]">Explore Features</span>
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="p-2 rounded-full bg-white/5 border border-white/10"
        >
          <ChevronDown className="w-5 h-5 text-blue-400" />
        </motion.div>
      </motion.div>
    </section>
  );
}
