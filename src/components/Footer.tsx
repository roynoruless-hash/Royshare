import { motion } from "motion/react";
import { Instagram, Facebook, Send } from "lucide-react";

export default function Footer() {
  return (
    <footer className="pt-20 pb-12 px-6 bg-slate-950 border-t border-white/5 relative">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
      
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
        <div className="md:col-span-2 space-y-4">
          <div className="text-2xl font-display font-medium text-white">TeleShare</div>
          <p className="text-slate-400 max-w-sm">Secure Telegram File Sharing & URL Shortener Platform. Fast, reliable, and built for creators.</p>
        </div>
        
        <div className="space-y-4">
          <h4 className="font-medium text-white">Quick Links</h4>
          <ul className="space-y-2 text-slate-400">
            <li><a href="#" className="hover:text-blue-400 transition-colors">Home</a></li>
            <li><a href="#" className="hover:text-blue-400 transition-colors">Features</a></li>
            <li><a href="#" className="hover:text-blue-400 transition-colors">Terms</a></li>
            <li><a href="#" className="hover:text-blue-400 transition-colors">Privacy</a></li>
            <li><a href="#" className="hover:text-blue-400 transition-colors">Contact</a></li>
          </ul>
        </div>

        <div className="space-y-4">
          <h4 className="font-medium text-white">Social</h4>
          <div className="flex gap-4">
            {[Instagram, Facebook, Send].map((Icon, i) => (
              <motion.a 
                key={i} 
                href="#" 
                whileHover={{ y: -5 }}
                className="p-3 bg-white/5 rounded-full hover:bg-blue-500/20 transition-colors text-slate-400 hover:text-blue-400"
              >
                <Icon className="w-5 h-5" />
              </motion.a>
            ))}
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto pt-8 border-t border-white/5 text-center text-slate-600 text-sm">
        © 2026 TeleShare. All Rights Reserved.
      </div>
    </footer>
  );
}
