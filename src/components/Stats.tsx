import { motion, useSpring, useTransform, animate } from "motion/react";
import { useEffect } from "react";
import { Users, Folder, Download, Link2 } from "lucide-react";

function CounterCard({ value, label, icon: Icon }: { value: number; label: string; icon: any }) {
  const count = useSpring(0, { duration: 3 });
  
  useEffect(() => {
    animate(0, value, {
      duration: 3,
      onUpdate: (latest) => count.set(latest),
    });
  }, [value, count]);

  const display = useTransform(count, (latest) => {
    if (latest >= 1000000) return (latest / 1000000).toFixed(1) + "M+";
    if (latest >= 1000) return Math.round(latest / 1000) + "K+";
    return Math.round(latest).toString();
  });

  return (
    <motion.div
      whileHover={{ y: -10 }}
      className="relative p-8 rounded-3xl bg-slate-900/50 border border-white/10 backdrop-blur-md overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10 flex flex-col gap-4">
        <div className="p-3 w-fit rounded-2xl bg-white/5 border border-white/10 group-hover:bg-blue-500/20 transition-colors">
          <Icon className="w-8 h-8 text-blue-400" />
        </div>
        <div className="text-3xl font-display font-medium text-white">
          <motion.span>{display}</motion.span>
        </div>
        <div className="text-slate-400 text-sm font-medium uppercase tracking-wider">{label}</div>
      </div>
    </motion.div>
  );
}

export default function Stats() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <CounterCard value={50000} label="Active Users" icon={Users} />
        <CounterCard value={120000} label="Files Shared" icon={Folder} />
        <CounterCard value={3500000} label="Downloads" icon={Download} />
        <CounterCard value={950000} label="Links Generated" icon={Link2} />
      </div>
    </section>
  );
}
