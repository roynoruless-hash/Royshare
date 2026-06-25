import { motion } from "motion/react";
import { Shield, Zap, Link2, BarChart3, Users, Gift, MessageSquare, Cloud } from "lucide-react";

const features = [
  { icon: Shield, title: "Secure File Sharing" },
  { icon: Zap, title: "Fast Downloads" },
  { icon: Link2, title: "Smart URL Shortener" },
  { icon: BarChart3, title: "Analytics Dashboard" },
  { icon: Users, title: "Referral System" },
  { icon: Gift, title: "Reward Earnings" },
  { icon: MessageSquare, title: "Telegram Integration" },
  { icon: Cloud, title: "Cloud Storage" },
];

export default function Features() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto text-center mb-16">
        <h2 className="text-4xl md:text-5xl font-display font-medium text-white mb-6">Premium Features</h2>
      </div>
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature, index) => (
          <motion.div
            key={index}
            whileHover={{ y: -10 }}
            className="p-8 bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 hover:border-blue-500/50 transition-all group"
          >
            <feature.icon className="w-10 h-10 text-blue-400 mb-6 group-hover:text-purple-400" />
            <h3 className="text-xl font-medium text-white mb-2">{feature.title}</h3>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
