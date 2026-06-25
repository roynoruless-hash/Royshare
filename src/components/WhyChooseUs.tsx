import { motion } from "motion/react";
import { ShieldCheck, Gauge, Server, Lock, Clock } from "lucide-react";

const reasons = [
  { icon: ShieldCheck, title: "Secure Platform" },
  { icon: Gauge, title: "Fast Performance" },
  { icon: Server, title: "Reliable Infrastructure" },
  { icon: Lock, title: "User Privacy Protection" },
  { icon: Clock, title: "24/7 Availability" },
];

export default function WhyChooseUs() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-display font-medium text-white mb-16 text-center">
          Why Choose Us
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
          {reasons.map((reason, index) => (
            <motion.div
              key={index}
              whileHover={{ scale: 1.05 }}
              className="p-6 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 flex flex-col items-center text-center"
            >
              <reason.icon className="w-10 h-10 text-purple-400 mb-4" />
              <h3 className="text-lg font-medium text-white">{reason.title}</h3>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
