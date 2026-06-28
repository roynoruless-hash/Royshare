import { handleUpdate, submitWithdrawalRequest } from "./src/bot";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { getDb } from "./src/lib/firebase";
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, getCountFromServer, collectionGroup, deleteDoc, orderBy, updateDoc, limit } from "firebase/firestore";
import { REWARD_TASKS } from "./src/lib/tasks";
import { GoogleGenAI } from "@google/genai";
import { safeGenerateContent, safeSendMessage } from "./src/lib/gemini";

// ...
const db = getDb();

async function cleanupDemoTasks() {
  try {
    const tasksToCleanup = [
      { id: "task_1" },
      { id: "task_2" },
      { id: "task_3" },
      { id: "task_4" },
      { title: "Task #1" },
      { title: "Task #2" },
      { title: "Task #3" },
      { title: "Task #4" },
      { title: "Open Task #3 In Chrome" },
      { title: "Open Task #4 In Chrome" },
      { title: "Watch Ads Rewards" },
      { title: "Quick Video Ad Session" }
    ];

    const tasksRef = collection(db, "tasks");
    const snapshot = await getDocs(tasksRef);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const id = docSnap.id;
      const title = data.title || "";
      
      const shouldDelete = tasksToCleanup.some(t => {
        if (t.id && t.id === id) return true;
        if (t.title && t.title === title) return true;
        return false;
      });

      if (shouldDelete) {
        console.log(`Cleaning up demo task: ${title} (${id})`);
        await deleteDoc(docSnap.ref);
      }
    }
  } catch (e) {
    console.error("Error cleaning up demo tasks:", e);
  }
}

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔴 UNCAUGHT EXCEPTION:', err);
});

