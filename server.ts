import { handleUpdate, submitWithdrawalRequest } from "./src/bot";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { getDb } from "./src/lib/firebase";
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, getCountFromServer, collectionGroup, deleteDoc, orderBy, updateDoc } from "firebase/firestore";
import { REWARD_TASKS } from "./src/lib/tasks";
import { GoogleGenAI } from "@google/genai";

// ...
const db = getDb();

async function startServer() {
  const app = express();
  app.use(express.json());

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

  const sendTgMessage = async (chatId: string, text: string) => {
      const botToken = await getBotToken();
      if (!botToken) return;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
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
      await sendTgMessage(data.userId, `✅ <b>Ticket Resolved</b>\n\nTicket ID:\n${id}\n\nThank you for contacting support.`);
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
      await sendTgMessage(data.userId, `🔴 <b>Ticket Closed</b>\n\nTicket ID:\n${id}`);
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
      const statusLabels: Record<string, string> = {
        open: "🟡 Open",
        in_progress: "🔵 In Progress",
        resolved: "🟢 Resolved",
        closed: "🔴 Closed"
      };
      const label = statusLabels[status] || status;
      await sendTgMessage(data.userId, `ℹ️ <b>Ticket Status Updated</b>\n\nTicket ID:\n${id}\n\nNew Status: ${label}`);
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

      const modelToUse = geminiModel || "gemini-2.5-flash";

      const ai = new GoogleGenAI({
        apiKey: apiKeyToUse,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const startTime = Date.now();
      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: "Hello",
      });
      const endTime = Date.now();
      const durationMs = endTime - startTime;

      if (response && response.text) {
        // Save test diagnostics back to Firestore doc (settings/support)
        const docRef = doc(db, "settings", "support");
        const diagData = {
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

  // Gemini AI Chat Proxy
  app.post("/api/support/ai-chat", async (req, res) => {
    try {
      const { messages, newMessage } = req.body;
      
      const supportSettingsRef = doc(db, "settings", "support");
      const supportSettingsSnap = await getDoc(supportSettingsRef);
      const supportData = supportSettingsSnap.exists() ? supportSettingsSnap.data() : { aiEnabled: true, geminiApiKey: "", geminiModel: "gemini-2.5-flash" };
      
      if (supportData.aiEnabled === false) {
        return res.status(403).json({ error: "AI Support is currently unavailable." });
      }
      
      const apiKey = supportData.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API Key is not configured." });
      }
      
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      const selectedModel = supportData.geminiModel || "gemini-2.5-flash";
      
      const chat = ai.chats.create({
        model: selectedModel,
        config: {
          systemInstruction: "You are an automated support assistant for RoyShare, a secure Telegram-powered file sharing & URL shortener platform. Assist the user with issues related to Account, Rewards, Withdrawal, Tasks, Telegram Bot, or Technical Issues. Keep answers helpful, empathetic, concise, and professional. If you cannot answer or fully resolve the user's issue, you must output exactly: 'I couldn't fully resolve your issue. Please create a support ticket.'"
        },
        history: (messages || []).map((m: any) => ({
          role: m.sender === "user" ? "user" : "model",
          parts: [{ text: m.text }]
        }))
      });
      
      const response = await chat.sendMessage({ message: newMessage });
      res.json({ reply: response.text });
    } catch (e: any) {
      console.error("AI chat error:", e);
      // Return the fallback response as requested when AI cannot answer
      res.json({ reply: "I couldn't fully resolve your issue. Please create a support ticket." });
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
      const docRef = await addDoc(collection(db, "tasks"), {
        ...payload,
        createdAt: new Date().toISOString(),
        participants: 0,
        completedUsers: 0,
        totalRewardsDistributed: 0
      });
      res.json({ success: true, id: docRef.id });
    } catch (e: any) {
      console.error("Admin task create error:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/admin/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const payload = req.body;
      await setDoc(doc(db, "tasks", id), payload, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin task update error:", e);
      res.status(500).json({ error: "Server error" });
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
      const q = query(collection(db, "taskCompletions"));
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

  app.put("/api/admin/users/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      const userRef = doc(db, "users", id);
      await setDoc(userRef, { status, banReason: reason || null }, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("Admin user status update error:", e);
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
      if (!apiKey) {
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
      const broadcastsRef = collection(db, "broadcasts");
      const docRef = await addDoc(broadcastsRef, {
        ...payload,
        createdAt: new Date().toISOString(),
        deliveredCount: 0,
        failedCount: 0,
        viewCount: 0,
        clickCount: 0
      });
      res.json({ id: docRef.id, ...payload });
    } catch (error: any) {
      console.error("Error creating broadcast:", error);
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
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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
  app.post("/api/telegram/webhook", async (req, res) => {
    console.log("-----------------------------------------");
    console.log("📥 Incoming Telegram Webhook Request Received");
    
    // 5. Verify all environment variables are loaded
    const envStatus = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "LOADED" : "MISSING",
      APP_URL: process.env.APP_URL ? "LOADED" : "MISSING",
      NODE_ENV: process.env.NODE_ENV || "development"
    };
    console.log("🔍 Webhook Environment Verification:", JSON.stringify(envStatus));

    try {
      // 6. Verify Firestore/database access
      console.log("🔍 Webhook: Verifying Firestore database access...");
      const settingsDocRef = doc(db, "settings", "telegram");
      const settingsSnap = await getDoc(settingsDocRef);
      
      if (!settingsSnap.exists()) {
        throw new Error("Firestore access failed: settings/telegram document does not exist in the database.");
      }
      console.log("✅ Webhook: Firestore database access verified successfully.");

      const data = settingsSnap.data();
      const botToken = data?.botToken;
      
      if (!botToken) {
        throw new Error("Validation Error: botToken is missing or empty in Firestore settings/telegram document.");
      }
      console.log("✅ Webhook: Telegram Bot Token loaded from database.");

      // 7. Verify every Telegram API request (Check if request body is valid)
      const update = req.body;
      if (!update || typeof update !== "object") {
        console.warn("⚠️ Webhook received invalid/empty body payload.");
        return res.status(400).json({ error: "Invalid payload: body is empty or not an object" });
      }

      // Check for manual webhook diagnostics ping
      if (update.test_webhook === true) {
        console.log("ℹ️ Webhook manual verification/test request processed successfully.");
        return res.status(200).json({
          ok: true,
          status: "alive",
          envStatus,
          databaseAccess: "verified",
          message: "Telegram webhook endpoint is online and functioning perfectly!"
        });
      }

      if (update.update_id === undefined) {
        console.warn("⚠️ Webhook payload lacks 'update_id'. Skipping processing.");
        return res.status(200).json({ ok: true, message: "Payload lacks update_id, no action taken." });
      }

      console.log(`📥 Processing Update ID: ${update.update_id}`);

      // 8. Ensure the webhook always returns HTTP 200 immediately after processing
      // We will spawn the processing promise and respond with HTTP 200 immediately
      handleUpdate(botToken, update)
        .then(() => {
          console.log(`✅ Successfully processed update ID ${update.update_id}`);
        })
        .catch(async (err: any) => {
          // 2. Catch every exception with try/catch
          // 3. Log the complete stack trace
          console.error(`🔴 Exception inside handleUpdate for Update ID ${update.update_id}:`);
          console.error(err.stack || err);

          // 4. Extract and log exact file name and line number
          let errSource = "unknown source";
          if (err.stack) {
            const lines = err.stack.split("\n");
            for (const l of lines) {
              if (l.includes("at ") && !l.includes("node_modules") && !l.includes("node:internal")) {
                const match = l.match(/at\s+(?:.*\s+\()?([^)]+)\)?/);
                if (match && match[1]) {
                  errSource = match[1].trim();
                  break;
                }
              }
            }
          }
          console.error(`🔴 Exact source of failure: ${errSource}`);

          // Update Firestore settings document with the error detail so it displays on UI
          try {
            await setDoc(doc(db, "settings", "telegram"), {
              lastWebhookError: err.message || String(err),
              lastWebhookErrorSource: errSource,
              lastWebhookErrorStack: err.stack || "",
              lastWebhookErrorTime: new Date().toISOString()
            }, { merge: true });
            console.log("💾 Error state persisted in settings/telegram doc.");
          } catch (dbErr) {
            console.error("Failed to write webhook error to Firestore settings/telegram:", dbErr);
          }
        });

      // Send immediate HTTP 200 OK back to Telegram
      return res.status(200).json({ ok: true, status: "processing" });

    } catch (e: any) {
      // 2. Catch every exception with try/catch inside outer webhook route
      // 3. Log the complete stack trace
      console.error("🔴 Webhook Outer Handler Exception Caught:");
      console.error(e.stack || e);

      // 4. Display the exact file name and line number causing the failure
      let errorSource = "unknown source";
      if (e.stack) {
        const stackLines = e.stack.split("\n");
        for (const line of stackLines) {
          if (line.includes("at ") && !line.includes("node_modules") && !line.includes("node:internal") && !line.includes("express")) {
            const match = line.match(/at\s+(?:.*\s+\()?([^)]+)\)?/);
            if (match && match[1]) {
              errorSource = match[1].trim();
              break;
            }
          }
        }
      }
      console.error(`🔴 Exact source of failure: ${errorSource}`);

      // Persistent log of the error to settings/telegram Firestore doc
      try {
        await setDoc(doc(db, "settings", "telegram"), {
          lastWebhookError: e.message || String(e),
          lastWebhookErrorSource: errorSource,
          lastWebhookErrorStack: e.stack || "",
          lastWebhookErrorTime: new Date().toISOString()
        }, { merge: true });
        console.log("💾 Outer error state persisted in settings/telegram doc.");
      } catch (dbErr) {
        console.error("Failed to write outer webhook error to Firestore settings/telegram:", dbErr);
      }

      // 8. Ensure the webhook always returns HTTP 200 immediately after processing (even on failure to avoid Telegram retries)
      return res.status(200).json({ 
        ok: true, 
        status: "failed", 
        error: e.message || String(e), 
        source: errorSource 
      });
    }
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

      // Merge hardcoded REWARD_TASKS and Firestore dbTasks (dbTasks take precedence if matching ID)
      const taskMap = new Map<string, any>();
      REWARD_TASKS.forEach(t => taskMap.set(t.id, t));
      dbTasks.forEach(t => {
        // Only return Active tasks to the user
        if (t.status === "🟢 Active" || String(t.status || "").toLowerCase().includes("active")) {
          taskMap.set(t.id, t);
        }
      });
      const mergedTasks = Array.from(taskMap.values());

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
          amount = Number(dbTaskSnap.data()?.rewardAmount) || 0;
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
        const task = REWARD_TASKS.find(t => t.id === taskId);
        if (!task) return res.status(400).json({ error: "Invalid taskId" });
        amount = task.amount;
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
      let col = type === "shortener" ? "smart_links" : "uploads";

      if (type === "shortener") {
        // Find the smart link. Note: id can be the alias or the id itself!
        const q = query(collection(db, "smart_links"), where("alias", "==", id));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          docRef = qSnap.docs[0].ref;
          itemData = qSnap.docs[0].data();
        } else {
          const directRef = doc(db, "smart_links", id);
          const directSnap = await getDoc(directRef);
          if (directSnap.exists()) {
            docRef = directRef;
            itemData = directSnap.data();
          }
        }
      } else {
        const directRef = doc(db, "uploads", id);
        const directSnap = await getDoc(directRef);
        if (directSnap.exists()) {
          docRef = directRef;
          itemData = directSnap.data();
        }
      }

      if (!itemData || itemData.status === "deleted" || itemData.status === "Disabled") {
        return res.status(404).json({ success: false, message: `${type === "shortener" ? "Smart link" : "File"} not found or disabled.` });
      }

      // Security checking
      const ua = req.headers["user-agent"] || "";
      const isBot = /bot|spider|crawl|slurp|lighthouse|chrome-lighthouse|headless/i.test(ua);
      if (isBot) {
        return res.json({ success: false, securityBlocked: true, securityReason: "🤖 Automated agent request blocked by RoyShare Integrity Sentinel." });
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

      if (type === "shortener") {
        const q = query(collection(db, "smart_links"), where("alias", "==", linkId));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          docRef = qSnap.docs[0].ref;
          itemData = qSnap.docs[0].data();
        } else {
          const directRef = doc(db, "smart_links", linkId);
          const directSnap = await getDoc(directRef);
          if (directSnap.exists()) {
            docRef = directRef;
            itemData = directSnap.data();
          }
        }
      } else {
        const directRef = doc(db, "uploads", linkId);
        const directSnap = await getDoc(directRef);
        if (directSnap.exists()) {
          docRef = directRef;
          itemData = directSnap.data();
        }
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
        
        let downloadUrl = "";
        if (botToken && itemData.storageChannelId && itemData.telegramMessageId && itemData.telegramMessageId !== "NOT_SET") {
          downloadUrl = `https://t.me/c/${itemData.storageChannelId.toString().replace("-100", "")}/${itemData.telegramMessageId}`;
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
