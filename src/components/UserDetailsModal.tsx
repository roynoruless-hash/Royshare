import { X, Shield, ShieldAlert, Ban, MessageSquare } from "lucide-react";

export default function UserDetailsModal({ user, onClose, onAction }: { user: any, onClose: () => void, onAction: (id: string, action: string, input?: any) => void }) {
  if (!user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-6 my-8 max-h-[90vh] overflow-y-auto text-slate-100">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">👤 User Details</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded-full transition"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><label className="text-slate-500 font-bold uppercase text-[10px]">Name</label><p>{user.firstName} {user.lastName}</p></div>
          <div><label className="text-slate-500 font-bold uppercase text-[10px]">Username</label><p>@{user.username}</p></div>
          <div><label className="text-slate-500 font-bold uppercase text-[10px]">Telegram ID</label><p className="font-mono text-indigo-400">{user.id}</p></div>
          <div><label className="text-slate-500 font-bold uppercase text-[10px]">Balance</label><p className="font-bold text-emerald-400">₹{user.availableBalance}</p></div>
        </div>
        
        <div className="border-t border-slate-800 pt-4 flex gap-3">
            <button onClick={() => onAction(user.id, user.status === "Banned" ? "unban_user" : "ban_user")} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-bold ${user.status === "Banned" ? "bg-emerald-600" : "bg-red-600"}`}>
                {user.status === "Banned" ? <Shield size={16}/> : <Ban size={16}/>}
                {user.status === "Banned" ? "Unban" : "Ban User"}
            </button>
            <button onClick={() => onAction(user.id, "message_user")} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-bold bg-indigo-600">
                <MessageSquare size={16}/> Message
            </button>
        </div>
      </div>
    </div>
  );
}