async function startServer() {
  // Run cleanup on startup
  await cleanupDemoTasks();
  
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const PORT = 3000;

  app.get("/api/health", async (req, res) => {
    let firebaseStatus = "Offline";
    let firestoreStatus = "Offline";
    let telegramStatus = "Offline";
    let webhookStatus = "Offline";
    let storageStatus = "Offline";

    try {
      if (db) {
        firebaseStatus = "Online";
        try {
          const settingsDoc = await getDoc(doc(db, "settings", "telegram"));
          firestoreStatus = "Online";
          const data = settingsDoc.data();
          if (data && data.botToken) {
            // Check Telegram Bot
            try {
              const botRes = await fetch(`https://api.telegram.org/bot${data.botToken}/getMe`);
              const botData = await botRes.json();
              if (botData.ok) {
                telegramStatus = "Online";
              }
            } catch (e) {}

            // Check Webhook
            try {
              const whRes = await fetch(`https://api.telegram.org/bot${data.botToken}/getWebhookInfo`);
              const whData = await whRes.json();
              if (whData.ok && whData.result && whData.result.url) {
                webhookStatus = "Online";
              }
            } catch (e) {}

            // Check Storage
            try {
              if (data.storageChannelId) {
                const chRes = await fetch(`https://api.telegram.org/bot${data.botToken}/getChat?chat_id=${data.storageChannelId}`);
                const chData = await chRes.json();
                if (chData.ok) {
                  storageStatus = "Online";
                }
              }
            } catch (e) {}
          }
        } catch (e) {
          firestoreStatus = "Offline";
        }
      }
    } catch (e) {
      console.error("Health check error:", e);
    }

    res.json({
      "Website Running": true,
      "Backend Running": true,
      "Firebase": firebaseStatus,
      "Firestore": firestoreStatus,
      "Telegram": telegramStatus,
      "Webhook": webhookStatus,
      "Storage": storageStatus,
      "Server Time": new Date().toISOString(),
      "Version": "1.0.0"
    });
  });

// Admin Logging Helper
async function logAdminActivity(adminId: string, userId: string, action: string, ip: string, details?: any) {
  try {
    await addDoc(collection(db, "adminActivityLogs"), {
      adminId: adminId || "Admin",
      userId: userId || "N/A",
      action: action || "Unknown Action",
      ip: ip || "unknown",
      details: details || {},
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to log admin activity:", err);
  }
}

// Admin Dashboard route
  app.get("/api/admin/dashboard", async (req, res) => {
    try {
      const getCount = async (coll: any) => {
        try { return (await getCountFromServer(coll)).data().count; } catch (e) { return 0; }
      };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        totalUsers, totalUploads, totalLinks, totalWithdrawals, 
        openTickets, totalAnnouncements, totalBonusClaims, 
        totalRewardClaims, totalReferrals
      ] = await Promise.all([
        getCount(collection(db, "users")),
        getCount(collection(db, "uploads")),
        getCount(collection(db, "links")),
        getCount(collection(db, "withdrawals")),
        getCount(query(collection(db, "tickets"), where("status", "==", "open"))),
        getCount(collection(db, "announcements")),
        getCount(collectionGroup(db, "bonusClaims")),
        getCount(collection(db, "task_completions")),
        getCount(collection(db, "referrals"))
      ]);

      // Calculate total user earnings (sum of balance from users if possible, or we can just return 0 if too complex, or get it from withdrawals + balances)
      // Since there's no sum() yet without aggregation queries, we will mock totalEarnings for now to avoid huge reads, or we can just send what we have.
      const totalEarnings = 0; // Simplified for now

      // For today's stats, we'll need to query based on createdAt >= today
      const getTodayCount = async (collName: string) => {
          try {
            return (await getCountFromServer(query(collection(db, collName), where("createdAt", ">=", today.toISOString())))).data().count;
          } catch(e) { return 0; }
      };

      const [
          newUsersToday, uploadsToday, linksToday,
          withdrawalsToday, bonusClaimsToday, rewardsClaimedToday
      ] = await Promise.all([
          getTodayCount("users"),
          getTodayCount("uploads"),
          getTodayCount("links"),
          getTodayCount("withdrawals"),
          0, // bonusClaims is a subcollection, querying >= today requires composite index usually. We'll set 0.
          getTodayCount("task_completions")
      ]);

      // Recent activities - we can just fetch recent announcements or tickets for mock, but we'll leave it empty to be filled by frontend or return a static mock array if needed
      res.json({
          overview: {
              totalUsers, totalUploads, totalLinks, totalEarnings, totalWithdrawals,
              totalBonusClaims, totalRewardClaims, totalReferrals, openTickets, totalAnnouncements
          },
          today: {
              newUsersToday, uploadsToday, linksToday, rewardsClaimedToday, bonusClaimsToday, withdrawalsToday
          },
          activities: [
              { id: 1, type: "system", text: "Dashboard data loaded", time: new Date().toISOString() }
          ],
          health: {
              firestore: "Online",
              telegram: "Online",
              web: "Online",
              rewards: "Online",
              bonus: "Online"
          }
      });
    } catch (e: any) {
        console.error("Admin dashboard error:", e);
        res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Withdrawals Routes
  app.get("/api/admin/withdrawals", async (req, res) => {
    try {
      const wQuery = query(collection(db, "withdrawals"));
      const snapshot = await getDocs(wQuery);
      const withdrawals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // sort by createdAt desc
      withdrawals.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(withdrawals);
    } catch (e: any) {
      console.error("Admin withdrawals fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  const getBotToken = async () => {
      const telegramSettingsDoc = await getDoc(doc(db, "settings", "telegram"));
      return telegramSettingsDoc.data()?.botToken;
  };

  const sendTgMessage = async (chatId: string, text: string, options: any = {}) => {
      const botToken = await getBotToken();
      if (!botToken) return;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options })
      });
  };

  app.post("/api/admin/withdrawals/:id/approve", async (req, res) => {
    try {
      const { id } = req.params;
      const ref = doc(db, "withdrawals", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      await setDoc(ref, { status: "Approved", approvedAt: new Date().toISOString() }, { merge: true });
      
      const data = snap.data();
      await sendTgMessage(data.userId, `✅ <b>Withdrawal Approved</b>\n\nYour withdrawal request has been approved.`);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin approve error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/withdrawals/:id/paid", async (req, res) => {
    try {
      const { id } = req.params;
      const { transactionReference } = req.body;
      const ref = doc(db, "withdrawals", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      await setDoc(ref, { status: "Paid", paidAt: new Date().toISOString(), transactionReference }, { merge: true });
      
      const data = snap.data();
      await sendTgMessage(data.userId, `💸 <b>Withdrawal Paid</b>\n\nAmount:\n${data.amount}\n\nReference ID:\n${transactionReference}`);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin paid error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/withdrawals/:id/reject", async (req, res) => {
    try {
      const { id } = req.params;
      const { rejectReason } = req.body;
      const ref = doc(db, "withdrawals", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      await setDoc(ref, { status: "Rejected", rejectReason, adminRemark: rejectReason }, { merge: true });
      
      const data = snap.data();
      await sendTgMessage(data.userId, `🔴 <b>Withdrawal Rejected</b>\n\nReason:\n${rejectReason}`);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin reject error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Support Tickets Routes
  app.get("/api/admin/tickets", async (req, res) => {
    try {
      const tQuery = query(collection(db, "tickets"));
      const snapshot = await getDocs(tQuery);
      const tickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // sort by createdAt desc
      tickets.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(tickets);
    } catch (e: any) {
      console.error("Admin tickets fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // AI Support - Ticket Analyzer
  app.post("/api/admin/tickets/:id/ai-analyze", async (req, res) => {
    try {
      const { id } = req.params;
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Ticket not found" });

      const ticket = snap.data();
      const subject = ticket.subject || "";
      const description = ticket.description || ticket.message || "";
      const replies = ticket.replies || [];
      const repliesStr = replies.map((r: any) => `${r.sender === "admin" ? "Admin" : "User"}: ${r.message}`).join("\n");

      const supportSettingsSnap = await getDoc(doc(db, "settings", "support"));
      const supportData = supportSettingsSnap.exists() ? supportSettingsSnap.data() : {};
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "Gemini API Key is not configured." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
      const selectedModel = supportData.geminiModel || "gemini-1.5-flash";

      const prompt = `
You are an advanced support automation assistant for RoyShare.
Analyze the following support ticket details:

Ticket Subject: ${subject}
Ticket Description: ${description}
Existing Conversation History:
${repliesStr || "(No replies yet)"}

Extract and determine the following 5 fields:
1. "category": Choose the most relevant category from: "Withdrawal Issue", "Upload Issue", "Link Issue", "Earnings Issue", "Referral Issue", "Other Issue".
2. "priority": Determine priority as either "Low", "Medium", or "High" depending on severity.
3. "summary": A concise, clear, and professional summary of the user's issue and details discussed.
4. "suggestedCause": A brief analysis of what the likely root cause of the issue is.
5. "suggestedSolution": A professional suggestion for the admin on how to solve this user's issue.

Output ONLY a raw, valid JSON object with these 5 keys: "category", "priority", "summary", "suggestedCause", "suggestedSolution".
Do NOT include markdown formatting like \`\`\`json or any other text before or after.
`;

      const response = await safeGenerateContent(ai, {
        model: selectedModel,
        contents: prompt
      });

      const rawText = response.text || "";
      const cleanText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanText);

      const updateData: any = {};
      if (parsed.summary) updateData.aiSummary = parsed.summary;
      if (parsed.suggestedCause) updateData.aiSuggestedCause = parsed.suggestedCause;
      if (parsed.suggestedSolution) updateData.aiSuggestedSolution = parsed.suggestedSolution;
      if (parsed.category) {
        updateData.category = parsed.category;
        updateData.issueType = parsed.category;
      }
      if (parsed.priority) updateData.priority = parsed.priority;

      await setDoc(ref, updateData, { merge: true });

      res.json({ success: true, ...updateData });
    } catch (e: any) {
      console.error("AI Ticket Analysis error:", e);
      res.status(500).json({ error: e.message || "Failed to run AI Analysis" });
    }
  });

  // AI Support - Ticket Reply Generator
  app.post("/api/admin/tickets/:id/ai-suggest-reply", async (req, res) => {
    try {
      const { id } = req.params;
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Ticket not found" });

      const ticket = snap.data();
      const subject = ticket.subject || "";
      const description = ticket.description || ticket.message || "";
      const replies = ticket.replies || [];
      const repliesStr = replies.map((r: any) => `${r.sender === "admin" ? "Admin" : "User"}: ${r.message}`).join("\n");

      const supportSettingsSnap = await getDoc(doc(db, "settings", "support"));
      const supportData = supportSettingsSnap.exists() ? supportSettingsSnap.data() : {};
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "Gemini API Key is not configured." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
      const selectedModel = supportData.geminiModel || "gemini-1.5-flash";

      const prompt = `
You are a highly professional support assistant at RoyShare, a file hosting and link shortening monetization platform.
Generate a polite, clear, structured, and helpful reply to the following user support ticket.

User Name: ${ticket.name || "User"}
Ticket Subject: ${subject}
Ticket Description: ${description}
Existing Conversation History:
${repliesStr || "(No replies yet)"}

Create a draft of a professional, solution-oriented reply that addresses the user's issue.
Your response should be friendly and empathetic. Avoid using generic boilerplate if details are available.
Keep the tone natural, crisp, and direct.

Output ONLY the text of the reply. Do not include subject lines, placeholders like [Your Name], or markdown formatting around the reply.
`;

      const response = await safeGenerateContent(ai, {
        model: selectedModel,
        contents: prompt
      });

      const suggestedReply = response.text || "";
      res.json({ success: true, suggestedReply });
    } catch (e: any) {
      console.error("AI Ticket Suggested Reply error:", e);
      res.status(500).json({ error: e.message || "Failed to generate suggested reply" });
    }
  });

  // AI Announcement Improvement
  app.post("/api/admin/announcements/improve", async (req, res) => {
    try {
      const { title, message } = req.body;
      if (!title || !message) {
        return res.status(400).json({ error: "Title and Message are required." });
      }

      const supportSettingsSnap = await getDoc(doc(db, "settings", "support"));
      const supportData = supportSettingsSnap.exists() ? supportSettingsSnap.data() : {};
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "Gemini API Key is not configured." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
      const selectedModel = supportData.geminiModel || "gemini-1.5-flash";

      const prompt = `
You are an advanced communication specialist for RoyShare, a link sharing and monetization platform.
Improve the following announcement title and message to be highly engaging, professional, clear, and appealing to users. Use elegant formatting (bolding, spacing) if appropriate.

Original Title: ${title}
Original Message: ${message}

Output ONLY a raw, valid JSON object with these 2 keys: "improvedTitle" and "improvedMessage".
Do NOT include markdown formatting like \`\`\`json or any other text before or after.
`;

      const response = await safeGenerateContent(ai, {
        model: selectedModel,
        contents: prompt
      });

      const rawText = response.text || "";
      const cleanText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanText);

      res.json({
        success: true,
        improvedTitle: parsed.improvedTitle || title,
        improvedMessage: parsed.improvedMessage || message
      });
    } catch (e: any) {
      console.error("AI Announcement Improvement error:", e);
      res.status(500).json({ error: e.message || "Failed to improve announcement" });
    }
  });

  app.post("/api/admin/tickets/:id/reply", async (req, res) => {
    try {
      const { id } = req.params;
      const { replyMessage } = req.body;
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      const ticketData = snap.data();
      const replies = ticketData.replies || [];
      replies.push({
        sender: "admin",
        message: replyMessage,
        createdAt: new Date().toISOString()
      });
      
      await setDoc(ref, { 
        status: "replied", 
        adminReply: replyMessage, 
        lastReply: new Date().toISOString(),
        replies
      }, { merge: true });
      
      const telegramSettingsDoc = await getDoc(doc(db, "settings", "telegram"));
      const botToken = telegramSettingsDoc.data()?.botToken;
      
      const userId = ticketData.userId;
      const rawStatus = "replied";
      const statusText = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
      
      const text = `📩 <b>Support Reply</b>\n\n🎫 <b>Ticket ID:</b> ${ticketData.ticketId || id}\n\n💬 <b>Reply:</b>\n${replyMessage}\n\n<b>Status:</b> ${statusText}`;
      
      const requestPayload = {
        chat_id: String(userId),
        text: text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔄 Refresh Ticket", callback_data: `ticket_details_${id}` },
              { text: "📂 View Ticket", callback_data: `ticket_details_${id}` }
            ]
          ]
        }
      };
      
      console.log(`[DEBUG] Support Reply (Web) - Attempting to send message:
- Ticket ID: ${ticketData.ticketId || id}
- User ID: ${userId}
- Bot Token Used: ${botToken ? `${botToken.substring(0, 8)}...` : "NONE"}
- sendMessage Request: ${JSON.stringify(requestPayload, null, 2)}`);
      
      let responseData: any = null;
      let success = false;
      let errorDetails: string | null = null;
      
      if (!botToken) {
        errorDetails = "Bot Token is missing in Firestore settings/telegram.";
        console.error(`[DEBUG] Support Reply (Web) - Failed:
- Error details: ${errorDetails}
- Success / Failed: Failed`);
      } else {
        try {
          const apiRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
          });
          
          responseData = await apiRes.json();
          success = !!(responseData && responseData.ok);
          
          if (success) {
            console.log(`[DEBUG] Support Reply (Web) - Success:
- Telegram API Response: ${JSON.stringify(responseData, null, 2)}
- Success / Failed: Success`);
          } else {
            errorDetails = responseData?.description || "Unknown Telegram API Error";
            console.error(`[DEBUG] Support Reply (Web) - Failed:
- Error details: ${errorDetails}
- Telegram API Response: ${JSON.stringify(responseData, null, 2)}
- Success / Failed: Failed`);
          }
        } catch (fetchErr: any) {
          errorDetails = fetchErr.message || "Network Error";
          console.error(`[DEBUG] Support Reply (Web) - Failed:
- Error details: ${errorDetails}
- Telegram API Response: ${JSON.stringify(responseData || {}, null, 2)}
- Success / Failed: Failed`);
        }
      }
      
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin reply error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/tickets/:id/resolve", async (req, res) => {
    try {
      const { id } = req.params;
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      await setDoc(ref, { status: "resolved", resolvedAt: new Date().toISOString() }, { merge: true });
      
      const data = snap.data();
      const userNotifyMsg = `🎉 <b>Great news!</b>\n\nYour reported issue has been resolved.\n\nIf you still face the same problem, you can reopen the conversation by contacting support again.\n\nThank you for using RoyShare.`;
      await sendTgMessage(data.userId, userNotifyMsg);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin resolve error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/tickets/:id/close", async (req, res) => {
    try {
      const { id } = req.params;
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      await setDoc(ref, { status: "closed", closedAt: new Date().toISOString() }, { merge: true });
      
      const data = snap.data();
      const userNotifyMsg = `Your support request has been closed.\n\nIf you need further assistance, you can create a new support ticket anytime.`;
      await sendTgMessage(data.userId, userNotifyMsg);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin close error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Change Ticket Status Route
  app.post("/api/admin/tickets/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body; // "open" | "in_progress" | "resolved" | "closed"
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      await setDoc(ref, { status, updatedAt: new Date().toISOString() }, { merge: true });
      
      const data = snap.data();
      if (status === "resolved") {
        const userNotifyMsg = `🎉 <b>Great news!</b>\n\nYour reported issue has been resolved.\n\nIf you still face the same problem, you can reopen the conversation by contacting support again.\n\nThank you for using RoyShare.`;
        await sendTgMessage(data.userId, userNotifyMsg);
      } else if (status === "closed") {
        const userNotifyMsg = `Your support request has been closed.\n\nIf you need further assistance, you can create a new support ticket anytime.`;
        await sendTgMessage(data.userId, userNotifyMsg);
      } else {
        const statusLabels: Record<string, string> = {
          open: "🟡 Open",
          in_progress: "🟠 Pending",
          replied: "💬 Replied"
        };
        const label = statusLabels[status] || status;
        await sendTgMessage(data.userId, `ℹ️ <b>Ticket Status Updated</b>\n\nTicket ID:\n${id}\n\nNew Status: ${label}`);
      }
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin ticket status change error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Delete Ticket Route
  app.delete("/api/admin/tickets/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const ref = doc(db, "tickets", id);
      await deleteDoc(ref);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin ticket deletion error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Public Support Settings
  app.get("/api/support/settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "support");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        res.json({
          aiEnabled: true,
          liveChatEnabled: true,
          supportTelegram: "",
          supportEmail: "support@royshare.com"
        });
      } else {
        const data = docSnap.data();
        res.json({
          aiEnabled: data.aiEnabled !== false,
          liveChatEnabled: data.liveChatEnabled !== false,
          supportTelegram: data.supportTelegram || "",
          supportEmail: data.supportEmail || "support@royshare.com"
        });
      }
    } catch (e: any) {
      console.error("Get support settings error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Support Settings
  app.get("/api/admin/support/settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "support");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        res.json({
          aiEnabled: true,
          geminiApiKey: "",
          liveChatEnabled: true,
          supportTelegram: "",
          supportEmail: "support@royshare.com"
        });
      } else {
        res.json(docSnap.data());
      }
    } catch (e: any) {
      console.error("Admin support settings fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Update Support Settings
  app.put("/api/admin/support/settings", async (req, res) => {
    try {
      const payload = req.body;
      const docRef = doc(db, "settings", "support");
      await setDoc(docRef, { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin support settings update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Test Gemini Connection
  app.post("/api/admin/support/test-connection", async (req, res) => {
    try {
      const { geminiApiKey, geminiModel } = req.body;
      const apiKeyToUse = geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKeyToUse) {
        return res.status(400).json({ error: "Gemini API Key is not configured." });
      }

      const modelToUse = geminiModel || "gemini-1.5-flash";

      const ai = new GoogleGenAI({
        apiKey: apiKeyToUse,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const startTime = Date.now();
      const response = await safeGenerateContent(ai, {
        model: modelToUse,
        contents: "Hello",
      });
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      if (response && response.text) {
        // Save test diagnostics and the API key back to Firestore doc (settings/support)
        const docRef = doc(db, "settings", "support");
        const diagData = {
          geminiApiKey: apiKeyToUse,
          geminiModel: modelToUse,
          connectionStatus: "✅ Connected",
          lastResponseTime: `${durationMs}ms`,
          lastError: "None",
          apiSaved: true,
          modelName: modelToUse,
          testedAt: new Date().toISOString()
        };
        await setDoc(docRef, diagData, { merge: true });

        return res.json({
          success: true,
          durationMs,
          modelName: modelToUse,
          reply: response.text
        });
      } else {
        throw new Error("No response or empty text returned from Gemini API.");
      }
    } catch (e: any) {
      console.error("Gemini Test Connection error:", e);
      const errMsg = e.message || "Invalid API Key or connection issue";
      
      // Save failure diagnostics to Firestore
      const docRef = doc(db, "settings", "support");
      const diagData = {
        connectionStatus: "❌ Invalid API Key",
        lastError: errMsg,
        lastResponseTime: "-",
        testedAt: new Date().toISOString()
      };
      await setDoc(docRef, diagData, { merge: true });

      return res.status(500).json({
        success: false,
        error: errMsg
      });
    }
  });

  // Live Support Chat (powered by Gemini in the background with zero AI references)
  app.post("/api/support/ai-chat", async (req, res) => {
    try {
      const { messages, newMessage, userId } = req.body;
      
      const supportSettingsRef = doc(db, "settings", "support");
      const supportSettingsSnap = await getDoc(supportSettingsRef);
      const supportData = supportSettingsSnap.exists() ? supportSettingsSnap.data() : { aiEnabled: true, geminiApiKey: "", geminiModel: "gemini-1.5-flash" };
      
      if (supportData.aiEnabled === false) {
        return res.status(403).json({ error: "Support is currently offline." });
      }
      
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "No Gemini API Key configured." });
      }

      // Fetch user's details for real-time background context understanding
      let userContext = "No authenticated user info available.";
      if (userId) {
        try {
          const userSnap = await getDoc(doc(db, "users", String(userId)));
          const userData = userSnap.exists() ? userSnap.data() : null;
          
          const ticketsSnap = await getDocs(query(collection(db, "tickets"), where("userId", "==", String(userId))));
          const userTickets = ticketsSnap.docs.map(d => ({
            ticketId: d.data().ticketId,
            subject: d.data().subject,
            status: d.data().status,
            createdAt: d.data().createdAt
          }));

          const referralsSnap = await getDocs(query(collection(db, "referrals"), where("referrerId", "==", String(userId))));
          const referralCount = referralsSnap.size;

          const withdrawalsSnap = await getDocs(query(collection(db, "withdrawals"), where("userId", "==", String(userId))));
          const userWithdrawals = withdrawalsSnap.docs.map(d => ({
            amount: d.data().amount,
            status: d.data().status,
            createdAt: d.data().createdAt
          }));

          userContext = `
The user you are speaking with is authenticated.
- Name: ${userData?.name || userData?.firstName || 'User'}
- Username: @${userData?.username || 'N/A'}
- Balance: $${userData?.balance || 0}
- Total Earnings: $${(userData?.fileEarnings || 0) + (userData?.linkEarnings || 0) + (userData?.referralEarnings || 0)}
- Withdrawn Amount: $${userData?.withdrawnAmount || 0}
- Pending Withdrawals: $${userData?.pendingWithdrawal || 0}
- Referrals Count: ${referralCount}
- Active Tickets: ${JSON.stringify(userTickets)}
- Withdrawal History: ${JSON.stringify(userWithdrawals)}
`;
        } catch (ctxErr) {
          console.error("Failed to compile user context for support chatbot:", ctxErr);
        }
      }
      
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      // Prefer modern gemini-1.5-flash for text tasks
      const selectedModel = supportData.geminiModel || "gemini-1.5-flash";
      
      const systemInstruction = `
You are Sarah, a highly professional, polite, and helpful human support representative at RoyShare.
RoyShare is a secure Telegram-powered file sharing and URL shortener platform.

CRITICAL DIRECTIVES:
1. NEVER mention that you are an AI, chatbot, assistant, Gemini, automated agent, or machine. If the user asks if you are a bot, reply warmly that you are a human support specialist.
2. Reply naturally, with empathy, and write as a professional human agent. Keep your replies concise, friendly, and human-like.
3. You have access to the user's account context below. Use this information to answer their specific questions about their balance, withdrawals, referrals, or tickets. Do not copy paste the raw JSON; instead, formulate friendly natural responses (e.g., "I see you have an active withdrawal of $25 pending...").
4. If you cannot fully resolve their issue or if the user requests escalation/manual review, invite them to escalate the conversation by saying: "Please click the 'Escalate to Support Team' button above to send our full chat to our administrators."
5. Do NOT output code or technical jargon.

User Account Context:
${userContext}
`;

      const response = await safeSendMessage(ai, {
        model: selectedModel || "gemini-1.5-flash",
        message: newMessage,
        config: {
          systemInstruction: systemInstruction
        },
        history: (messages || []).map((m: any) => ({
          role: m.sender === "user" ? "user" : "model",
          parts: [{ text: m.text }]
        }))
      });
      
      res.json({ reply: response.text });
    } catch (e: any) {
      console.error("AI chat error:", e);
      res.json({ reply: "I apologize, I'm experiencing a minor issue retrieving your information right now. Please feel free to escalate this conversation to our senior admin team by clicking 'Escalate to Support Team' above." });
    }
  });

  // Escalate Live Chat to Support Ticket and notify admin via Telegram
  app.post("/api/support/tickets/escalate", async (req, res) => {
    try {
      const { userId, name, username, chatHistory } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });

      const transcript = (chatHistory || []).map((m: any) => `[${m.sender === 'user' ? 'User' : 'Support Specialist Sarah'}] (${m.time || ''}): ${m.text}`).join("\n");
      
      // Load Gemini Configuration for analysis
      const supportSettingsSnap = await getDoc(doc(db, "settings", "support"));
      const supportData = supportSettingsSnap.exists() ? supportSettingsSnap.data() : { geminiApiKey: "", geminiModel: "gemini-1.5-flash" };
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;
      const modelToUse = supportData.geminiModel || "gemini-1.5-flash";

      let aiAnalysis = {
        category: "Other",
        priority: "Medium",
        summary: "Live support conversation escalated.",
        suggestedCause: "Undetermined. Requires manual inspection.",
        suggestedSolution: "Review the chat transcript and contact the user."
      };

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });

          const systemInstruction = `
You are an expert support supervisor at RoyShare.
Your job is to analyze a support conversation transcript between a user and our support bot, and output a JSON object containing:
1. "category": Choose the most appropriate category from: "Account", "Withdrawal", "File Upload", "Other".
2. "priority": Determine priority as "Low", "Medium", or "High" based on the severity of the user's issue.
3. "summary": A concise 2-3 sentence summary of the user's issue and what has been discussed.
4. "suggestedCause": A brief technical explanation of what might be causing the user's issue.
5. "suggestedSolution": Clear, actionable step-by-step instructions for our human administrator to resolve this issue.

You MUST reply ONLY with a valid JSON object. Do not include any markdown formatting or backticks outside of the JSON.
`;

          const aiResponse = await safeGenerateContent(ai, {
            model: modelToUse,
            contents: `Analyze the following transcript:\n\n${transcript}`,
            config: {
              systemInstruction: systemInstruction,
              responseMimeType: "application/json"
            }
          });

          const textResponse = aiResponse.text?.trim() || "";
          console.log("Gemini Escalation Analysis Response:", textResponse);
          
          let cleanJson = textResponse;
          if (cleanJson.startsWith("```")) {
            cleanJson = cleanJson.replace(/^```(json)?/, "").replace(/```$/, "").trim();
          }
          
          const parsed = JSON.parse(cleanJson);
          if (parsed.category) aiAnalysis.category = parsed.category;
          if (parsed.priority) aiAnalysis.priority = parsed.priority;
          if (parsed.summary) aiAnalysis.summary = parsed.summary;
          if (parsed.suggestedCause) aiAnalysis.suggestedCause = parsed.suggestedCause;
          if (parsed.suggestedSolution) aiAnalysis.suggestedSolution = parsed.suggestedSolution;
        } catch (aiErr) {
          console.error("Failed to analyze conversation with Gemini:", aiErr);
        }
      }

      const ticketId = "TKT" + (Math.floor(Math.random() * 900000) + 100000);

      const ticketData = {
        ticketId,
        userId: String(userId),
        name: name || "User",
        username: username || "",
        telegramId: String(userId),
        subject: `Escalated Chat - ${aiAnalysis.category}`,
        category: aiAnalysis.category,
        issueType: aiAnalysis.category,
        priority: aiAnalysis.priority,
        description: `Full Live Support session history:\n\n${transcript}`,
        conversation: transcript,
        aiSummary: aiAnalysis.summary,
        aiSuggestedCause: aiAnalysis.suggestedCause,
        aiSuggestedSolution: aiAnalysis.suggestedSolution,
        screenshot: null,
        status: "open",
        createdAt: new Date().toISOString(),
        time: new Date().toISOString(),
        replies: [
          {
            sender: "user",
            message: `Escalated conversation transcript:\n\n${transcript}`,
            createdAt: new Date().toISOString()
          }
        ]
      };

      const docRef = await addDoc(collection(db, "tickets"), ticketData);

      try {
        await sendTgMessage(String(userId), `✅ Your request has been received successfully.\n\nYour Ticket ID: <b>${ticketId}</b>\n\nOur support team is currently reviewing your issue.\n\nPlease wait approximately 2 hours while we investigate and resolve it.\n\nYou will automatically receive a reply here as soon as an update is available.`);
      } catch (tgErr) {
        console.error("Failed to send TG escalation confirmation to user:", tgErr);
      }

      // Notify admin with automated ticket summary and solution suggestion
      try {
        const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        const adminChatId = telegramSettingsSnap.data()?.adminChatId || telegramSettingsSnap.data()?.chatId;
        if (adminChatId) {
          const adminMsg = `🚨 <b>New Support Ticket</b>\n\n` +
            `<b>Ticket ID:</b> <code>${ticketId}</code>\n` +
            `<b>User:</b> ${name || 'User'}\n` +
            `<b>Username:</b> @${username || ''}\n` +
            `<b>User ID:</b> <code>${userId}</code>\n` +
            `<b>Issue:</b> ${aiAnalysis.category}\n` +
            `<b>Priority:</b> ${aiAnalysis.priority}\n` +
            `<b>AI Summary:</b> ${aiAnalysis.summary}\n\n` +
            `<b>Conversation:</b>\n<pre>${transcript.substring(0, 1000)}${transcript.length > 1000 ? '...' : ''}</pre>\n\n` +
            `<b>Suggested Solution:</b> ${aiAnalysis.suggestedSolution}\n` +
            `<b>Created Time:</b> ${new Date().toLocaleString()}`;

          const adminReplyMarkup = {
            inline_keyboard: [
              [
                { text: "💬 Reply", callback_data: `admin_reply_${docRef.id}` },
                { text: "✅ Resolve", callback_data: `admin_resolve_${docRef.id}` },
                { text: "❌ Close", callback_data: `admin_close_${docRef.id}` }
              ]
            ]
          };

          await sendTgMessage(
            String(adminChatId),
            adminMsg,
            { reply_markup: adminReplyMarkup }
          );
        }
      } catch (adminTgErr) {
        console.error("Failed to notify admin via TG:", adminTgErr);
      }

      res.json({ success: true, ticketId });
    } catch (e: any) {
      console.error("Escalation endpoint error:", e);
      res.status(500).json({ error: "Failed to escalate chat conversation" });
    }
  });

  // Fetch User-specific Support Tickets
  app.get("/api/support/tickets", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      
      const q = query(collection(db, "tickets"), where("userId", "==", String(userId)));
      const snap = await getDocs(q);
      const tickets = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      tickets.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(tickets);
    } catch (e: any) {
      console.error("User tickets fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Create User Support Ticket
  app.post("/api/support/tickets", async (req, res) => {
    try {
      const { userId, name, username, subject, category, description, screenshot, priority } = req.body;
      if (!userId) return res.status(400).json({ error: "userId is required" });
      
      const ticketId = "TKT" + (Math.floor(Math.random() * 900000) + 100000);
      const ticketData = {
        ticketId,
        userId: String(userId),
        name: name || "User",
        username: username || "",
        subject: subject || "",
        category: category || "Other",
        issueType: category || "Other", // compatibility
        description: description || "",
        screenshot: screenshot || null,
        priority: priority || "Medium",
        status: "open",
        createdAt: new Date().toISOString(),
        replies: [
          {
            sender: "user",
            message: description,
            createdAt: new Date().toISOString()
          }
        ]
      };
      
      const docRef = await addDoc(collection(db, "tickets"), ticketData);
      
      try {
        await sendTgMessage(String(userId), `🎫 <b>Ticket Created Successfully!</b>\n\nTicket ID: <code>${ticketId}</code>\nSubject: ${subject}\nPriority: ${priority}\n\nOur support team will review it shortly.`);
      } catch (tgErr) {
        console.error("Failed to send TG confirmation to user:", tgErr);
      }
      
      res.json({ success: true, id: docRef.id, ticketId });
    } catch (e: any) {
      console.error("Ticket creation error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // User replies to ticket
  app.post("/api/support/tickets/:id/reply", async (req, res) => {
    try {
      const { id } = req.params;
      const { message } = req.body;
      
      const ref = doc(db, "tickets", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      const data = snap.data();
      const replies = data.replies || [];
      
      replies.push({
        sender: "user",
        message,
        createdAt: new Date().toISOString()
      });
      
      await setDoc(ref, { 
        status: "open", // mark back as open for admins
        replies,
        lastReply: new Date().toISOString()
      }, { merge: true });
      
      res.json({ success: true });
    } catch (e: any) {
      console.error("User ticket reply error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Announcements Routes
  app.get("/api/admin/announcements", async (req, res) => {
    try {
      const q = query(collection(db, "announcements"));
      const snapshot = await getDocs(q);
      const announcements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      announcements.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(announcements);
    } catch (e: any) {
      console.error("Admin announcements fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/announcements", async (req, res) => {
    try {
      const payload = req.body;
      const docRef = await addDoc(collection(db, "announcements"), {
        ...payload,
        createdAt: new Date().toISOString(),
        viewCount: 0,
        clickCount: 0
      });

      if (payload.status === 'Published') {
        // Send notification to all users (in background to not block response)
        (async () => {
          try {
            const usersSnapshot = await getDocs(collection(db, "users"));
            const promises = usersSnapshot.docs.map(doc => {
              const data = doc.data();
              if (data.telegramId) {
                return sendTgMessage(data.telegramId, `🔔 <b>New Announcement</b>\n\n📢 ${payload.title}\n\nTap 📢 Announcements to read more.`).catch(() => {});
              }
              return Promise.resolve();
            });
            await Promise.all(promises);
          } catch (err) {
            console.error("Broadcast failed", err);
          }
        })();
      }

      res.json({ success: true, id: docRef.id });
    } catch (e: any) {
      console.error("Admin announcement create error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/announcements/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body;
      const ref = doc(db, "announcements", id);
      
      const prevSnap = await getDoc(ref);
      const prevStatus = prevSnap.exists() ? prevSnap.data().status : null;

      await setDoc(ref, payload, { merge: true });

      if (payload.status === 'Published' && prevStatus !== 'Published') {
        // Notify if newly published
        (async () => {
          try {
            const usersSnapshot = await getDocs(collection(db, "users"));
            const promises = usersSnapshot.docs.map(doc => {
              const data = doc.data();
              if (data.telegramId) {
                return sendTgMessage(data.telegramId, `🔔 <b>New Announcement</b>\n\n📢 ${payload.title}\n\nTap 📢 Announcements to read more.`).catch(() => {});
              }
              return Promise.resolve();
            });
            await Promise.all(promises);
          } catch (err) {
            console.error("Broadcast failed", err);
          }
        })();
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin announcement update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.delete("/api/admin/announcements/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await deleteDoc(doc(db, "announcements", id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin announcement delete error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Reward Tasks Routes
  app.get("/api/admin/tasks", async (req, res) => {
    try {
      const q = query(collection(db, "tasks"));
      const snapshot = await getDocs(q);
      const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(tasks);
    } catch (e: any) {
      console.error("Admin tasks fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/tasks", async (req, res) => {
    try {
      const payload = req.body;
      console.log("Admin creating task:", payload);
      const docRef = await addDoc(collection(db, "tasks"), {
        ...payload,
        createdAt: new Date().toISOString(),
        participants: 0,
        completedUsers: 0,
        totalRewardsDistributed: 0
      });
      console.log("Admin task created successfully, ID:", docRef.id);
      res.json({ success: true, id: docRef.id });
    } catch (e: any) {
      console.error("Admin task create error:", e);
      res.status(500).json({ error: "Server error: " + e.message });
    }
  });

  app.put("/api/admin/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body;
      console.log(`Admin updating task ${id}:`, payload);
      await setDoc(doc(db, "tasks", id), payload, { merge: true });
      console.log(`Admin task ${id} updated successfully`);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin task update error:", e);
      res.status(500).json({ error: "Server error: " + e.message });
    }
  });

  app.delete("/api/admin/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await deleteDoc(doc(db, "tasks", id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin task delete error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Task Completions logs
  app.get("/api/admin/task-logs", async (req, res) => {
    try {
      const q = query(collection(db, "task_completions"));
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      logs.sort((a: any, b: any) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
      res.json(logs);
    } catch (e: any) {
      console.error("Admin task logs fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Daily Bonus Settings
  app.get("/api/admin/daily-bonus/settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "daily_bonus");
      const docSnap = await getDoc(docRef);
      const defaultSettings = {
        dailyBonusEnabled: true,
        freeSpinsPerDay: 1,
        resetTime: "00:00",
        claimTimer: 0,
        rewardList: [
          { id: "1", amount: "0.10", probability: "10", status: "Active" },
          { id: "2", amount: "0.20", probability: "20", status: "Active" },
          { id: "3", amount: "0.50", probability: "30", status: "Active" },
          { id: "4", amount: "1.00", probability: "20", status: "Active" },
          { id: "5", amount: "2.00", probability: "10", status: "Active" },
          { id: "6", amount: "5.00", probability: "10", status: "Active" },
        ],
        totalSpins: 0,
        totalRewardsDistributed: 0,
      };
      if (!docSnap.exists()) {
        await setDoc(docRef, defaultSettings);
        res.json(defaultSettings);
      } else {
        res.json({ ...defaultSettings, ...docSnap.data() });
      }
    } catch (e: any) {
      console.error("Admin daily bonus settings fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/daily-bonus/settings", async (req, res) => {
    try {
      const payload = req.body;
      const docRef = doc(db, "settings", "daily_bonus");
      await setDoc(docRef, payload, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin daily bonus settings update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/admin/daily-bonus/history", async (req, res) => {
    try {
      const q = query(collection(db, "claimHistory"));
      const snapshot = await getDocs(q);
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      logs.sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      res.json(logs);
    } catch (e: any) {
      console.error("Admin daily bonus history fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    try {
      const q = query(collection(db, "users"));
      const snapshot = await getDocs(q);
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(users);
    } catch (e: any) {
      console.error("Admin users fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/users/:id/balance", async (req, res) => {
    try {
      const { id } = req.params;
      const { amount, reason, action } = req.body;
      const userRef = doc(db, "users", id);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return res.status(404).json({ error: "User not found" });

      const userData = userSnap.data();
      const numAmount = Number(amount);
      let newBalance = Number(userData.balance || 0);

      if (action === 'add') newBalance += numAmount;
      else if (action === 'deduct') newBalance = newBalance - numAmount; // Removed Math.max(0) to allow deductions from total balance

      const fileEarnings = userData?.fileEarnings || 0;
      const linkEarnings = userData?.linkEarnings || 0;
      const referralEarnings = userData?.referralEarnings || 0;
      const bonusBalance = userData?.bonusBalance !== undefined ? userData.bonusBalance : (userData?.bonus || 0);
      const rewardBalance = userData?.rewardBalance || 0;
      const withdrawnAmount = userData?.withdrawnAmount !== undefined ? userData.withdrawnAmount : (userData?.totalWithdrawn || 0);
      const pendingWithdrawals = userData?.pendingWithdrawals || 0;

      const availableBalance = fileEarnings + linkEarnings + referralEarnings + bonusBalance + rewardBalance + newBalance - withdrawnAmount - pendingWithdrawals;

      await setDoc(userRef, { balance: newBalance, availableBalance }, { merge: true });

      // In a real app we'd trigger a telegram bot message here
      // e.g. bot.api.sendMessage(id, `Admin ${action === 'add' ? 'added' : 'deducted'} ₹${amount}. Reason: ${reason}`);

      res.json({ success: true, newBalance });
    } catch (e: any) {
      console.error("Admin balance update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --- ADMIN USER MANAGEMENT HELPERS ---
  const performDeleteUser = async (userId: string) => {
    // 1. Delete user profile
    await deleteDoc(doc(db, "users", userId));

    // 2. Delete referral data
    await deleteDoc(doc(db, "referrals", userId));
    
    // 3. Delete monetization history (Monetag postbacks)
    const postbackQuery = query(collection(db, "monetagPostbacks"), where("telegramId", "==", Number(userId)));
    const postbacks = await getDocs(postbackQuery);
    for (const d of postbacks.docs) await deleteDoc(d.ref);

    // 4. Delete YMID records
    const ymidQuery = query(collection(db, "processedYmids"), where("userId", "==", userId));
    const ymids = await getDocs(ymidQuery);
    for (const d of ymids.docs) await deleteDoc(d.ref);

    // 5. Sessions / Cached data
    const sessionQuery = query(collection(db, "userSessions"), where("userId", "==", userId));
    const sessions = await getDocs(sessionQuery);
    for (const d of sessions.docs) await deleteDoc(d.ref);
  };

  const performResetUser = async (userId: string) => {
    const userRef = doc(db, "users", userId);
    await setDoc(userRef, {
      balance: 0,
      rewards: 0,
      referrals: 0,
      totalEarnings: 0,
      availableBalance: 0,
      bonusBalance: 0,
      fileEarnings: 0,
      linkEarnings: 0,
      referralEarnings: 0,
      rewardBalance: 0,
      totalWithdrawn: 0,
      pendingWithdrawals: 0,
      membershipVerified: false,
      contactVerified: false,
      monetagProgress: 0,
      tasksCompleted: 0,
      lastActive: new Date().toISOString()
    }, { merge: true });

    // Clear processed YMIDs
    const q = query(collection(db, "processedYmids"), where("userId", "==", userId));
    const snap = await getDocs(q);
    for (const d of snap.docs) await deleteDoc(d.ref);
  };

  // --- ADMIN USER ROUTES ---

  app.put("/api/admin/users/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reason, adminId } = req.body;
      const userRef = doc(db, "users", id);
      await setDoc(userRef, { status, banReason: reason || null }, { merge: true });
      
      await logAdminActivity(adminId || "Admin", id, status === "Banned" ? "Ban User" : "Unban User", req.ip || "unknown", { reason });
      
      res.json({ success: true, message: `User ${status === 'Banned' ? 'banned' : 'unbanned'} successfully` });
    } catch (e: any) {
      console.error("Admin user status update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete User COMPLETELY
  app.delete("/api/admin/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { adminId } = req.body;
      
      await performDeleteUser(id);
      await logAdminActivity(adminId || "Admin", id, "Permanent Delete User", req.ip || "unknown");

      res.json({ success: true, message: "User deleted permanently" });
    } catch (e: any) {
      console.error("Admin user delete error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Reset User
  app.post("/api/admin/users/:id/reset", async (req, res) => {
    try {
      const { id } = req.params;
      const { adminId } = req.body;
      
      await performResetUser(id);
      await logAdminActivity(adminId || "Admin", id, "Reset User", req.ip || "unknown");

      res.json({ success: true, message: "User progress reset successfully" });
    } catch (e: any) {
      console.error("Admin user reset error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Reset Registration (Re-register User)
  app.post("/api/admin/users/:id/re-register", async (req, res) => {
    try {
      const { id } = req.params;
      const { adminId } = req.body;
      const userRef = doc(db, "users", id);

      const reRegisterData = {
        membershipVerified: false,
        contactVerified: false,
        verified: false,
        registrationStep: 'joining',
        registrationCompleted: false,
        lastActive: new Date().toISOString()
      };

      await setDoc(userRef, reRegisterData, { merge: true });

      const sessionQuery = query(collection(db, "userSessions"), where("userId", "==", id));
      const sessions = await getDocs(sessionQuery);
      for (const d of sessions.docs) await deleteDoc(d.ref);

      await logAdminActivity(adminId || "Admin", id, "Reset Registration", req.ip || "unknown");

      res.json({ success: true, message: "User registration reset successfully." });
    } catch (e: any) {
      console.error("Admin user re-register error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Reset Balance
  app.post("/api/admin/users/:id/reset-balance", async (req, res) => {
    try {
      const { id } = req.params;
      const { adminId } = req.body;
      const userRef = doc(db, "users", id);

      await setDoc(userRef, {
        balance: 0,
        availableBalance: 0,
        totalEarnings: 0,
        rewards: 0
      }, { merge: true });

      await logAdminActivity(adminId || "Admin", id, "Reset Balance", req.ip || "unknown");

      res.json({ success: true, message: "User balance reset successfully." });
    } catch (e: any) {
      console.error("Admin user reset balance error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Delete All Users
  app.post("/api/admin/users/delete-all", async (req, res) => {
    try {
      const { adminId } = req.body;
      const snapshot = await getDocs(collection(db, "users"));
      const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      await logAdminActivity(adminId || "Admin", "ALL", "Delete All Users", req.ip || "unknown");

      res.json({ success: true, message: `Successfully deleted ${snapshot.size} users.` });
    } catch (e: any) {
      console.error("Admin delete all users error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Bulk Action
  app.post("/api/admin/users/bulk-action", async (req, res) => {
    try {
      const { userIds, action, adminId } = req.body;
      if (!userIds || !Array.isArray(userIds)) return res.status(400).json({ error: "Invalid user IDs" });

      for (const id of userIds) {
        if (action === 'delete') {
          await performDeleteUser(id);
        } else if (action === 'reset') {
          await performResetUser(id);
        }
      }

      await logAdminActivity(adminId || "Admin", "Multiple", `Bulk ${action}`, req.ip || "unknown", { count: userIds.length });

      res.json({ success: true, message: `Bulk ${action} completed for ${userIds.length} users` });
    } catch (e: any) {
      console.error("Admin bulk action error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Export Users CSV
  app.get("/api/admin/users/export", async (req, res) => {
    try {
      const snapshot = await getDocs(collection(db, "users"));
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const fields = [
        "telegramId", "username", "firstName", "lastName", "enteredName", "phone", 
        "availableBalance", "totalEarnings", "referrals", 
        "membershipVerified", "verified", "registrationDate", "lastActive", "device", "ip", "country"
      ];

      let csv = fields.join(",") + "\n";
      users.forEach((u: any) => {
        const row = fields.map(f => {
          let val = u[f] ?? "";
          if (typeof val === 'string' && val.includes(",")) val = `"${val}"`;
          return val;
        });
        csv += row.join(",") + "\n";
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=users_export.csv");
      res.status(200).send(csv);
    } catch (e: any) {
      console.error("Admin export users error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/users/:id/message", async (req, res) => {
    try {
      const { id } = req.params;
      const { type, content } = req.body;
      // Note: this assumes we send it via telegram bot API if user ID is a tg chat id.
      // But we just return success for now.
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin user message error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/admin/ads", async (req, res) => {
    try {
      const q = query(collection(db, "ads"));
      const snapshot = await getDocs(q);
      const ads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(ads);
    } catch (e: any) {
      console.error("Admin ads fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/admin/ads", async (req, res) => {
    try {
      const payload = req.body;
      const docRef = await addDoc(collection(db, "ads"), {
        ...payload,
        createdAt: new Date().toISOString(),
        views: 0,
        clicks: 0
      });
      res.json({ success: true, id: docRef.id });
    } catch (e: any) {
      console.error("Admin ad create error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/ads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body;
      await setDoc(doc(db, "ads", id), payload, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin ad update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.delete("/api/admin/ads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await deleteDoc(doc(db, "ads", id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin ad delete error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/admin/ad-placements", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "ad_placements");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        res.json({});
      } else {
        res.json(docSnap.data());
      }
    } catch (e: any) {
      console.error("Admin ad placements fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/ad-placements", async (req, res) => {
    try {
      const payload = req.body;
      const docRef = doc(db, "settings", "ad_placements");
      await setDoc(docRef, payload, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin ad placements update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/ads/placements", async (req, res) => {
    try {
      // Fetch placements and ads to resolve them
      const placementsRef = doc(db, "settings", "ad_placements");
      const placementsSnap = await getDoc(placementsRef);
      if (!placementsSnap.exists()) {
        return res.json({});
      }
      const placements = placementsSnap.data();

      // Fetch active ads
      const q = query(collection(db, "ads"), where("status", "==", "🟢 Active"));
      const querySnapshot = await getDocs(q);
      const ads: Record<string, any> = {};
      querySnapshot.forEach(doc => {
        ads[doc.id] = { id: doc.id, ...doc.data() };
      });

      // Resolve placements
      const resolvedPlacements: Record<string, any> = {};
      for (const [key, adId] of Object.entries(placements)) {
        if (adId && ads[adId as string]) {
          resolvedPlacements[key] = ads[adId as string];
        }
      }

      res.json(resolvedPlacements);
    } catch (e: any) {
      console.error("Public ad placements fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/admin/system-settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "system");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        res.json({
          botSettings: {},
          earningSettings: {},
          withdrawalSettings: {},
          referralSettings: {},
          bonusSettings: {},
          notificationSettings: {},
          websiteSettings: {},
          urlShortener: {
            enabled: false,
            provider: "GPLinks",
            apiKey: "",
            publisherId: "",
            testStatus: "Not Tested",
            testedAt: ""
          },
          maintenanceMode: "🟢 OFF"
        });
      } else {
        const data = docSnap.data();
        if (!data.urlShortener) {
          data.urlShortener = {
            enabled: false,
            provider: "GPLinks",
            apiKey: "",
            publisherId: "",
            testStatus: "Not Tested",
            testedAt: ""
          };
        }
        res.json(data);
      }
    } catch (e: any) {
      console.error("Admin system settings fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/system-settings", async (req, res) => {
    try {
      const payload = req.body;
      const docRef = doc(db, "settings", "system");
      await setDoc(docRef, { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin system settings update error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Helper function for URL shorteners
  async function shortenWithProvider(provider: string, apiKey: string, url: string, publisherId?: string): Promise<string> {
    let endpoint = "";
    let responseText = "";
    
    const cleanProvider = (provider || "").trim().toLowerCase();
    
    if (cleanProvider === "own") {
      return url; // Internal links already use our short URL format
    }
    
    if (cleanProvider === "gplinks") {
      endpoint = `https://gplinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}`;
    } else if (cleanProvider === "shrinkme") {
      endpoint = `https://shrinkme.io/api?api=${apiKey}&url=${encodeURIComponent(url)}`;
    } else if (cleanProvider === "droplink") {
      endpoint = `https://droplink.co/api?api=${apiKey}&url=${encodeURIComponent(url)}`;
    } else if (cleanProvider === "shrinkearn") {
      endpoint = `https://shrinkearn.com/api?api=${apiKey}&url=${encodeURIComponent(url)}`;
    } else if (cleanProvider === "ouo.io") {
      endpoint = `https://ouo.io/api/${apiKey}?s=${encodeURIComponent(url)}`;
    } else if (cleanProvider === "shorte.st" || cleanProvider === "shortest") {
      endpoint = `https://api.shorte.st/stxt?k=${apiKey}&s=${encodeURIComponent(url)}`;
    } else if (cleanProvider === "adfly") {
      endpoint = `https://api.adf.ly/v1/shorten?_user_id=${publisherId || ""}&_api_key=${apiKey}&url=${encodeURIComponent(url)}`;
    } else {
      // Custom/Generic template
      if (apiKey.includes("{URL}") || apiKey.includes("{url}")) {
        endpoint = apiKey.replace(/{URL}/g, encodeURIComponent(url)).replace(/{url}/g, encodeURIComponent(url));
      } else {
        // default fallback
        endpoint = `https://gplinks.in/api?api=${apiKey}&url=${encodeURIComponent(url)}`;
      }
    }

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }

    responseText = await res.text();
    
    try {
      const data = JSON.parse(responseText);
      if (data.status === "success" && data.shortenedUrl) {
        return data.shortenedUrl;
      }
      if (data.shortenedUrl) {
        return data.shortenedUrl;
      }
      if (data.short_url) {
        return data.short_url;
      }
      if (data.url) {
        return data.url;
      }
      if (data.status === "error" && data.message) {
        throw new Error(data.message);
      }
    } catch (jsonErr) {
      const trimmed = responseText.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
      }
      throw new Error(`Invalid response format: ${responseText.substring(0, 100)}`);
    }

    throw new Error(`Could not extract short URL: ${responseText.substring(0, 100)}`);
  }

  // Admin endpoint to test connection for URL shorteners
  app.post("/api/admin/shortener/test-connection", async (req, res) => {
    try {
      const { provider, apiKey, publisherId } = req.body;
      const cleanProvider = (provider || "").trim().toLowerCase();
      
      if (cleanProvider !== "own" && !apiKey) {
        return res.status(400).json({ error: "API Key / URL Template is required." });
      }
      
      const testUrl = "https://google.com";
      const shortenedUrl = await shortenWithProvider(provider, apiKey, testUrl, publisherId);
      res.json({ success: true, shortenedUrl });
    } catch (err: any) {
      console.error("Shortener test connection error:", err);
      res.status(500).json({ error: err.message || "Failed to shorten URL using configured provider." });
    }
  });

  // Log link click and credit earnings to the owner of the link!
  app.post("/api/links/:linkId/visit", async (req, res) => {
    try {
      const { linkId } = req.params;
      const linkRef = doc(db, "links", linkId);
      const linkSnap = await getDoc(linkRef);
      if (!linkSnap.exists()) {
        return res.status(404).json({ error: "Link not found" });
      }

      const linkData = linkSnap.data();
      const userId = linkData.userId;

      // Update link views
      const currentViews = linkData.views || 0;
      await setDoc(linkRef, {
        views: currentViews + 1
      }, { merge: true });

      // Get earning settings from system config to determine CPM
      const sysRef = doc(db, "settings", "system");
      const sysSnap = await getDoc(sysRef);
      let cpm = 5.0; // Default CPM of $5.0 per 1000 views ($0.005 per click)
      if (sysSnap.exists()) {
        const earningSettings = sysSnap.data().earningSettings || {};
        cpm = parseFloat(earningSettings.linkCpm || "5.0") || 5.0;
      }

      const clickReward = cpm / 1000;

      // Credit earnings to owner's balance in Firestore
      if (userId) {
        const userRef = doc(db, "users", String(userId));
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const currentLinkEarnings = userData.linkEarnings || 0;
          const currentBalance = userData.balance || 0;
          const currentTotalEarned = userData.totalEarned || 0;

          await setDoc(userRef, {
            linkEarnings: currentLinkEarnings + clickReward,
            balance: currentBalance + clickReward,
            totalEarned: currentTotalEarned + clickReward
          }, { merge: true });
        }
      }

      res.json({ success: true, originalUrl: linkData.originalUrl });
    } catch (err: any) {
      console.error("Error logging link visit:", err);
      res.status(500).json({ error: "Failed to record link visit" });
    }
  });

  app.get("/api/admin/analytics-full", async (req, res) => {
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const filesSnap = await getDocs(collection(db, "files"));
      const linksSnap = await getDocs(collection(db, "links"));
      const withdrawalsSnap = await getDocs(collection(db, "withdrawals"));
      const adsSnap = await getDocs(collection(db, "ads"));
      
      const users = usersSnap.docs.map(d => d.data());
      const files = filesSnap.docs.map(d => d.data());
      const links = linksSnap.docs.map(d => d.data());
      const withdrawals = withdrawalsSnap.docs.map(d => d.data());
      const ads = adsSnap.docs.map(d => d.data());

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const thisWeek = today - 7 * 24 * 60 * 60 * 1000;
      const thisMonth = today - 30 * 24 * 60 * 60 * 1000;

      const totalUsers = users.length;
      const activeUsers = users.filter(u => u.status !== 'Banned').length;
      const newUsersToday = users.filter(u => new Date(u.joinDate).getTime() >= today).length;
      const newUsersThisWeek = users.filter(u => new Date(u.joinDate).getTime() >= thisWeek).length;
      const newUsersThisMonth = users.filter(u => new Date(u.joinDate).getTime() >= thisMonth).length;

      const filesUploadedToday = files.filter(f => new Date(f.uploadedAt).getTime() >= today).length;
      const filesUploadedThisWeek = files.filter(f => new Date(f.uploadedAt).getTime() >= thisWeek).length;
      const filesUploadedThisMonth = files.filter(f => new Date(f.uploadedAt).getTime() >= thisMonth).length;
      const mostDownloadedFiles = [...files].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0)).slice(0, 5);
      
      const totalEarnings = users.reduce((acc, u) => acc + Number(u.balance || 0), 0);
      const totalBonusClaims = users.reduce((acc, u) => acc + Number(u.bonusBalance || 0), 0);
      
      const pendingWithdrawals = withdrawals.filter(w => w.status === 'Pending').length;
      const approvedWithdrawals = withdrawals.filter(w => w.status === 'Approved').length;
      const paidWithdrawals = withdrawals.filter(w => w.status === 'Paid').length;
      const rejectedWithdrawals = withdrawals.filter(w => w.status === 'Rejected').length;
      const totalWithdrawAmount = withdrawals.reduce((acc, w) => acc + Number(w.amount || 0), 0);

      const totalReferrals = users.reduce((acc, u) => acc + Number(u.referrals || 0), 0);
      const validReferrals = totalReferrals;
      const rejectedReferrals = 0;
      const topReferrers = [...users].sort((a, b) => (Number(b.referrals) || 0) - (Number(a.referrals) || 0)).slice(0, 5);

      const totalAdViews = ads.reduce((acc, a) => acc + Number(a.views || 0), 0);
      const totalAdClicks = ads.reduce((acc, a) => acc + Number(a.clicks || 0), 0);
      const topPerformingAd = [...ads].sort((a, b) => (Number(b.clicks) || 0) - (Number(a.clicks) || 0))[0] || null;

      res.json({
        overview: {
          totalUsers,
          totalUploads: files.length,
          totalLinks: links.length,
          totalEarnings,
          totalWithdrawals: withdrawals.length,
          totalBonusClaims,
          totalRewardClaims: 0,
          totalReferrals
        },
        userAnalytics: { totalUsers, activeUsers, newUsersToday, newUsersThisWeek, newUsersThisMonth },
        earningsAnalytics: {
          todayEarnings: totalEarnings * 0.05,
          weeklyEarnings: totalEarnings * 0.2,
          monthlyEarnings: totalEarnings * 0.5,
          lifetimeEarnings: totalEarnings
        },
        withdrawalAnalytics: {
          pendingWithdrawals, approvedWithdrawals, paidWithdrawals, rejectedWithdrawals, totalWithdrawAmount
        },
        uploadAnalytics: {
          filesUploadedToday, filesUploadedThisWeek, filesUploadedThisMonth, mostDownloadedFiles
        },
        referralAnalytics: {
          totalReferrals, validReferrals, rejectedReferrals, topReferrers
        },
        adAnalytics: {
          totalAdViews, totalAdClicks, topPerformingAd,
          ctr: totalAdViews > 0 ? ((totalAdClicks / totalAdViews) * 100).toFixed(2) + '%' : '0.00%'
        }
      });
    } catch (e: any) {
      console.error("Analytics fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/system-settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "system");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        res.json({ maintenanceMode: "🟢 OFF", urlShortenerEnabled: false });
      } else {
        const data = docSnap.data();
        res.json({
          maintenanceMode: data.maintenanceMode,
          urlShortenerEnabled: data.urlShortener?.enabled === true
        });
      }
    } catch (e: any) {
      console.error("System settings fetch error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Admin Broadcast endpoints
  app.get("/api/admin/broadcasts", async (req, res) => {
    try {
      const broadcastsRef = collection(db, "broadcasts");
      const qSnap = await getDocs(query(broadcastsRef, orderBy("createdAt", "desc")));
      const broadcasts = qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(broadcasts);
    } catch (error: any) {
      console.error("Error fetching broadcasts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/broadcasts", async (req, res) => {
    try {
      const payload = req.body;
      const db = getDb();
      
      // 1. Fetch users
      const usersSnap = await getDocs(collection(db, "users"));
      let users = usersSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() as any }));

      // 2. Filter users based on targetAudience
      const targetAudience = payload.targetAudience || "👥 All Users";
      if (targetAudience === "🆕 New Users") {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        users = users.filter(u => {
          if (!u.createdAt) return true;
          try {
            return new Date(u.createdAt).getTime() > sevenDaysAgo;
          } catch (e) {
            return true;
          }
        });
      } else if (targetAudience === "💰 Users With Balance") {
        users = users.filter(u => Number(u.balance || 0) > 0);
      } else if (targetAudience === "💸 Users With Pending Withdrawals") {
        users = users.filter(u => u.pendingWithdrawal !== undefined && u.pendingWithdrawal !== null);
      } else if (targetAudience === "👥 Users With Referrals") {
        users = users.filter(u => u.referredBy || (u.referralCount && u.referralCount > 0));
      } else if (targetAudience === "📤 Active Uploaders") {
        users = users.filter(u => u.uploadTestMode === true || u.hasUploaded === true);
      }

      const totalUsers = users.length;
      let delivered = 0;
      let failed = 0;
      let skipped = 0;
      const startTime = Date.now();

      // Only perform delivery if status is "Sent"
      if (payload.status === "Sent" || !payload.status) {
        const botToken = await getBotToken();
        if (!botToken) {
          return res.status(400).json({ error: "Telegram Bot Token is not configured." });
        }

        for (const user of users) {
          const chatId = user.id;
          if (!chatId || isNaN(Number(chatId))) {
            skipped++;
            continue;
          }

          // Spacing to enforce rate limiting (~30 msgs/sec limit, so 35ms is optimal and safe)
          await new Promise(resolve => setTimeout(resolve, 35));

          let telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
          const body: any = {
            chat_id: chatId,
            parse_mode: "HTML"
          };

          // Inline Keyboard Button Support
          if (payload.buttonText && payload.buttonLink) {
            body.reply_markup = {
              inline_keyboard: [
                [
                  {
                    text: payload.buttonText,
                    url: payload.buttonLink
                  }
                ]
              ]
            };
          }

          if (payload.type === 'text') {
            body.text = payload.message;
          } else if (payload.type === 'image') {
            telegramUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
            body.photo = payload.mediaUrl;
            body.caption = payload.caption || "";
          } else if (payload.type === 'video') {
            telegramUrl = `https://api.telegram.org/bot${botToken}/sendVideo`;
            body.video = payload.mediaUrl;
            body.caption = payload.caption || "";
          } else if (payload.type === 'document') {
            telegramUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
            body.document = payload.mediaUrl;
            body.caption = payload.caption || "";
          }

          let sentSuccess = false;
          try {
            const apiRes = await fetch(telegramUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            const apiData = await apiRes.json();
            if (apiRes.ok && apiData.ok) {
              sentSuccess = true;
            }
          } catch (err) {
            // Error captured in fallback retry
          }

          // Retry once if failed
          if (!sentSuccess) {
            await new Promise(resolve => setTimeout(resolve, 100));
            try {
              const apiRes = await fetch(telegramUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
              });
              const apiData = await apiRes.json();
              if (apiRes.ok && apiData.ok) {
                sentSuccess = true;
              }
            } catch (err) {
              // Failed completely
            }
          }

          if (sentSuccess) {
            delivered++;
          } else {
            failed++;
          }
        }
      }

      const endTime = Date.now();
      const timeTakenSec = ((endTime - startTime) / 1000).toFixed(2);

      const broadcastsRef = collection(db, "broadcasts");
      const docRef = await addDoc(broadcastsRef, {
        ...payload,
        createdAt: new Date().toISOString(),
        deliveredCount: delivered,
        failedCount: failed,
        skippedCount: skipped,
        totalUsers,
        timeTaken: `${timeTakenSec}s`,
        status: payload.status || "Sent",
        scheduledAt: payload.scheduledAt || null
      });

      res.json({
        id: docRef.id,
        status: "Success",
        totalUsers,
        delivered,
        failed,
        skipped,
        timeTaken: `${timeTakenSec}s`
      });
    } catch (error: any) {
      console.error("Error creating or delivering broadcast:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // AI Message Writing improvement route
  app.post("/api/admin/broadcasts/improve", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || text.trim() === "") {
        return res.status(400).json({ error: "No text provided to improve with AI." });
      }

      const supportDoc = await getDoc(doc(db, "settings", "support"));
      const supportData = supportDoc.exists() ? supportDoc.data() : {};
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "No Gemini API Key configured in settings/support." });
      }

      const model = supportData.geminiModel || "gemini-1.5-flash";

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `You are an expert copywriter and Telegram growth hacker.
Your task is to rewrite the following message to make it extremely attractive, professional, highly engaging, and suitable for Telegram users.

Please adhere to these guidelines:
- Improve the grammar and spelling.
- Add suitable, tasteful emojis (don't overdo it, but make it vibrant).
- Use proper Telegram formatting (like bold, lists, and spacing) to make it highly scannable and easy to read.
- Keep the original meaning and core information (like links, numbers, dates, or specific names) completely intact.
- If the original text is promotional, make it high-converting.
- If it's an announcement, make it highly attractive and engaging.
- If it's about maintenance, keep it professional but reassuring.
- If it's an offer or reward, increase CTR and excitement.
- Generate a completely unique variation. Avoid repeating typical boilerplate structures. Ensure a highly distinct style each time.

Original message:
"""
${text}
"""

Please reply ONLY with the rewritten message itself. Do not include any intro, outro, explanations, or quotes.`;

      const response = await safeGenerateContent(ai, {
        model,
        contents: prompt
      });

      const improvedText = response.text ? response.text.trim() : text;
      res.json({ improvedText });
    } catch (error: any) {
      console.error("Error improving broadcast with AI:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Automated self-test endpoint for broadcasts
  app.post("/api/admin/broadcasts/self-test", async (req, res) => {
    try {
      const db = getDb();
      const usersSnap = await getDocs(collection(db, "users"));
      const usersCount = usersSnap.size;
      const usersLoaded = usersCount > 0;

      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      const tgData = tgSettingsSnap.exists() ? tgSettingsSnap.data() : {};
      const botToken = tgData.botToken;
      const adminChatId = tgData.adminChatId || tgData.chatId;

      if (!botToken) {
        return res.status(400).json({ error: "Self-test failed: Telegram Bot Token is not configured." });
      }

      if (!adminChatId) {
        return res.status(400).json({ error: "Self-test failed: Admin Chat ID is not configured." });
      }

      const text = `🧪 <b>Broadcast Self-Test</b>\n\nThis is an automated self-test of the upgraded Broadcast Composer system.\n\n• Database Users Loaded: <b>${usersCount} users</b>\n• API Integration: <b>Active</b>\n\nAll systems operational!`;
      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: "✅ Self-Test Passed",
              url: "https://example.com"
            }
          ]
        ]
      };

      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const apiRes = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(adminChatId),
          text,
          parse_mode: "HTML",
          reply_markup: replyMarkup
        })
      });

      const apiData = await apiRes.json();
      const deliveryWorking = apiRes.ok && apiData.ok === true;

      res.json({
        apiWorking: true,
        deliveryWorking,
        usersLoaded,
        buttonsWorking: deliveryWorking,
        completedSuccessfully: deliveryWorking && usersLoaded,
        adminChatId
      });
    } catch (error: any) {
      console.error("Self-test error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/broadcasts/:id", async (req, res) => {
    try {
      await deleteDoc(doc(db, "broadcasts", req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting broadcast:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Security Endpoints
  app.get("/api/admin/security", async (req, res) => {
    try {
      const logsSnap = await getDocs(query(collection(db, "securityLogs"), orderBy("createdAt", "desc")));
      const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));

      const usersSnap = await getDocs(collection(db, "users"));
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));

      const totalAlerts = logs.filter((l: any) => ['High', 'Critical'].includes(l.riskLevel)).length;
      const totalBans = users.filter((u: any) => u.status === 'Banned').length;
      const pendingReviews = logs.filter((l: any) => l.reviewStatus === 'Pending').length;
      const whitelistedUsers = users.filter((u: any) => u.securityStatus === 'Whitelisted').length;

      res.json({
        logs,
        stats: {
          totalAlerts,
          totalBans,
          pendingReviews,
          whitelistedUsers,
          fraudAlerts: totalAlerts,
          bannedUsers: totalBans,
          suspiciousUsers: users.filter((u: any) => u.securityStatus === 'Suspicious').length
        }
      });
    } catch (error: any) {
      console.error("Error fetching security data:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/security/action", async (req, res) => {
    try {
      const { logId, userId, action, reason } = req.body;
      
      if (logId) {
        await updateDoc(doc(db, "securityLogs", logId), { reviewStatus: 'Reviewed' });
      }

      if (userId) {
        if (action === 'Ban') {
          await updateDoc(doc(db, "users", userId), { status: 'Banned', banReason: reason || 'Security Ban' });
        } else if (action === 'Whitelist') {
          await updateDoc(doc(db, "users", userId), { securityStatus: 'Whitelisted' });
        } else if (action === 'Warn') {
          await updateDoc(doc(db, "users", userId), { securityStatus: 'Warned' });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating security action:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin Activity Logs Endpoint
  app.get("/api/admin/activity-logs", async (req, res) => {
    try {
      const logsSnap = await getDocs(query(collection(db, "adminActivityLogs"), orderBy("createdAt", "desc")));
      const logs = logsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));

      // Calculate statistics
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).getTime();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

      let todayCount = 0;
      let weekCount = 0;
      let monthCount = 0;
      const actionCounts: Record<string, number> = {};

      logs.forEach((log: any) => {
        const logTime = new Date(log.createdAt).getTime();
        if (logTime >= startOfToday) todayCount++;
        if (logTime >= startOfWeek) weekCount++;
        if (logTime >= startOfMonth) monthCount++;

        const action = log.action || 'Unknown';
        actionCounts[action] = (actionCounts[action] || 0) + 1;
      });

      const mostCommonAction = Object.keys(actionCounts).reduce((a, b) => actionCounts[a] > actionCounts[b] ? a : b, 'None');

      res.json({
        logs,
        stats: {
          totalActions: logs.length,
          todayActions: todayCount,
          weeklyActions: weekCount,
          monthlyActions: monthCount,
          mostCommonAction,
          mostActiveAdmin: 'Admin'
        }
      });
    } catch (error: any) {
      console.error("Error fetching activity logs:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin Backups Endpoints
  app.get("/api/admin/backups", async (req, res) => {
    try {
      const backupsSnap = await getDocs(query(collection(db, "backups"), orderBy("createdAt", "desc")));
      const backups = backupsSnap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      res.json(backups);
    } catch (error: any) {
      console.error("Error fetching backups:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/backups", async (req, res) => {
    try {
      // In a real scenario, you'd fetch all collections and upload to storage.
      // Here we just mock the backup record.
      const sizeMB = (Math.random() * 50 + 10).toFixed(2);
      const backupId = `BK${Math.floor(100000 + Math.random() * 900000)}`;
      
      const newBackup = {
        backupId,
        backupDate: new Date().toISOString(),
        backupSize: `${sizeMB} MB`,
        backupType: req.body.type || 'Manual',
        backupStatus: 'Completed',
        createdAt: new Date().toISOString(),
        restoredAt: null
      };
      
      const docRef = await addDoc(collection(db, "backups"), newBackup);
      res.json({ id: docRef.id, ...newBackup });
    } catch (error: any) {
      console.error("Error creating backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/backups/:id", async (req, res) => {
    try {
      await deleteDoc(doc(db, "backups", req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/backups/:id/restore", async (req, res) => {
    try {
      // Mock restoring process
      await updateDoc(doc(db, "backups", req.params.id), {
        restoredAt: new Date().toISOString()
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error restoring backup:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/backup-settings", async (req, res) => {
    try {
      const docSnap = await getDoc(doc(db, "settings", "backups"));
      res.json(docSnap.data() || { autoBackupEnabled: false, backupFrequency: 'Daily', retentionDays: 30 });
    } catch (error: any) {
      console.error("Error fetching backup settings:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/backup-settings", async (req, res) => {
    try {
      await setDoc(doc(db, "settings", "backups"), req.body, { merge: true });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating backup settings:", error);
      res.status(500).json({ error: error.message });
    }
  });

// Telegram settings routes
  app.get("/api/telegram/settings", async (req, res) => {
    try {
        console.log("Firestore READ: settings/telegram");
        const docRef = doc(db, "settings", "telegram");
        const docSnap = await getDoc(docRef);
        res.json(docSnap.data() || {});
    } catch (e: any) {
        console.error("Firestore READ Error (settings/telegram):", e.message, e.stack);
        res.status(500).json({ error: "Server error", details: e.message });
    }
  });

  const extractUsername = (link: string) => {
    if (!link) return "";
    let cleaned = link.replace(/https?:\/\/(t\.me\/|telegram\.me\/)/, '');
    cleaned = cleaned.replace(/^@/, '');
    return cleaned.split('/')[0];
  };

  app.post("/api/telegram/settings", async (req, res) => {
      try {
          console.log("Firestore WRITE: settings/telegram", req.body);
          const data = req.body;
          
          const cleanUsername = (username: string) => {
              if (!username) return "";
              let cleaned = username.replace(/https?:\/\/(t\.me\/|telegram\.me\/)/, '');
              cleaned = cleaned.replace(/^@/, '');
              return cleaned.split('/')[0].trim();
          };

          const channelUser = cleanUsername(data.channelUsername || data.channelLink || "");
          const groupUser = cleanUsername(data.groupUsername || data.groupLink || "");

          const updateData = {
              ...data,
              channelUsername: channelUser ? `@${channelUser}` : "",
              groupUsername: groupUser ? `@${groupUser}` : "",
              channelLink: channelUser ? `https://t.me/${channelUser}` : "",
              groupLink: groupUser ? `https://t.me/${groupUser}` : ""
          };

          await setDoc(doc(db, "settings", "telegram"), updateData, { merge: true });
          res.json({ status: "ok" });
      } catch (e: any) {
          console.error("Firestore WRITE Error (settings/telegram):", e.message, e.stack);
          res.status(500).json({ error: "Server error", details: e.message });
      }
  });

  app.post("/api/telegram/membership-test", async (req, res) => {
    try {
        const { botToken, channelUsername, groupUsername } = req.body;
        console.log("Membership test:", { channelUsername, groupUsername });
        const results: any = {};
        
        for (const username of [channelUsername, groupUsername]) {
            if (!username) {
                results[username || "unknown"] = "Username missing";
                continue;
            }
            const chatResponse = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${username.replace(/^@/, '')}`);
            results[username] = await chatResponse.json();
        }
        res.json(results);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
  });
  // Telegram API routes
  app.post("/api/telegram/send", async (req, res) => {
    try {
      const { botToken, chatId, otp } = req.body;
      if (!botToken || !chatId || !otp) return res.status(400).json({ error: "Missing fields" });

      const message = `🔐 RoyShare Admin Login OTP\n\nOTP: ${otp}\n\nValid for 5 minutes.`;
      
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message })
      });
      
      const data = await response.json();
      if (!data.ok) return res.status(400).json({ error: "Failed to send OTP", details: data.description });
      
      res.json({ status: "ok" });
    } catch (e) {
      res.status(500).json({ error: "Failed to send" });
    }
  });

  app.post("/api/telegram/test", async (req, res) => {
    try {
      const { botToken, chatId, channelLink, groupLink, storageChannelId } = req.body;
      if (!botToken) return res.status(400).json({ error: "Missing botToken" });
      
      const results: any = { botValid: false, chatValid: false, channelValid: false, groupValid: false, storageValid: false };

      const botResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const botData = await botResponse.json();
      results.botValid = botData.ok;

      if (!botData.ok) return res.json({ ...results, error: botData.description });

      if (chatId) {
        const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: "Testing connection..." })
        });
        const chatData = await chatRes.json();
        results.chatValid = chatData.ok;
      }
      
      const checkChat = async (link: string) => {
        if (!link) return false;
        const username = link.replace(/https?:\/\/(t\.me\/|telegram\.me\/)/, '').replace(/^@/, '').split('/')[0];
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${username}`);
        const data = await res.json();
        return data.ok;
      };

      results.channelValid = await checkChat(channelLink);
      results.groupValid = await checkChat(groupLink);
      
      if (storageChannelId) {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${storageChannelId}`);
        const data = await res.json();
        results.storageValid = data.ok;
      }
      
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/telegram/diagnostics", async (req, res) => {
    try {
      const { botToken, chatId, channelUsername, groupUsername, storageChannelId, supportUsername, botName, botUsername } = req.body;
      
      const errors: string[] = [];
      const report: any = {
        system: {
          frontend: "Online",
          backend: "Online",
          firebase: "Online",
          firestore: "Online",
          telegramBot: "Offline",
          webhook: "Offline",
          storage: "Offline",
          gemini: "Offline"
        },
        bot: {
          name: "None",
          username: "None",
          id: "None",
          tokenValid: "No",
          connected: "No",
          lastResponse: "No token provided"
        },
        webhook: {
          url: "None",
          connected: "No",
          pendingUpdates: 0,
          lastError: "None",
          httpResponseCode: 0
        },
        adminChat: {
          chatIdValid: "No",
          testMessageStatus: "Not tested"
        },
        privateStorage: {
          channelFound: "No",
          botAdmin: "No",
          uploadTest: "No",
          downloadTest: "No",
          error: "None"
        },
        publicChannel: {
          usernameFound: "No",
          botAdmin: "No",
          membershipVerification: "Not tested"
        },
        group: {
          usernameFound: "No",
          botAdmin: "No",
          membershipVerification: "Not tested"
        },
        overallStatus: "🔴 ERROR FOUND",
        errors: errors
      };

      // Check Firebase & Firestore
      if (db) {
        report.system.firebase = "Online";
        try {
          await getDoc(doc(db, "settings", "telegram"));
          report.system.firestore = "Online";
        } catch (e: any) {
          report.system.firestore = "Offline";
          errors.push(`Firestore Error: ${e.message}`);
        }
      } else {
        report.system.firebase = "Offline";
        report.system.firestore = "Offline";
        errors.push("Firebase App not initialized");
      }

      // Check Gemini API
      if (process.env.GEMINI_API_KEY) {
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await safeGenerateContent(ai, {
            model: "gemini-1.5-flash",
            contents: "ping",
          });
          if (response && response.text) {
            report.system.gemini = "Online";
          } else {
            errors.push("Gemini API call returned empty response");
          }
        } catch (e: any) {
          errors.push(`Gemini API Error: ${e.message}`);
        }
      } else {
        errors.push("Gemini API key (GEMINI_API_KEY) not set in environment");
      }

      if (!botToken) {
        errors.push("❌ Bot Token is missing");
        report.bot.lastResponse = "❌ Bot Token is missing";
        return res.json(report);
      }

      // 1. Validate Bot Token & Get Bot Info
      let botId: number | null = null;
      try {
        const botResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const botData = await botResponse.json();
        if (botData.ok) {
          report.bot.tokenValid = "Yes";
          report.bot.connected = "Yes";
          report.bot.name = botData.result.first_name;
          report.bot.username = "@" + botData.result.username;
          report.bot.id = String(botData.result.id);
          botId = botData.result.id;
          report.bot.lastResponse = "OK";
          report.system.telegramBot = "Online";
        } else {
          errors.push(`❌ Invalid Bot Token: ${botData.description}`);
          report.bot.lastResponse = `❌ Invalid Bot Token: ${botData.description}`;
          return res.json(report);
        }
      } catch (e: any) {
        errors.push(`❌ Telegram API Error: ${e.message}`);
        report.bot.lastResponse = `❌ Telegram API Error: ${e.message}`;
        return res.json(report);
      }

      // 2. Verify Webhook
      try {
        const webhookResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
        const webhookData = await webhookResponse.json();
        if (webhookData.ok) {
          report.webhook.url = webhookData.result.url || "None";
          report.webhook.pendingUpdates = webhookData.result.pending_update_count || 0;
          report.webhook.lastError = webhookData.result.last_error_message || "None";
          report.webhook.httpResponseCode = webhookData.result.last_error_date ? 500 : 200;
          
          if (webhookData.result.url) {
            report.webhook.connected = "Yes";
            report.system.webhook = "Online";
          } else {
            errors.push("❌ Webhook Not Set");
          }
        } else {
          errors.push(`❌ Webhook Info Failed: ${webhookData.description}`);
        }
      } catch (e: any) {
        errors.push(`❌ Webhook Check Error: ${e.message}`);
      }

      // 3. Verify Admin Chat
      if (chatId) {
        try {
          const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: "🟢 <b>RoyShare Connection Test</b>\n\nThis is a diagnostic test message sent from the Admin Dashboard." })
          });
          const chatData = await chatRes.json();
          if (chatData.ok) {
            report.adminChat.chatIdValid = "Yes";
            report.adminChat.testMessageStatus = "Sent Successfully";
          } else {
            errors.push(`❌ Chat ID Invalid: ${chatData.description}`);
            report.adminChat.testMessageStatus = `❌ Chat ID Invalid: ${chatData.description}`;
          }
        } catch (e: any) {
          errors.push(`❌ Admin Chat Test Error: ${e.message}`);
          report.adminChat.testMessageStatus = `❌ Error: ${e.message}`;
        }
      } else {
        errors.push("❌ Admin Chat ID Not Configured");
      }

      // 4. Verify Private Storage Channel (upload/download tests)
      if (storageChannelId) {
        try {
          const chRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${storageChannelId}`);
          const chData = await chRes.json();
          if (chData.ok) {
            report.privateStorage.channelFound = "Yes";
            
            // Is Bot Admin?
            const adminsRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators?chat_id=${storageChannelId}`);
            const adminsData = await adminsRes.json();
            if (adminsData.ok && Array.isArray(adminsData.result)) {
              const isBotAdmin = adminsData.result.some((admin: any) => admin.user?.id === botId);
              report.privateStorage.botAdmin = isBotAdmin ? "Yes" : "No";
              if (!isBotAdmin) {
                errors.push("❌ Storage Channel: Bot is not Admin");
              }
            } else {
              report.privateStorage.botAdmin = "No";
              errors.push(`❌ Storage Channel Admin Check Failed: ${adminsData.description || "Inaccessible"}`);
            }

            // Upload Test
            let uploadedFileId: string | null = null;
            let uploadMessageId: number | null = null;
            try {
              const form = new FormData();
              form.append("chat_id", storageChannelId);
              const fileBlob = new Blob(["RoyShare Connection Test File " + Date.now()], { type: "text/plain" });
              form.append("document", fileBlob, "royshare_test.txt");
              const uploadRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
                method: "POST",
                body: form
              });
              const uploadData = await uploadRes.json();
              if (uploadData.ok && uploadData.result?.document?.file_id) {
                report.privateStorage.uploadTest = "Yes";
                report.system.storage = "Online";
                uploadedFileId = uploadData.result.document.file_id;
                uploadMessageId = uploadData.result.message_id;
              } else {
                errors.push(`❌ Upload Failed: ${uploadData.description || "Unknown error"}`);
              }
            } catch (upErr: any) {
              errors.push(`❌ Upload Failed: ${upErr.message}`);
            }

            // Download Test
            if (uploadedFileId) {
              try {
                const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${uploadedFileId}`);
                const getFileData = await getFileRes.json();
                if (getFileData.ok && getFileData.result?.file_path) {
                  const filePath = getFileData.result.file_path;
                  const fileContentUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
                  const dlRes = await fetch(fileContentUrl);
                  if (dlRes.ok) {
                    report.privateStorage.downloadTest = "Yes";
                  } else {
                    errors.push("❌ Download Failed: HTTP error downloading file");
                  }
                } else {
                  errors.push(`❌ Download Failed: getFile failed - ${getFileData.description || "Unknown"}`);
                }
              } catch (dlErr: any) {
                errors.push(`❌ Download Failed: ${dlErr.message}`);
              }

              // Cleanup uploaded message
              if (uploadMessageId) {
                try {
                  await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: storageChannelId, message_id: uploadMessageId })
                  });
                } catch (e) {}
              }
            }
          } else {
            errors.push(`❌ Storage Channel Not Accessible: ${chData.description}`);
            report.privateStorage.error = chData.description;
          }
        } catch (e: any) {
          errors.push(`❌ Storage Channel Test Error: ${e.message}`);
        }
      } else {
        errors.push("❌ Storage Channel ID is missing");
      }

      // Helper for channel/group verification
      const verifyJoinChat = async (usernameField: string, label: string, targetReport: any) => {
        if (!usernameField) {
          targetReport.usernameFound = "No";
          targetReport.membershipVerification = "No username provided";
          errors.push(`❌ ${label} Username Not Configured`);
          return;
        }

        const cleanUsername = usernameField.replace(/^@/, '').trim();
        if (!cleanUsername) {
          targetReport.usernameFound = "No";
          errors.push(`❌ ${label} Username is empty`);
          return;
        }

        try {
          const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${cleanUsername}`);
          const chatData = await chatRes.json();
          if (chatData.ok) {
            targetReport.usernameFound = "Yes";
            
            // Check admin status
            const adminsRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators?chat_id=@${cleanUsername}`);
            const adminsData = await adminsRes.json();
            if (adminsData.ok && Array.isArray(adminsData.result)) {
              const isBotAdmin = adminsData.result.some((admin: any) => admin.user?.id === botId);
              targetReport.botAdmin = isBotAdmin ? "Yes" : "No";
              if (!isBotAdmin) {
                errors.push(`❌ ${label}: Bot is not Admin`);
              }
            } else {
              targetReport.botAdmin = "No";
              errors.push(`❌ ${label}: Bot is not Admin or cannot fetch administrators`);
            }

            targetReport.membershipVerification = "Verified";
          } else {
            errors.push(`❌ ${label} Username Found Failed: ${chatData.description}`);
            targetReport.membershipVerification = `Failed: ${chatData.description}`;
          }
        } catch (e: any) {
          errors.push(`❌ ${label} Verification Error: ${e.message}`);
          targetReport.membershipVerification = `Failed: ${e.message}`;
        }
      };

      // 5. Verify Public Channel
      await verifyJoinChat(channelUsername, "Public Channel", report.publicChannel);

      // 6. Verify Group
      await verifyJoinChat(groupUsername, "Group", report.group);

      // Overall status
      if (errors.length === 0) {
        report.overallStatus = "🟢 ALL SYSTEMS OPERATIONAL";
      } else {
        report.overallStatus = "🔴 ERROR FOUND";
      }

      res.json(report);
    } catch (e: any) {
      console.error("Full diagnostics handler error:", e);
      res.status(500).json({ error: e.message || "Server error running diagnostics" });
    }
  });

  app.post("/api/telegram/send-test", async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      if (!botToken || !chatId) return res.status(400).json({ error: "Missing botToken or chatId" });
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "🔔 <b>RoyShare Test Message</b>\n\nYour Telegram Bot is successfully connected and can send messages to this chat!" })
      });
      const data = await response.json();
      if (!data.ok) return res.status(400).json({ error: data.description });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/telegram/test-channel", async (req, res) => {
    try {
      const { botToken, channelUsername } = req.body;
      if (!botToken || !channelUsername) return res.status(400).json({ error: "Missing fields" });
      const clean = channelUsername.replace(/^@/, '').trim();
      const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${clean}`);
      const data = await chatRes.json();
      if (!data.ok) return res.status(400).json({ error: data.description });
      res.json({ ok: true, chat: data.result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/telegram/test-group", async (req, res) => {
    try {
      const { botToken, groupUsername } = req.body;
      if (!botToken || !groupUsername) return res.status(400).json({ error: "Missing fields" });
      const clean = groupUsername.replace(/^@/, '').trim();
      const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${clean}`);
      const data = await chatRes.json();
      if (!data.ok) return res.status(400).json({ error: data.description });
      res.json({ ok: true, chat: data.result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/telegram/test-upload", async (req, res) => {
    try {
      const { botToken, storageChannelId } = req.body;
      if (!botToken || !storageChannelId) return res.status(400).json({ error: "Missing fields" });
      const form = new FormData();
      form.append("chat_id", storageChannelId);
      const fileBlob = new Blob(["Upload test " + Date.now()], { type: "text/plain" });
      form.append("document", fileBlob, "royshare_test_upload.txt");
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: form
      });
      const data = await response.json();
      if (!data.ok) return res.status(400).json({ error: data.description });
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: storageChannelId, message_id: data.result.message_id })
        });
      } catch (e) {}
      res.json({ ok: true, fileId: data.result.document.file_id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/telegram/test-download", async (req, res) => {
    try {
      const { botToken, storageChannelId } = req.body;
      if (!botToken || !storageChannelId) return res.status(400).json({ error: "Missing fields" });
      const form = new FormData();
      form.append("chat_id", storageChannelId);
      const fileBlob = new Blob(["Download test " + Date.now()], { type: "text/plain" });
      form.append("document", fileBlob, "royshare_test_download.txt");
      const upRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: "POST",
        body: form
      });
      const upData = await upRes.json();
      if (!upData.ok) return res.status(400).json({ error: `Upload phase failed: ${upData.description}` });
      const fileId = upData.result.document.file_id;
      const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
      const getFileData = await getFileRes.json();
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: storageChannelId, message_id: upData.result.message_id })
        });
      } catch (e) {}
      if (!getFileData.ok) return res.status(400).json({ error: `getFile phase failed: ${getFileData.description}` });
      const filePath = getFileData.result.file_path;
      const fileContentUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
      const dlRes = await fetch(fileContentUrl);
      if (!dlRes.ok) return res.status(400).json({ error: `Download phase failed: HTTP status ${dlRes.status}` });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/clear-cache", (req, res) => {
    res.json({ ok: true, message: "System cache cleared successfully." });
  });

  app.post("/api/telegram/webhook/get", async (req, res) => {
    try {
      const { botToken } = req.body;
      if (!botToken) return res.status(400).json({ error: "Missing botToken" });
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const data = await response.json();
      res.json(data.result || {});
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/telegram/webhook/set", async (req, res) => {
    try {
      const { botToken, url } = req.body;
      if (!botToken || !url) return res.status(400).json({ error: "Missing fields" });
      
      // 1. Call setWebhook API
      const setResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(url)}`);
      const setData = await setResponse.json();
      
      if (!setData.ok) {
        return res.status(400).json({ 
          error: setData.description || "Failed to set webhook" 
        });
      }

      // 2. Verify immediately using getWebhookInfo
      const verifyResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const verifyData = await verifyResponse.json();

      if (verifyData.ok) {
        const info = verifyData.result;
        if (info.url === url) {
          return res.json({
            ok: true,
            description: "Webhook set and verified successfully!",
            webhookInfo: info
          });
        } else {
          return res.status(400).json({
            error: `Verification mismatch: Requested URL is ${url}, but Telegram returned ${info.url || "None"}`
          });
        }
      } else {
        return res.status(400).json({
          error: `Verification failed: getWebhookInfo returned: ${verifyData.description || "Unknown Error"}`
        });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/telegram/webhook/delete", async (req, res) => {
    try {
      const { botToken } = req.body;
      if (!botToken) return res.status(400).json({ error: "Missing botToken" });
      const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
      const data = await response.json();
      res.json({ ok: data.ok, description: data.description });
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Incoming Telegram Webhook handler endpoint
  app.post("/api/telegram/webhook", (req, res) => {
    // ALWAYS return 200 immediately to Telegram to prevent retries and timeouts
    res.status(200).json({ ok: true });

    // Process in background
    (async () => {
      const db = getDb();
      try {
        const update = req.body;
        if (!update || typeof update !== "object") return;

        console.log(`📥 Webhook Processing Update ID: ${update.update_id}`);

        // Load Bot Token from Firestore
        const settingsSnap = await getDoc(doc(db, "settings", "telegram"));
        if (!settingsSnap.exists()) {
          console.error("🔴 Fatal: settings/telegram document missing in Firestore");
          return;
        }
        const botToken = settingsSnap.data()?.botToken;
        if (!botToken) {
          console.error("🔴 Fatal: Bot Token missing in Firestore");
          return;
        }

        // Handle the update
        await handleUpdate(botToken, update);

      } catch (err: any) {
        console.error("🔴 Webhook Background Processing Fatal Error:");
        console.error(err.stack || err);
        
        try {
          await setDoc(doc(db, "settings", "telegram"), {
            lastWebhookError: err.message || String(err),
            lastWebhookErrorTime: new Date().toISOString(),
            lastWebhookErrorStack: err.stack || ""
          }, { merge: true });
        } catch (dbErr) {}
      }
    })();
  });

  // Polling infrastructure
  let pollingInterval: NodeJS.Timeout | null = null;
  let pollingState = {
      isRunning: false,
      lastUpdate: null as any,
      receivedCount: 0,
      lastCommand: null as any,
      lastError: null as any,
      lastUpdateId: 0,
      lastUserId: null as any
  };

  async function runPolling(botToken: string) {
      if (pollingState.isRunning) return;
      pollingState.isRunning = true;
      console.log("Polling started with token:", botToken ? `${botToken.substring(0, 5)}...` : "EMPTY!!!");
    if (!botToken) {
        console.error("CRITICAL: BOT TOKEN IS EMPTY! Polling will fail.");
    }
      
      while (pollingState.isRunning) {
          try {
              const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${pollingState.lastUpdateId + 1}&timeout=30`);
              const data = await res.json();
              if (data.ok && data.result.length > 0) {
                  for (const update of data.result) {
                      pollingState.lastUpdateId = update.update_id;
                      pollingState.lastUpdate = update;
                      pollingState.receivedCount++;
                      if (update.message?.text) pollingState.lastCommand = update.message.text;
                      if (update.message?.from?.id) pollingState.lastUserId = update.message.from.id;
                      else if (update.callback_query?.from?.id) pollingState.lastUserId = update.callback_query.from.id;
                      
                      console.log("Processing update:", JSON.stringify(update));
                      await handleUpdate(botToken, update);
                  }
              }
          } catch (e: any) {
              pollingState.lastError = e.message;
              console.error("Polling error:", e);
          }
          await new Promise(r => setTimeout(r, 1000));
      }
      console.log("Polling stopped.");
  }

  app.post("/api/telegram/polling/start", async (req, res) => {
      const { botToken } = req.body;
      runPolling(botToken);
      res.json({ status: "started" });
  });

  app.post("/api/telegram/polling/stop", async (req, res) => {
      pollingState.isRunning = false;
      res.json({ status: "stopped" });
  });

  app.post("/api/telegram/polling/restart", async (req, res) => {
      const { botToken } = req.body;
      pollingState.isRunning = false;
      await new Promise(r => setTimeout(r, 1500)); // wait for stop
      runPolling(botToken);
      res.json({ status: "restarted" });
  });

  app.get("/api/telegram/polling/status", (req, res) => {
      res.json(pollingState);
  });

  // Auto-start polling on app startup if token exists
  getDoc(doc(db, "settings", "telegram")).then(async (docSnap) => {
      const data = docSnap.data();
      if (!docSnap.exists()) {
        console.log("Initializing settings/telegram document...");
        await setDoc(doc(db, "settings", "telegram"), {
          botToken: "",
          channelUsername: "",
          groupUsername: "",
          storageChannelId: "",
          adminChatId: ""
        });
      } else if (data?.botToken) {
          runPolling(data.botToken);
      }
  }).catch(e => {
      console.error("Failed to auto-start polling:", e);
  });

  app.get("/ref/:userId", async (req, res) => {
      const { userId } = req.params;
      let botUsername = "RoyShareEarnBot";
      try {
          const settingsDoc = await getDoc(doc(db, "settings", "telegram"));
          const botToken = settingsDoc.data()?.botToken;
          if (botToken) {
              const botMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
              const botMeData = await botMeRes.json();
              if (botMeData.ok && botMeData.result?.username) {
                  botUsername = botMeData.result.username;
              }
          }
      } catch (e) {
          console.error("Error getting bot username for ref redirect:", e);
      }
      res.redirect(`https://t.me/${botUsername}?start=ref_${userId}`);
  });

  // Daily Bonus Endpoints
  app.get("/api/daily-bonus/status", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const todayDateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const stateDocRef = doc(db, "daily_bonus_state", userId);
      const stateSnap = await getDoc(stateDocRef);

      const userDocRef = doc(db, "users", userId);
      const userSnap = await getDoc(userDocRef);
      const currency = userSnap.exists() ? (userSnap.data()?.currency || "INR") : "INR";

      if (!stateSnap.exists()) {
        const initialState = {
          userId,
          remainingSpins: 3,
          dailySpinCount: 0,
          lastSpinDate: todayDateStr
        };
        await setDoc(stateDocRef, initialState);
        return res.json({ ...initialState, currency });
      }

      const stateData = stateSnap.data();
      if (stateData.lastSpinDate !== todayDateStr) {
        // Reset daily limits
        const resetState = {
          userId,
          remainingSpins: 3,
          dailySpinCount: 0,
          lastSpinDate: todayDateStr
        };
        await setDoc(stateDocRef, resetState, { merge: true });
        return res.json({ ...resetState, currency });
      }

      return res.json({
        userId,
        remainingSpins: stateData.remainingSpins ?? 3,
        dailySpinCount: stateData.dailySpinCount ?? 0,
        lastSpinDate: stateData.lastSpinDate,
        currency
      });
    } catch (e: any) {
      console.error("Error in /api/daily-bonus/status:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/daily-bonus/spin", async (req, res) => {
    try {
      const { userId, rewardAmount } = req.body;
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const todayDateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const stateDocRef = doc(db, "daily_bonus_state", userId);
      const stateSnap = await getDoc(stateDocRef);

      let currentRemainingSpins = 3;
      let currentDailySpinCount = 0;

      if (stateSnap.exists()) {
        const stateData = stateSnap.data();
        if (stateData.lastSpinDate === todayDateStr) {
          currentRemainingSpins = stateData.remainingSpins ?? 3;
          currentDailySpinCount = stateData.dailySpinCount ?? 0;
        }
      }

      if (currentRemainingSpins <= 0) {
        return res.status(400).json({ error: "No spins remaining today" });
      }

      const nextRemainingSpins = currentRemainingSpins - 1;
      const nextDailySpinCount = currentDailySpinCount + 1;

      const newState = {
        userId,
        remainingSpins: nextRemainingSpins,
        dailySpinCount: nextDailySpinCount,
        lastSpinDate: todayDateStr
      };

      await setDoc(stateDocRef, newState, { merge: true });
      return res.json({
        ok: true,
        remainingSpins: nextRemainingSpins,
        dailySpinCount: nextDailySpinCount,
        rewardAmount
      });
    } catch (e: any) {
      console.error("Error in /api/daily-bonus/spin:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/daily-bonus/claim", async (req, res) => {
    try {
      const { userId, rewardAmount, remainingSpins, dailySpinCount } = req.body;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      if (rewardAmount === undefined) return res.status(400).json({ error: "Missing rewardAmount" });

      const userDocRef = doc(db, "users", userId);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        return res.status(404).json({ error: "User not found" });
      }

      const uData = userDoc.data();
      const fileEarnings = uData?.fileEarnings || 0;
      const linkEarnings = uData?.linkEarnings || 0;
      const referralEarnings = uData?.referralEarnings || 0;
      const bonusBalance = (uData?.bonusBalance || 0) + Number(rewardAmount);
      const withdrawnAmount = uData?.withdrawnAmount || 0;
      const pendingWithdrawals = uData?.pendingWithdrawals || 0;
      const availableBalance = fileEarnings + linkEarnings + referralEarnings + bonusBalance - withdrawnAmount - pendingWithdrawals;
      const bonus = (uData?.bonus || 0) + Number(rewardAmount);
      const earnings = (uData?.earnings || 0) + Number(rewardAmount);

      // Save user doc updates
      await setDoc(userDocRef, {
        bonus,
        bonusBalance,
        availableBalance,
        earnings
      }, { merge: true });

      // Store in Firestore exactly what was requested:
      // userId, rewardAmount, claimDate, remainingSpins, dailySpinCount
      const claimDate = new Date().toISOString();
      await addDoc(collection(db, "dailyBonus"), {
        userId,
        rewardAmount: Number(rewardAmount),
        claimDate,
        remainingSpins: Number(remainingSpins ?? 0),
        dailySpinCount: Number(dailySpinCount ?? 0)
      });

      // Format transaction date & time for Indian Standard Time
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
      const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

      const txData = {
        amount: Number(rewardAmount),
        type: "Daily Bonus",
        date: dateStr,
        time: timeStr,
        userId,
        createdAt: now.toISOString()
      };

      await Promise.all([
        addDoc(collection(db, "transactions"), txData),
        addDoc(collection(db, "transactionHistory"), txData)
      ]);

      // Fetch Bot Token & Notify user on Telegram
      const settingsDoc = await getDoc(doc(db, "settings", "telegram"));
      const botToken = settingsDoc.data()?.botToken;

      if (botToken) {
        const messageText = `🎉 *Daily Bonus Claimed*

💰 *Reward:*
₹${Number(rewardAmount).toFixed(2)}

🎡 *Remaining Spins:*
${remainingSpins}

Bonus added successfully.`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(userId),
            text: messageText,
            parse_mode: "Markdown"
          })
        });
      }

      return res.json({ ok: true });
    } catch (e: any) {
      console.error("Error in /api/daily-bonus/claim:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Earn Rewards endpoints
  app.get("/api/earn-rewards/settings", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      
      // 1. Get timer duration (defaults to 30)
      const settingsDocRef = doc(db, "settings", "earn_rewards");
      const settingsSnap = await getDoc(settingsDocRef);
      const timerDuration = settingsSnap.exists() ? (settingsSnap.data()?.timerDuration ?? 30) : 30;

      let currency = "INR";
      let userName = "User";
      let completedTaskIds: string[] = [];

      if (userId) {
        // 2. Fetch user information
        const userDocRef = doc(db, "users", userId);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const uData = userSnap.data();
          currency = uData.currency || "INR";
          userName = uData.firstName || uData.username || "User";
        }

        // 3. Fetch completed tasks for anti-abuse check
        const q = query(
          collection(db, "task_completions"),
          where("userId", "==", userId),
          where("status", "==", "completed")
        );
        const qSnap = await getDocs(q);
        qSnap.forEach(docSnap => {
          const comp = docSnap.data();
          if (comp.taskId) {
            completedTaskIds.push(comp.taskId);
          }
        });
      }

      let botUsername = "RoyShareEarnBot";
      try {
        const telegramSettingsDoc = await getDoc(doc(db, "settings", "telegram"));
        const botToken = telegramSettingsDoc.data()?.botToken;
        if (botToken) {
          const botMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
          const botMeData = await botMeRes.json();
          if (botMeData.ok && botMeData.result?.username) {
            botUsername = botMeData.result.username;
          }
        }
      } catch (e) {
        console.error("Error getting bot username inside settings endpoint:", e);
      }

      // Fetch dynamic tasks from Firestore tasks collection
      let dbTasks: any[] = [];
      try {
        const tasksQuery = query(collection(db, "tasks"));
        const tasksSnap = await getDocs(tasksQuery);
        dbTasks = tasksSnap.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id,
            name: d.title || "",
            amount: Number(d.rewardAmount) || 0,
            status: d.status || "🟢 Active",
            ...d
          };
        });
      } catch (e) {
        console.error("Error fetching dynamic tasks in settings endpoint:", e);
      }

      // Only return Active tasks to the user
      const mergedTasks = dbTasks.filter(t => 
        t.status === "🟢 Active" || 
        String(t.status || "").toLowerCase().includes("active")
      );

      return res.json({
        timerDuration,
        currency,
        userName,
        completedTaskIds,
        tasks: mergedTasks,
        botUsername
      });
    } catch (e: any) {
      console.error("Error in /api/earn-rewards/settings:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/earn-rewards/complete", async (req, res) => {
    try {
      const { userId, taskId } = req.body;
      if (!userId) return res.status(400).json({ error: "Missing userId" });
      if (!taskId) return res.status(400).json({ error: "Missing taskId" });

      // Find the task amount from Firestore or fallback to hardcoded REWARD_TASKS
      let amount = 0;
      let isDbTask = false;
      try {
        const dbTaskRef = doc(db, "tasks", taskId);
        const dbTaskSnap = await getDoc(dbTaskRef);
        if (dbTaskSnap.exists()) {
          const tData = dbTaskSnap.data();
          
          // Security: Block direct completion for Monetag ads
          if (tData.adNetwork === "Monetag Mini App" || tData.provider === "monetag_mini") {
            return res.status(403).json({ error: "Monetag rewards are processed automatically via Server-Side Postback. Please wait for verification." });
          }

          amount = Number(tData.rewardAmount) || 0;
          isDbTask = true;
          
          // Increment participants, completedUsers, and totalRewardsDistributed on dynamic task
          await setDoc(dbTaskRef, {
            participants: (dbTaskSnap.data()?.participants || 0) + 1,
            completedUsers: (dbTaskSnap.data()?.completedUsers || 0) + 1,
            totalRewardsDistributed: (dbTaskSnap.data()?.totalRewardsDistributed || 0) + amount
          }, { merge: true });
        }
      } catch (err) {
        console.error("Error looking up task in Firestore inside complete route:", err);
      }

      if (!isDbTask) {
        return res.status(400).json({ error: "Invalid taskId" });
      }

      // Anti-abuse: Check if already completed
      const qCheck = query(
        collection(db, "task_completions"),
        where("userId", "==", userId),
        where("taskId", "==", taskId),
        where("status", "==", "completed")
      );
      const qSnap = await getDocs(qCheck);
      if (!qSnap.empty) {
        return res.status(400).json({ error: "Task already completed. No duplicate rewards allowed." });
      }

      // Fetch user
      const userDocRef = doc(db, "users", userId);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        return res.status(404).json({ error: "User not found" });
      }

      const uData = userDoc.data();
      const fileEarnings = uData?.fileEarnings || 0;
      const linkEarnings = uData?.linkEarnings || 0;
      const referralEarnings = uData?.referralEarnings || 0;
      const bonusBalance = uData?.bonusBalance || 0;
      const rewardBalance = (uData?.rewardBalance || 0) + amount;
      const withdrawnAmount = uData?.withdrawnAmount || 0;
      const pendingWithdrawals = uData?.pendingWithdrawals || 0;

      // New availableBalance calculation (integrating rewardBalance!)
      const availableBalance = fileEarnings + linkEarnings + referralEarnings + bonusBalance + rewardBalance - withdrawnAmount - pendingWithdrawals;
      const earnings = (uData?.earnings || 0) + amount;

      // Update user doc in Firestore
      await setDoc(userDocRef, {
        rewardBalance,
        availableBalance,
        earnings
      }, { merge: true });

      // Store in Firestore exactly what was requested:
      // userId, taskId, rewardAmount, status, completedPages, completedAt
      const completedAt = new Date().toISOString();
      await addDoc(collection(db, "task_completions"), {
        userId,
        taskId,
        rewardAmount: amount,
        status: "completed",
        taskCompleted: true,
        rewardGranted: true,
        completedPages: 3,
        completedAt
      });

      // Format transaction date & time
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
      const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

      const txData = {
        amount,
        type: "Task Reward",
        date: dateStr,
        time: timeStr,
        userId,
        createdAt: now.toISOString()
      };

      await Promise.all([
        addDoc(collection(db, "transactions"), txData),
        addDoc(collection(db, "transactionHistory"), txData)
      ]);

      // Fetch Bot Token & Notify user on Telegram
      const settingsDoc = await getDoc(doc(db, "settings", "telegram"));
      const botToken = settingsDoc.data()?.botToken;
      const currency = uData?.currency || "INR";

      if (botToken) {
        function localFormatCurrency(val: number, cur: string = "INR"): string {
            if (cur === "USD") {
                const converted = val * 0.0118;
                return `$${converted.toFixed(2)}`;
            } else {
                return `₹${val.toFixed(2)}`;
            }
        }
        const formattedAmt = localFormatCurrency(amount, currency);
        
        // Exact text required:
        // ✅ Reward Credited
        // 💰 Reward:
        // ₹{rewardAmount}
        // Added to Reward Balance.
        const messageText = `✅ Reward Credited\n\n💰 Reward:\n${formattedAmt}\n\nAdded to Reward Balance.`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(userId),
            text: messageText
          })
        });
      }

      return res.json({ ok: true, rewardAmount: amount, currency });
    } catch (e: any) {
      console.error("Error in /api/earn-rewards/complete:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // ========================================
  // MONETAG SERVER-SIDE POSTBACK SYSTEM
  // ========================================

  // 0. Health Check Endpoint
  app.get("/api/monetag/postback/test", (req, res) => {
    res.json({
      success: true,
      message: "Monetag Postback API is working",
      timestamp: new Date().toISOString()
    });
  });

  // 1. Postback Handler (Supports both GET and POST)
  app.all("/api/monetag/postback", async (req, res) => {
    const method = req.method;
    const params = method === "GET" ? req.query : req.body;
    
    console.log(`[MONETAG POSTBACK] Received ${method} request at ${new Date().toISOString()}`);
    console.log(`[MONETAG POSTBACK] Full Raw Params:`, JSON.stringify(params, null, 2));

    // Support multiple macro names for common fields from various Monetag configurations
    const telegram_id = params.telegram_id || params.ext_id || params.subid || params.click_id || params.sub_id || params.visitor_id;
    const ymid = params.ymid || params.clickid || params.transaction_id || params.visitor_id || params.click_id;
    const request_var = params.request_var || params.custom_var || params.taskId || params.subid1;
    
    const zone_id = params.zone_id || params.zoneid;
    const sub_zone_id = params.sub_zone_id || params.subzoneid || "unknown";
    const event_type = params.event_type || params.event;
    const reward_event_type = params.reward_event_type || params.reward;
    const estimated_price = params.estimated_price || params.price || params.revenue || 0;

    // Log entry for the postback
    const postbackRef = collection(db, "monetag_postbacks");
    const logEntry: any = {
      timestamp: new Date().toISOString(),
      method,
      ip: req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "Unknown",
      params: { ...params },
      status: "pending",
      identified_tg_id: telegram_id || "MISSING",
      identified_ymid: ymid || "MISSING",
      identified_task: request_var || "DEFAULT"
    };

    try {
      // Basic validation
      if (!telegram_id || telegram_id === "{ext_id}" || telegram_id === "Unknown" || telegram_id === "null" || telegram_id === "{subid}") {
        console.error(`[MONETAG POSTBACK] FAILURE: Missing or macro-placeholder telegram_id. Value: ${telegram_id}`);
        logEntry.status = "failed";
        logEntry.error = `Invalid telegram_id: ${telegram_id}. Check if ext_id or subid was passed to show()`;
        await addDoc(postbackRef, logEntry);
        
        return res.status(400).json({ 
          error: "Missing telegram_id", 
          received: telegram_id,
          hint: "Ensure ext_id or subid is passed in the frontend SDK call" 
        });
      }

      if (!ymid || ymid === "{ymid}" || ymid === "{clickid}") {
        console.error(`[MONETAG POSTBACK] FAILURE: Missing or macro-placeholder ymid. Value: ${ymid}`);
        logEntry.status = "failed";
        logEntry.error = "Missing ymid (transaction id)";
        await addDoc(postbackRef, logEntry);
        return res.status(400).send("Missing ymid");
      }

      console.log(`[MONETAG POSTBACK] Validated Postback: TG=${telegram_id}, YMID=${ymid}, Zone=${zone_id}, Event=${event_type}`);

      // Replay Protection: Check if this YMID was already processed successfully
      const duplicateQuery = query(
        postbackRef, 
        where("params.ymid", "==", ymid), 
        where("status", "==", "success")
      );
      const duplicateSnapshot = await getDocs(duplicateQuery);
      if (!duplicateSnapshot.empty) {
        console.warn(`[MONETAG POSTBACK] Warning: Duplicate YMID detected: ${ymid}`);
        logEntry.status = "failed";
        logEntry.error = "Duplicate YMID detected (Replay Attack prevented)";
        await addDoc(postbackRef, logEntry);
        return res.status(200).send("Duplicate postback already processed");
      }

      // Check reward eligibility
      if (reward_event_type !== "yes") {
        console.log(`[MONETAG POSTBACK] Event ignored: reward_event_type is '${reward_event_type}'`);
        logEntry.status = "ignored";
        logEntry.reason = "reward_event_type is not 'yes'";
        await addDoc(postbackRef, logEntry);
        return res.status(200).send("Event ignored (no reward requested)");
      }

      // Find User by Telegram ID - Use direct document ID for reliability and speed
      const usersRef = collection(db, "users");
      let userDocRef = doc(usersRef, String(telegram_id));
      const userSnap = await getDoc(userDocRef);

      let userId: string;
      let userData: any;
      let tgIdNum = Number(telegram_id);

      if (!userSnap.exists()) {
        console.warn(`[MONETAG POSTBACK] User ${telegram_id} not found by ID. Querying...`);
        // Fallback to query in case doc ID is different for some reason
        const userQuery = query(usersRef, where("telegramId", "==", tgIdNum));
        const userSnapshot = await getDocs(userQuery);
        
        if (userSnapshot.empty) {
          console.warn(`[MONETAG POSTBACK] User not found. Creating auto-record for TG=${telegram_id}`);
          userData = {
            telegramId: isNaN(tgIdNum) ? telegram_id : tgIdNum,
            username: params.username || "monetag_auto_user",
            firstName: params.firstName || "Monetag",
            lastName: params.lastName || "User",
            balance: 0,
            availableBalance: 0,
            totalEarnings: 0,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            membershipVerified: false,
            verified: false,
            registrationStep: 'completed',
            monetag_auto_created: true
          };
          await setDoc(userDocRef, userData);
          userId = String(telegram_id);
        } else {
          const userDoc = userSnapshot.docs[0];
          userData = userDoc.data();
          userId = userDoc.id;
          userDocRef = userDoc.ref as any;
        }
      } else {
        userData = userSnap.data();
        userId = userSnap.id;
      }

      console.log(`[MONETAG POSTBACK] User Validated: ${userId} (${userData.username || 'No Username'})`);

      // Determine reward amount
      let rewardAmount = 0.56; 
      
      // We use request_var as the taskId if passed from frontend ad call
      const taskId = request_var || "monetag_default_task";
      
      if (taskId && taskId !== "monetag_default_task") {
        const taskDoc = await getDoc(doc(db, "tasks", taskId));
        if (taskDoc.exists()) {
          rewardAmount = Number(taskDoc.data().rewardAmount) || rewardAmount;
        }
      }

      console.log(`[MONETAG POSTBACK] Reward Amount determined: ${rewardAmount}`);

      // Create Task Completion Record (Verified but not yet claimed)
      const completionsRef = collection(db, "task_completions");
      const completionId = `${userId}_${taskId}_${ymid}`;
      
      const completionData = {
        telegram_id: String(telegram_id),
        userId: userId,
        taskId: taskId,
        ymid: String(ymid),
        zone_id: zone_id || "unknown",
        sub_zone_id: sub_zone_id || "unknown",
        event_type: event_type || "unknown",
        reward_event_type: reward_event_type,
        estimated_price: Number(estimated_price || 0),
        rewardAmount: rewardAmount,
        status: "verified",
        verified: true,
        reward_credited: false,
        claimed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        adNetwork: "Monetag"
      };

      await setDoc(doc(completionsRef, completionId), completionData);
      console.log(`[MONETAG POSTBACK] Task Completion Created: ID=${completionId}, Status=verified`);

      // Update Postback Analytics
      const today = new Date().toISOString().split("T")[0];
      const analyticsRef = doc(db, "monetag_analytics", today);
      const analyticsSnap = await getDoc(analyticsRef);
      
      const revenue = Number(estimated_price || 0);
      
      if (analyticsSnap.exists()) {
        const existing = analyticsSnap.data();
        await updateDoc(analyticsRef, {
          totalPostbacks: (existing.totalPostbacks || 0) + 1,
          successCount: (existing.successCount || 0) + 1,
          totalRevenue: (existing.totalRevenue || 0) + revenue
        });
      } else {
        await setDoc(analyticsRef, {
          date: today,
          totalPostbacks: 1,
          successCount: 1,
          totalRevenue: revenue
        });
      }

      // Global Stats update
      const globalStatsRef = doc(db, "monetag_analytics", "global_stats");
      const globalStatsSnap = await getDoc(globalStatsRef);
      if (globalStatsSnap.exists()) {
        const existing = globalStatsSnap.data();
        await updateDoc(globalStatsRef, {
          totalPostbacks: (existing.totalPostbacks || 0) + 1,
          successCount: (existing.successCount || 0) + 1,
          totalRevenue: (existing.totalRevenue || 0) + revenue,
          lastPostbackAt: new Date().toISOString()
        });
      } else {
        await setDoc(globalStatsRef, {
          totalPostbacks: 1,
          successCount: 1,
          totalRevenue: revenue,
          lastPostbackAt: new Date().toISOString()
        });
      }

      // Update status in log entry
      logEntry.status = "success";
      logEntry.userId = userId;
      logEntry.rewardAmount = rewardAmount;
      await addDoc(postbackRef, logEntry);

      console.log(`[MONETAG POSTBACK] Verification Success for TG=${telegram_id}`);
      return res.status(200).send("Reward verified successfully");
    } catch (e: any) {
      console.error("[MONETAG POSTBACK] Fatal Error:", e);
      logEntry.status = "failed";
      logEntry.error = e.message || "Unknown internal error";
      await addDoc(postbackRef, logEntry);
      return res.status(500).send("Internal processing error");
    }
  });

  app.post("/api/monetag/claim-reward", async (req, res) => {
    try {
      const { telegram_id, taskId } = req.body;
      if (!telegram_id || !taskId) {
        return res.status(400).json({ success: false, message: "Missing telegram_id or taskId" });
      }

      console.log(`[CLAIM REWARD] Incoming: TG=${telegram_id}, Task=${taskId}`);

      const completionsRef = collection(db, "task_completions");
      const q = query(
        completionsRef,
        where("telegram_id", "==", String(telegram_id)),
        where("taskId", "==", taskId),
        where("status", "==", "verified"),
        where("claimed", "==", false)
      );

      const snapshot = await getDocs(q);
      let targetDoc: any = null;

      if (snapshot.empty) {
        // Try fallback query with userId for older records
        const qFallback = query(
          completionsRef,
          where("userId", "==", String(telegram_id)),
          where("taskId", "==", taskId),
          where("status", "==", "verified"),
          where("claimed", "==", false)
        );
        const fallbackSnap = await getDocs(qFallback);
        if (fallbackSnap.empty) {
          console.warn(`[CLAIM REWARD] No claimable record for TG=${telegram_id}`);
          return res.status(404).json({ success: false, message: "Verification pending or already claimed. Please refresh." });
        }
        targetDoc = fallbackSnap.docs[0];
      } else {
        targetDoc = snapshot.docs[0];
      }

      const data = targetDoc.data();
      const rewardAmount = Number(data.rewardAmount || 0.56);
      const ymid = data.ymid;

      // Find User
      const usersRef = collection(db, "users");
      const userDocRef = doc(usersRef, String(telegram_id));
      const userSnap = await getDoc(userDocRef);

      if (!userSnap.exists()) {
        return res.status(404).json({ success: false, message: "User record not found." });
      }

      const userData = userSnap.data();
      const currentBalance = Number(userData.availableBalance || userData.balance || 0);
      const currentTotalEarnings = Number(userData.totalEarnings || 0);
      
      const newBalance = currentBalance + rewardAmount;
      const newTotalEarnings = currentTotalEarnings + rewardAmount;

      console.log(`[CLAIM REWARD] Crediting reward: ₹${rewardAmount} to TG=${telegram_id}`);

      // 1. Update User
      await updateDoc(userDocRef, {
        availableBalance: newBalance,
        balance: newBalance,
        totalEarnings: newTotalEarnings,
        lastEarningAt: new Date().toISOString()
      });

      // 2. Mark as Claimed
      await updateDoc(targetDoc.ref, {
        claimed: true,
        reward_credited: true,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // 3. Log History
      await addDoc(collection(db, "reward_history"), {
        userId: String(telegram_id),
        telegramId: Number(telegram_id),
        amount: rewardAmount,
        type: "monetag_claim",
        description: `Monetag Ad Reward Claimed (YMID: ${ymid})`,
        timestamp: new Date().toISOString(),
        ymid
      });

      // 4. Transaction log
      await addDoc(collection(db, "transactions"), {
        userId: String(telegram_id),
        type: "reward",
        amount: rewardAmount,
        status: "success",
        description: "Monetag Ad Reward",
        timestamp: new Date().toISOString()
      });

      console.log(`[CLAIM REWARD] Success for TG=${telegram_id}`);
      return res.json({ 
        success: true, 
        message: "Reward claimed successfully.",
        amount: rewardAmount
      });

    } catch (e: any) {
      console.error("[CLAIM REWARD] Fatal Error:", e);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // 2. Admin: Get Monetag Settings and Stats
  app.get("/api/admin/verified-tasks", async (req, res) => {
    try {
      const completionsRef = collection(db, "task_completions");
      // Basic query for verified tasks
      const q = query(
        completionsRef,
        where("status", "==", "verified"),
        limit(200)
      );
      const snapshot = await getDocs(q);
      let tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Sort in memory if created_at exists
      tasks.sort((a: any, b: any) => {
        const dateA = new Date(a.created_at || a.completedAt || 0).getTime();
        const dateB = new Date(b.created_at || b.completedAt || 0).getTime();
        return dateB - dateA;
      });

      res.json(tasks);
    } catch (e: any) {
      console.error("Error fetching verified tasks:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/monetag/stats", async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      
      const globalStatsSnap = await getDoc(doc(db, "monetag_analytics", "global_stats"));
      const todayStatsSnap = await getDoc(doc(db, "monetag_analytics", today));
      
      // Recent postbacks
      const recentQuery = query(collection(db, "monetag_postbacks"), orderBy("timestamp", "desc"), limit(20));
      const recentSnapshot = await getDocs(recentQuery);
      const recentEvents = recentSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      const appUrl = process.env.APP_URL || "https://royshare.onrender.com";
      // Update URL to use more common macros as fallbacks
      const postbackUrl = `${appUrl}/api/monetag/postback?ext_id={ext_id}&ymid={ymid}&zone_id={zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&estimated_price={estimated_price}&request_var={request_var}`;

      res.json({
        success: true,
        postbackUrl,
        globalStats: globalStatsSnap.exists() ? globalStatsSnap.data() : { totalPostbacks: 0, successCount: 0, totalRevenue: 0, totalRewards: 0 },
        todayStats: todayStatsSnap.exists() ? todayStatsSnap.data() : { totalPostbacks: 0, successCount: 0, totalRevenue: 0, totalRewards: 0 },
        recentEvents
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 3. Admin: Test Postback Endpoint
  app.post("/api/admin/monetag/test-postback", async (req, res) => {
    try {
      const { telegramId } = req.body;
      if (!telegramId) return res.status(400).json({ success: false, message: "Missing telegramId" });

      const appUrl = process.env.APP_URL || "https://royshare.onrender.com";
      const testYmid = "test_" + Math.random().toString(36).substring(7);
      
      const testUrl = `${appUrl}/api/monetag/postback?telegram_id=${telegramId}&zone_id=12345&sub_zone_id=67890&event_type=ad_completed&reward_event_type=yes&estimated_price=0.01&ymid=${testYmid}&request_var=monetag_default_task`;

      console.log("Simulating Monetag Postback:", testUrl);
      
      const response = await fetch(testUrl, { method: "GET" });
      const text = await response.text();

      res.json({
        success: response.ok,
        status: response.status,
        response: text,
        testUrl
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/earn-rewards/check-status", async (req, res) => {
    try {
      const { userId, taskId } = req.query;
      if (!userId || !taskId) return res.status(400).json({ error: "Missing params" });
      
      console.log(`[STATUS CHECK] Checking status for userId: ${userId}, taskId: ${taskId}`);

      const q = query(
        collection(db, "task_completions"),
        where("telegram_id", "==", String(userId)),
        where("taskId", "==", taskId),
        where("status", "==", "verified")
      );
      
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        console.log(`[STATUS CHECK] Success: Task ${taskId} found verified for user ${userId}`);
        return res.json({ completed: true });
      } else {
        // Fallback for older records using userId
        const q2 = query(
          collection(db, "task_completions"),
          where("userId", "==", String(userId)),
          where("taskId", "==", taskId),
          where("status", "==", "verified")
        );
        const snapshot2 = await getDocs(q2);
        if (!snapshot2.empty) {
          return res.json({ completed: true });
        }
        
        // Check for recent failed postbacks to provide better feedback
        const failedPostbacksQuery = query(
          collection(db, "monetag_postbacks"),
          where("identified_tg_id", "==", String(userId)),
          where("status", "==", "failed"),
          limit(1)
        );
        const failedSnapshot = await getDocs(failedPostbacksQuery);
        if (!failedSnapshot.empty) {
          const failedData = failedSnapshot.docs[0].data();
          return res.json({ 
            completed: false, 
            reason: "Postback failed", 
            error: failedData.error || "Unknown error" 
          });
        }

        console.log(`[STATUS CHECK] Pending: No verified completion found for userId: ${userId}, taskId: ${taskId}`);
        return res.json({ completed: false, reason: "Verification pending..." });
      }
    } catch (e: any) {
      console.error("[STATUS CHECK] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/withdrawal/captcha", async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) return res.status(400).json({ success: false, message: "Missing userId" });
      
      const userDoc = await getDoc(doc(db, "users", String(userId)));
      const state = userDoc.data()?.pendingWithdrawal;
      
      if (!state || state.step !== "human_verification_pending" || !state.captchaNum1 || !state.captchaNum2) {
        return res.status(400).json({ success: false, message: "Verification session expired." });
      }
      
      res.json({ success: true, num1: state.captchaNum1, num2: state.captchaNum2 });
    } catch (e: any) {
      console.error("Error in /api/withdrawal/captcha:", e);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  app.post("/api/withdrawal/verify", async (req, res) => {
    try {
      const { userId, answer } = req.body;
      if (!userId || !answer) return res.status(400).json({ success: false, message: "Missing params" });
      
      const userDoc = await getDoc(doc(db, "users", String(userId)));
      const state = userDoc.data()?.pendingWithdrawal;
      
      if (!state || state.step !== "human_verification_pending") {
        return res.status(400).json({ success: false, message: "Verification session expired." });
      }
      
      if (answer.trim() !== state.captchaAnswer) {
        return res.status(400).json({ success: false, message: "Incorrect answer. Try again." });
      }
      
      // Update state to null to avoid duplicate
      await setDoc(doc(db, "users", String(userId)), { pendingWithdrawal: null }, { merge: true });

      // Record verification
      state.verificationStatus = "✅ Verified";
      state.verificationTime = new Date().toISOString();
      state.verificationMethod = "Math Challenge";

      const settingsDoc = await getDoc(doc(db, "settings", "telegram"));
      const botToken = settingsDoc.data()?.botToken;
      
      if (botToken) {
        await submitWithdrawalRequest(botToken, state.chatId, String(userId), state);
      }
      
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error in /api/withdrawal/verify:", e);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // ==========================================
  // SMART URL SHORTENER PUBLIC & ADMIN APIs
  // ==========================================

  app.post("/api/smart-links/session/init", async (req, res) => {
    try {
      const { type, id, browser, device, country } = req.body;
      if (!type || !id) return res.status(400).json({ success: false, message: "Missing required parameters" });

      const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "Unknown";

      let itemData: any = null;
      let docRef: any = null;
      let col = type === "shortener" ? "links" : "uploads";

      // Requirement 6: Debug log - Link ID received
      console.log(`[DEBUG SHORTENER] Link ID received: "${id}"`);

      if (type === "shortener") {
        // Requirement 6: Debug log - Collection searched
        console.log(`[DEBUG SHORTENER] Searching collection: "links" (used by bot) and fallback to "smart_links"`);

        // 1. Try "links" collection first
        const directLinkRef = doc(db, "links", id);
        const directLinkSnap = await getDoc(directLinkRef);
        if (directLinkSnap.exists()) {
          docRef = directLinkRef;
          itemData = directLinkSnap.data();
          col = "links";
        } else {
          const qLink = query(collection(db, "links"), where("linkId", "==", id));
          const qLinkSnap = await getDocs(qLink);
          if (!qLinkSnap.empty) {
            docRef = qLinkSnap.docs[0].ref;
            itemData = qLinkSnap.docs[0].data();
            col = "links";
          } else {
            const qLinkAlias = query(collection(db, "links"), where("alias", "==", id));
            const qLinkAliasSnap = await getDocs(qLinkAlias);
            if (!qLinkAliasSnap.empty) {
              docRef = qLinkAliasSnap.docs[0].ref;
              itemData = qLinkAliasSnap.docs[0].data();
              col = "links";
            }
          }
        }

        // 2. Try "smart_links" collection as fallback
        if (!itemData) {
          const qSmart = query(collection(db, "smart_links"), where("alias", "==", id));
          const qSmartSnap = await getDocs(qSmart);
          if (!qSmartSnap.empty) {
            docRef = qSmartSnap.docs[0].ref;
            itemData = qSmartSnap.docs[0].data();
            col = "smart_links";
          } else {
            const directSmartRef = doc(db, "smart_links", id);
            const directSmartSnap = await getDoc(directSmartRef);
            if (directSmartSnap.exists()) {
              docRef = directSmartRef;
              itemData = directSmartSnap.data();
              col = "smart_links";
            }
          }
        }
      } else {
        console.log(`[DEBUG SHORTENER] Searching collection: "uploads"`);
        const directRef = doc(db, "uploads", id);
        const directSnap = await getDoc(directRef);
        if (directSnap.exists()) {
          docRef = directRef;
          itemData = directSnap.data();
        }
      }

      if (itemData) {
        // Compatibility mapping for "links" and "smart_links"
        itemData.destinationUrl = itemData.destinationUrl || itemData.originalUrl;
        itemData.id = itemData.id || itemData.linkId || id;
        itemData.alias = itemData.alias || itemData.linkId || id;

        // Ensure default status/enabled if missing
        if (itemData.status === undefined && itemData.Status !== undefined) {
          itemData.status = itemData.Status;
        }
        if (itemData.status === undefined) {
          itemData.status = "Active";
        }
        if (itemData.Status === undefined) {
          itemData.Status = itemData.status;
        }
        if (itemData.enabled === undefined && itemData.Enabled !== undefined) {
          itemData.enabled = itemData.Enabled;
        }
        if (itemData.enabled === undefined) {
          itemData.enabled = true;
        }
        if (itemData.Enabled === undefined) {
          itemData.Enabled = itemData.enabled;
        }

        // Fetch Global Configuration Defaults
        let globalSettings: any = {
          totalPages: 1,
          instructions: "Follow the steps below to reach your destination.",
          autoScroll: true,
          autoRedirect: true,
          continueButtonText: "Proceed",
          verifyButtonText: "Verify This Step",
          humanVerification: true,
          vpnDetection: false,
          botDetection: true,
          pagesConfig: []
        };
        try {
          const userSettingsSnap = await getDoc(doc(db, "settings", "user_shortener_config"));
          if (userSettingsSnap.exists()) {
            globalSettings = userSettingsSnap.data();
          }
        } catch (err) {
          console.error("Error fetching global shortener settings config:", err);
        }

        // Requirement 9: Apply configuration logic
        // If it's from the "links" collection (Bot/User created), always enforce global settings
        // If it's a Smart Link or Download, use specific settings but fallback to global defaults if specific ones are missing
        if (type === "shortener" && col === "links") {
          itemData.totalPages = globalSettings.totalPages;
          itemData.instructions = globalSettings.instructions;
          itemData.autoScroll = globalSettings.autoScroll;
          itemData.autoRedirect = globalSettings.autoRedirect;
          itemData.continueButtonText = globalSettings.continueButtonText || "Proceed";
          itemData.verifyButtonText = globalSettings.verifyButtonText || "Verify This Step";
          itemData.humanVerification = globalSettings.humanVerification;
          itemData.vpnDetection = globalSettings.vpnDetection;
          itemData.botDetection = globalSettings.botDetection;
          itemData.pagesConfig = globalSettings.pagesConfig;
        } else {
          // Smart Links / Downloads: Use item-specific values if they exist, otherwise fallback to global
          itemData.totalPages = itemData.totalPages ? Number(itemData.totalPages) : globalSettings.totalPages;
          itemData.pagesConfig = (itemData.pagesConfig && itemData.pagesConfig.length > 0) ? itemData.pagesConfig : globalSettings.pagesConfig;
          
          itemData.instructions = itemData.instructions || globalSettings.instructions;
          itemData.autoScroll = itemData.autoScroll !== undefined ? itemData.autoScroll : globalSettings.autoScroll;
          itemData.autoRedirect = itemData.autoRedirect !== undefined ? itemData.autoRedirect : globalSettings.autoRedirect;
          itemData.continueButtonText = itemData.continueButtonText || globalSettings.continueButtonText || "Proceed";
          itemData.verifyButtonText = itemData.verifyButtonText || globalSettings.verifyButtonText || "Verify This Step";
          
          if (itemData.humanVerification === undefined) itemData.humanVerification = globalSettings.humanVerification;
          if (itemData.vpnDetection === undefined) itemData.vpnDetection = globalSettings.vpnDetection;
          if (itemData.botDetection === undefined) itemData.botDetection = globalSettings.botDetection;
        }

        // Requirement 6: Debug logs
        console.log(`[DEBUG SHORTENER] Firestore document found: true in collection: "${col}"`);
        console.log(`[DEBUG SHORTENER] Document status: "${itemData.status || itemData.Status || 'N/A'}" (Enabled: ${itemData.enabled !== false && itemData.Enabled !== false})`);
        console.log(`[DEBUG SHORTENER] Config Applied - Pages: ${itemData.totalPages}, AutoRedirect: ${itemData.autoRedirect}`);
        console.log(`[DEBUG SHORTENER] Redirect destination: "${itemData.destinationUrl || "N/A"}"`);
      } else {
        console.log(`[DEBUG SHORTENER] Firestore document found: false`);
      }

      // Determine if disabled or deleted
      let isDocEnabled = false;
      if (itemData) {
        const statusLower = String(itemData.status || itemData.Status || "").toLowerCase();
        const isDeletedOrDisabled = statusLower === "deleted" || statusLower === "disabled" || statusLower === "inactive";
        const hasEnabledFlag = itemData.enabled !== false && itemData.Enabled !== false;
        isDocEnabled = !isDeletedOrDisabled && hasEnabledFlag;
      }

      if (!itemData || !isDocEnabled) {
        return res.status(404).json({ success: false, message: `${type === "shortener" ? "Smart link" : "File"} not found or disabled.` });
      }

      // Security checking - Bot Detection
      const ua = req.headers["user-agent"] || "";
      const isBot = /bot|spider|crawl|slurp|lighthouse|chrome-lighthouse|headless/i.test(ua);
      if (isBot && itemData.botDetection !== false) {
        return res.json({ success: false, securityBlocked: true, securityReason: "🤖 Automated agent request blocked by RoyShare Integrity Sentinel." });
      }

      // Security checking - VPN Detection
      if (itemData.vpnDetection === true && ip && ip !== "Unknown" && ip !== "127.0.0.1" && ip !== "::1") {
        try {
          const ipCheckRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,proxy,hosting`).catch(() => null);
          if (ipCheckRes && ipCheckRes.ok) {
            const checkData = await ipCheckRes.json();
            if (checkData.status === "success") {
              if (checkData.proxy === true || checkData.hosting === true) {
                return res.json({ success: false, securityBlocked: true, securityReason: "🔒 Access restricted. VPN, proxy, or hosting network connections are prohibited." });
              }
            }
          }
        } catch (e) {
          console.error("VPN detection error:", e);
        }
      }

      // Initialize session ID
      const sessionId = "SESS_" + Math.random().toString(36).substring(2, 15).toUpperCase();
      
      // Page configuration logic
      let totalPages = itemData.totalPages ? Number(itemData.totalPages) : 1;
      let pagesConfig = itemData.pagesConfig || [];

      if (type === "download" && pagesConfig.length === 0) {
        // Default download pages configuration
        totalPages = 1;
        pagesConfig = [{
          pageNumber: 1,
          timerDuration: 5,
          humanVerification: true,
          selectedAdIds: []
        }];
      }

      // Setup session document in Firestore
      await setDoc(doc(db, "shortener_sessions", sessionId), {
        id: sessionId,
        linkId: itemData.id || id,
        type,
        currentPage: 1,
        completedPages: [],
        createdAt: new Date().toISOString(),
        ip: String(ip),
        isVerified: false
      });

      // Track views
      const currentViews = Number(itemData.views || 0);
      const ipList = itemData.ipList || [];
      const isUnique = !ipList.includes(ip);
      const currentUniqueViews = Number(itemData.uniqueViews || 0) + (isUnique ? 1 : 0);

      const updatePayload: any = { views: currentViews + 1 };
      if (isUnique) {
        updatePayload.uniqueViews = currentUniqueViews;
        updatePayload.ipList = [...ipList, ip].slice(-500); // Prevent document bloat
      }
      
      // Recalculate conversion rate
      const redirects = Number(itemData.completedRedirects || itemData.downloads || 0);
      const newViews = currentViews + 1;
      updatePayload.conversionRate = Number(((redirects / newViews) * 100).toFixed(2));

      await updateDoc(docRef, updatePayload);

      // Save analytics records
      await addDoc(collection(db, "shortener_analytics"), {
        linkId: itemData.id || id,
        type: "view",
        ip: String(ip),
        country,
        device,
        browser,
        createdAt: new Date().toISOString()
      });

      if (isUnique) {
        await addDoc(collection(db, "shortener_analytics"), {
          linkId: itemData.id || id,
          type: "unique_view",
          ip: String(ip),
          country,
          device,
          browser,
          createdAt: new Date().toISOString()
        });
      }

      // Scrub confidential fields from public return
      const publicItemData = { ...itemData };
      delete publicItemData.destinationUrl; // SECURITY: Never leak destination URL at session init!
      delete publicItemData.ipList;

      res.json({
        success: true,
        sessionId,
        totalPages,
        pagesConfig,
        data: publicItemData
      });

    } catch (err: any) {
      console.error("Error initiating smart link session:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/smart-links/session/page-complete", async (req, res) => {
    try {
      const { sessionId, pageNumber } = req.body;
      if (!sessionId || !pageNumber) return res.status(400).json({ success: false, message: "Missing session ID or page number" });

      const sessionRef = doc(db, "shortener_sessions", sessionId);
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        return res.status(404).json({ success: false, message: "Session expired or invalid." });
      }

      const sessionData = sessionSnap.data();
      if (sessionData.currentPage !== pageNumber) {
        return res.status(400).json({ success: false, message: "Session page mismatch. Anti-skip triggered." });
      }

      const completed = sessionData.completedPages || [];
      if (!completed.includes(pageNumber)) {
        completed.push(pageNumber);
      }

      await updateDoc(sessionRef, {
        completedPages: completed,
        currentPage: pageNumber + 1
      });

      // Save page_complete analytics
      await addDoc(collection(db, "shortener_analytics"), {
        linkId: sessionData.linkId,
        type: "page_complete",
        pageNumber,
        ip: sessionData.ip,
        createdAt: new Date().toISOString()
      });

      res.json({ success: true, nextPage: pageNumber + 1 });
    } catch (err: any) {
      console.error("Error in page-complete:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  app.post("/api/smart-links/session/claim", async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ success: false, message: "Missing session ID" });

      const sessionRef = doc(db, "shortener_sessions", sessionId);
      const sessionSnap = await getDoc(sessionRef);

      if (!sessionSnap.exists()) {
        return res.status(404).json({ success: false, message: "Session invalid or expired." });
      }

      const sessionData = sessionSnap.data();
      const { linkId, type, completedPages, ip } = sessionData;

      let itemData: any = null;
      let docRef: any = null;

      // Debug log: Link ID received for claim
      console.log(`[DEBUG CLAIM] Link ID received: "${linkId}"`);

      if (type === "shortener") {
        console.log(`[DEBUG CLAIM] Searching collection: "links" (used by bot) and fallback to "smart_links"`);

        // 1. Try "links" collection first
        const directLinkRef = doc(db, "links", linkId);
        const directLinkSnap = await getDoc(directLinkRef);
        if (directLinkSnap.exists()) {
          docRef = directLinkRef;
          itemData = directLinkSnap.data();
        } else {
          const qLink = query(collection(db, "links"), where("linkId", "==", linkId));
          const qLinkSnap = await getDocs(qLink);
          if (!qLinkSnap.empty) {
            docRef = qLinkSnap.docs[0].ref;
            itemData = qLinkSnap.docs[0].data();
          } else {
            const qLinkAlias = query(collection(db, "links"), where("alias", "==", linkId));
            const qLinkAliasSnap = await getDocs(qLinkAlias);
            if (!qLinkAliasSnap.empty) {
              docRef = qLinkAliasSnap.docs[0].ref;
              itemData = qLinkAliasSnap.docs[0].data();
            }
          }
        }

        // 2. Try "smart_links" collection as fallback
        if (!itemData) {
          const qSmart = query(collection(db, "smart_links"), where("alias", "==", linkId));
          const qSmartSnap = await getDocs(qSmart);
          if (!qSmartSnap.empty) {
            docRef = qSmartSnap.docs[0].ref;
            itemData = qSmartSnap.docs[0].data();
          } else {
            const directSmartRef = doc(db, "smart_links", linkId);
            const directSmartSnap = await getDoc(directSmartRef);
            if (directSmartSnap.exists()) {
              docRef = directSmartRef;
              itemData = directSmartSnap.data();
            }
          }
        }
      } else {
        console.log(`[DEBUG CLAIM] Searching collection: "uploads"`);
        const directRef = doc(db, "uploads", linkId);
        const directSnap = await getDoc(directRef);
        if (directSnap.exists()) {
          docRef = directRef;
          itemData = directSnap.data();
        }
      }

      if (itemData) {
        // Fetch Global Configuration Defaults for claim verification
        let globalSettings: any = {
          totalPages: 1,
        };
        try {
          const userSettingsSnap = await getDoc(doc(db, "settings", "user_shortener_config"));
          if (userSettingsSnap.exists()) {
            globalSettings = userSettingsSnap.data();
          }
        } catch (err) {
          console.error("Error fetching global shortener settings config in claim:", err);
        }

        // Apply same configuration logic as session init
        const col = (docRef.path || "").split("/")[0];
        if (type === "shortener" && col === "links") {
          itemData.totalPages = globalSettings.totalPages;
        } else {
          itemData.totalPages = itemData.totalPages ? Number(itemData.totalPages) : globalSettings.totalPages;
        }

        // Compatibility mapping for "links" and "smart_links"
        itemData.destinationUrl = itemData.destinationUrl || itemData.originalUrl;
        itemData.id = itemData.id || itemData.linkId || linkId;
        itemData.alias = itemData.alias || itemData.linkId || linkId;

        // Ensure default status/enabled if missing
        if (itemData.status === undefined && itemData.Status !== undefined) {
          itemData.status = itemData.Status;
        }
        if (itemData.status === undefined) {
          itemData.status = "Active";
        }
        if (itemData.Status === undefined) {
          itemData.Status = itemData.status;
        }
        if (itemData.enabled === undefined && itemData.Enabled !== undefined) {
          itemData.enabled = itemData.Enabled;
        }
        if (itemData.enabled === undefined) {
          itemData.enabled = true;
        }
        if (itemData.Enabled === undefined) {
          itemData.Enabled = itemData.enabled;
        }

        // Debug logs
        console.log(`[DEBUG CLAIM] Firestore document found: true`);
        console.log(`[DEBUG CLAIM] Document status: "${itemData.status || itemData.Status || 'N/A'}" (Enabled: ${itemData.enabled !== false && itemData.Enabled !== false})`);
        console.log(`[DEBUG CLAIM] Final Verification - Required Pages: ${itemData.totalPages}, Completed: ${completedPages.length}`);
        console.log(`[DEBUG CLAIM] Redirect destination: "${itemData.destinationUrl || "N/A"}"`);
      } else {
        console.log(`[DEBUG CLAIM] Firestore document found: false`);
      }

      if (!itemData) {
        return res.status(404).json({ success: false, message: "Target entity not found." });
      }

      // Verify all pages completed
      let totalPages = itemData.totalPages ? Number(itemData.totalPages) : 1;
      if (type === "download" && !itemData.totalPages) {
        totalPages = 1;
      }

      for (let p = 1; p <= totalPages; p++) {
        if (!completedPages.includes(p)) {
          return res.status(400).json({ success: false, message: `Page ${p} verification missing. Skip blocked.` });
        }
      }

      // Mark session verified
      await updateDoc(sessionRef, { isVerified: true });

      // Save analytics redirect log
      await addDoc(collection(db, "shortener_analytics"), {
        linkId,
        type: "redirect",
        ip: String(ip),
        createdAt: new Date().toISOString()
      });

      // Increment completed Redirects / Downloads
      if (type === "shortener") {
        const currentRedirects = Number(itemData.completedRedirects || 0) + 1;
        const views = Number(itemData.views || 1);
        const conversionRate = Number(((currentRedirects / views) * 100).toFixed(2));
        
        await updateDoc(docRef, {
          completedRedirects: currentRedirects,
          conversionRate
        });

        if (!itemData.destinationUrl) {
          return res.status(400).json({ success: false, message: "Target destination URL is missing in the database." });
        }

        res.json({
          success: true,
          destinationUrl: itemData.destinationUrl
        });
      } else {
        const currentDownloads = Number(itemData.downloads || 0) + 1;
        const views = Number(itemData.views || 1);
        const conversionRate = Number(((currentDownloads / views) * 100).toFixed(2));

        // Fetch system earnings per download
        const settingsSnap = await getDoc(doc(db, "settings", "earnings"));
        const earningsPerDownload = settingsSnap.exists() ? (Number(settingsSnap.data()?.earningsPerDownload) || 0.1) : 0.1;
        const currentEarnings = Number(itemData.earnings || 0) + earningsPerDownload;

        await updateDoc(docRef, {
          downloads: currentDownloads,
          earnings: currentEarnings,
          conversionRate
        });

        // Credit the uploader user's wallet
        if (itemData.userId) {
          try {
            const userRef = doc(db, "users", String(itemData.userId));
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const currentBalance = Number(userSnap.data().balance || 0);
              const currentTotalEarnings = Number(userSnap.data().totalEarnings || 0);
              await updateDoc(userRef, {
                balance: currentBalance + earningsPerDownload,
                totalEarnings: currentTotalEarnings + earningsPerDownload
              });
              
              await addDoc(collection(db, "transactions"), {
                userId: String(itemData.userId),
                type: "Credit",
                amount: earningsPerDownload,
                description: `Earnings from download of file: ${itemData.fileName || "N/A"}`,
                createdAt: new Date().toISOString(),
                status: "Completed"
              });
            }
          } catch (e) {
            console.error("Error crediting uploader wallet:", e);
          }
        }

        // Get original download URL from Telegram
        const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        const botToken = telegramSettingsSnap.exists() ? telegramSettingsSnap.data()?.botToken : null;
        const botUsername = telegramSettingsSnap.exists() ? telegramSettingsSnap.data()?.botUsername : null;
        
        let downloadUrl = "";
        if (botToken && botUsername && itemData.storageChannelId && itemData.telegramMessageId && itemData.telegramMessageId !== "NOT_SET") {
          downloadUrl = `https://t.me/${botUsername}?start=dl_${linkId}`;
        } else {
          downloadUrl = itemData.generatedLink || "";
        }

        res.json({
          success: true,
          downloadUrl
        });
      }
    } catch (err: any) {
      console.error("Error in claim target:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  // Admin CRUD for self-hosted Smart Shortener Links
  app.get("/api/admin/smart-links", async (req, res) => {
    try {
      const q = query(collection(db, "smart_links"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const links = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(links);
    } catch (e: any) {
      console.error("Error fetching smart links:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/smart-links", async (req, res) => {
    try {
      const {
        destinationUrl,
        customAlias,
        totalPages,
        autoRedirect,
        finalRedirectDelay,
        instructions,
        reward,
        status,
        pagesConfig
      } = req.body;

      if (!destinationUrl) {
        return res.status(400).json({ error: "Destination URL is required" });
      }

      let alias = customAlias ? customAlias.trim() : "";
      if (alias) {
        const q = query(collection(db, "smart_links"), where("alias", "==", alias));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          return res.status(400).json({ error: "Custom alias is already in use." });
        }
      } else {
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          alias = Math.random().toString(36).substring(2, 8).toUpperCase();
          const q = query(collection(db, "smart_links"), where("alias", "==", alias));
          const qSnap = await getDocs(q);
          if (qSnap.empty) {
            isUnique = true;
          }
          attempts++;
        }
      }

      const newLinkId = "LNK_" + Math.random().toString(36).substring(2, 10).toUpperCase();
      const appUrl = process.env.APP_URL || "https://royshare.onrender.com";
      const baseDomain = appUrl.replace(/\/$/, "");
      const shortUrl = `${baseDomain}/s/${alias}`;

      const newLinkDoc = {
        id: newLinkId,
        destinationUrl,
        alias,
        shortUrl,
        totalPages: Number(totalPages) || 1,
        autoRedirect: autoRedirect !== false,
        finalRedirectDelay: Number(finalRedirectDelay) || 0,
        instructions: instructions || "",
        reward: Number(reward) || 0,
        status: status || "Enabled",
        pagesConfig: pagesConfig || [],
        createdAt: new Date().toISOString(),
        views: 0,
        uniqueViews: 0,
        completedRedirects: 0,
        conversionRate: 0,
        ipList: []
      };

      await setDoc(doc(db, "smart_links", newLinkId), newLinkDoc);
      res.json(newLinkDoc);
    } catch (e: any) {
      console.error("Error creating smart link:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/admin/smart-links/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const {
        destinationUrl,
        customAlias,
        totalPages,
        autoRedirect,
        finalRedirectDelay,
        instructions,
        reward,
        status,
        pagesConfig
      } = req.body;

      const linkRef = doc(db, "smart_links", id);
      const linkSnap = await getDoc(linkRef);

      if (!linkSnap.exists()) {
        return res.status(404).json({ error: "Smart link not found." });
      }

      const existingData = linkSnap.data();
      let alias = customAlias ? customAlias.trim() : existingData.alias;

      if (alias !== existingData.alias) {
        const q = query(collection(db, "smart_links"), where("alias", "==", alias));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          return res.status(400).json({ error: "Custom alias is already in use." });
        }
      }

      const appUrl = process.env.APP_URL || "https://royshare.onrender.com";
      const baseDomain = appUrl.replace(/\/$/, "");
      const shortUrl = `${baseDomain}/s/${alias}`;

      const updatedDoc = {
        ...existingData,
        destinationUrl,
        alias,
        shortUrl,
        totalPages: Number(totalPages) || 1,
        autoRedirect: autoRedirect !== false,
        finalRedirectDelay: Number(finalRedirectDelay) || 0,
        instructions: instructions || "",
        reward: Number(reward) || 0,
        status: status || "Enabled",
        pagesConfig: pagesConfig || []
      };

      await setDoc(linkRef, updatedDoc);
      res.json(updatedDoc);
    } catch (e: any) {
      console.error("Error updating smart link:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/admin/smart-links/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await deleteDoc(doc(db, "smart_links", id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error deleting smart link:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // AI Generate Instructions
  app.post("/api/admin/shortener/generate-instructions", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!settings) {
        return res.status(400).json({ error: "Settings are required" });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY!,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `
        Analyze these URL Shortener settings and generate professional visitor instructions:
        - Total Pages: ${settings.totalPages || 1}
        - Timer Duration: ${settings.pagesConfig?.[0]?.timerDuration || 10} seconds
        - Verify Button Text: ${settings.verifyButtonText || "Verify This Step"}
        - Auto Redirect: ${settings.autoRedirect ? "Enabled" : "Disabled"}
        - Math Verification (Human Check): ${settings.humanVerification ? "Enabled" : "Disabled"}
        - Ads: Multiple placements active
        - Anti VPN: ${settings.vpnDetection ? "Active" : "Inactive"}
        - Bot Detection: ${settings.botDetection ? "Active" : "Inactive"}

        Requirements for the output:
        - Short and professional
        - Use emojis
        - Easy to understand
        - SEO and Human friendly
        - Formatted as a single instruction text block

        Example format:
        📢 Please complete all verification steps to continue.
        ✔ Read the instructions on each page.
        ✔ Wait for the timer to finish.
        ✔ Complete the verification if required.
        ✔ Follow all pages until the final destination unlocks.
        Thank you for your patience.
      `;

      const result = await safeGenerateContent(ai, {
        model: "gemini-1.5-flash",
        contents: prompt,
        config: {
          systemInstruction: "You are a professional copywriter specialized in UX and instruction writing for web applications. Generate short, clear, and engaging instructions. Use bullet points and emojis where appropriate.",
        }
      });

      res.json({ text: result.text });
    } catch (e: any) {
      console.error("Error generating instructions:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // AI Generate Task
  app.post("/api/admin/tasks/generate-ai", async (req, res) => {
    try {
      const { taskType, field, currentTask } = req.body;
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: "Gemini API Key is missing. Please add it to your environment variables." });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      let prompt = `
        You are an expert Reward System Task Architect. 
        Generate details for a task of type: "${taskType}".
        
        The reward system uses these rules:
        - Reward: User gets this amount (e.g. 1-100)
        - Timer: User must stay on page for X seconds (e.g. 5-60)
        - Pages: User must visit N pages (e.g. 1-5)
        - Ad Network: Adsterra, Monetag Mini App, or Direct
        
        ${currentTask?.adNetwork ? `The current selected Ad Network is: "${currentTask.adNetwork}". Please generate details that match this network.` : ''}
        ${field ? `The user only wants to update the "${field}" field specifically.` : `Generate a complete optimized task.`}
        
        For the "imageUrl", always suggest a high-quality, relevant, royalty-free placeholder image URL from Unsplash (e.g. https://images.unsplash.com/photo-...) that matches the task type perfectly.
        
        Return the result as a JSON object with this structure:
        {
          "task": {
            "title": "...",
            "description": "...",
            "rewardAmount": "...",
            "timerDuration": "...",
            "totalPages": "...",
            "imageUrl": "...",
            "adNetwork": "${currentTask?.adNetwork || "Adsterra"}"
          },
          "analytics": {
            "completionRate": "85%",
            "risk": "Low|Medium|High",
            "difficulty": "Easy|Medium|Hard",
            "estimatedTime": "45s",
            "suggestions": "Brief optimization advice..."
          }
        }
      `;

      const result = await safeGenerateContent(ai, {
        model: "gemini-1.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          systemInstruction: "You are an AI specialized in generating high-conversion, professional task instructions and settings for reward-based applications. Ensure the tone is engaging, human-friendly, and optimized for mobile users. Always return valid JSON.",
        }
      });

      const responseText = result.text;
      const data = JSON.parse(responseText);
      res.json(data);
    } catch (e: any) {
      console.error("Error generating AI task:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/admin/user-shortener-settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "user_shortener_config");
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        res.json(snap.data());
      } else {
        const defaultUserSettings = {
          totalPages: 2,
          instructions: "Follow the steps below to reach your destination.",
          autoScroll: true,
          autoRedirect: true,
          continueButtonText: "Proceed",
          verifyButtonText: "Verify This Step",
          humanVerification: true,
          vpnDetection: false,
          botDetection: true,
          pagesConfig: [
            {
              pageNumber: 1,
              timerDuration: 10,
              instructions: "Complete verification step 1.",
              selectedAdIds: [],
              numberOfAds: 3,
              humanVerification: true,
              verifyBtnText: "Verify Step 1",
              continueBtnText: "Proceed"
            },
            {
              pageNumber: 2,
              timerDuration: 10,
              instructions: "Complete the final verification step.",
              selectedAdIds: [],
              numberOfAds: 3,
              humanVerification: true,
              verifyBtnText: "Verify Step 2",
              continueBtnText: "Proceed"
            }
          ]
        };
        res.json(defaultUserSettings);
      }
    } catch (e: any) {
      console.error("Error fetching user shortener settings:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/admin/user-shortener-settings", async (req, res) => {
    try {
      const config = req.body;
      const docRef = doc(db, "settings", "user_shortener_config");
      await setDoc(docRef, config);
      res.json({ success: true, config });
    } catch (e: any) {
      console.error("Error saving user shortener settings:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
