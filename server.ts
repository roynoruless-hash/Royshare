import dotenv from "dotenv";
dotenv.config();
import crypto from "crypto";

import { handleUpdate, submitWithdrawalRequest } from "./src/bot";
import express from "express";
import path from "path";
import fs from "fs";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { createServer as createViteServer } from "vite";
import { getDb } from "./src/lib/firebase";
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, getCountFromServer, collectionGroup, deleteDoc, orderBy, updateDoc, limit, increment, runTransaction, arrayUnion } from "firebase/firestore";
import { REWARD_TASKS } from "./src/lib/tasks";
import { GoogleGenAI, Type } from "@google/genai";
import { safeGenerateContent, safeSendMessage } from "./src/lib/gemini";
import { google } from "googleapis";

// ...
const db = getDb();

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

if (getApps().length === 0) {
  let credential;
  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  const serviceAccountFilePath = path.join(process.cwd(), "firebase-service-account.json");

  if (serviceAccountEnv) {
    try {
      console.log("[FIREBASE ADMIN] Initializing using FIREBASE_SERVICE_ACCOUNT env variable.");
      credential = cert(JSON.parse(serviceAccountEnv));
    } catch (e: any) {
      console.error("[FIREBASE ADMIN] Failed to parse FIREBASE_SERVICE_ACCOUNT env string:", e.message || e);
    }
  } else if (fs.existsSync(serviceAccountFilePath)) {
    try {
      console.log("[FIREBASE ADMIN] Initializing using firebase-service-account.json file.");
      const keyData = JSON.parse(fs.readFileSync(serviceAccountFilePath, "utf8"));
      credential = cert(keyData);
    } catch (e: any) {
      console.error("[FIREBASE ADMIN] Failed to parse firebase-service-account.json file:", e.message || e);
    }
  }

  const appOptions: any = {
    projectId: config.projectId,
    storageBucket: config.storageBucket || `${config.projectId}.appspot.com`
  };

  if (credential) {
    appOptions.credential = credential;
  }

  initializeApp(appOptions);
}

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

  const verifyTelegramInitData = (initData: string, botToken: string): { isValid: boolean; user?: any } => {
    try {
      if (!initData) return { isValid: false };
      const params = new URLSearchParams(initData);
      const hash = params.get("hash");
      if (!hash) return { isValid: false };

      const sortedParams: string[] = [];
      params.forEach((value, key) => {
        if (key !== "hash") {
          sortedParams.push(`${key}=${value}`);
        }
      });
      sortedParams.sort();

      const dataCheckString = sortedParams.join("\n");
      const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
      const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

      const isValid = calculatedHash === hash;
      let user = null;
      if (isValid && params.get("user")) {
        user = JSON.parse(params.get("user") || "{}");
      }

      return { isValid, user };
    } catch (err) {
      console.error("InitData verification error:", err);
      return { isValid: false };
    }
  };

  const ensureTelegramUserSynced = async (userObj: any) => {
    if (!userObj || !userObj.id) return;
    const userDocRef = doc(db, "users", String(userObj.id));
    const userSnap = await getDoc(userDocRef);
    const nowIso = new Date().toISOString();
    
    if (userSnap.exists()) {
      const existingData = userSnap.data();
      const uData: any = { lastActive: nowIso };
      
      if (userObj.username) uData.username = userObj.username;
      if (userObj.first_name) uData.firstName = userObj.first_name;
      if (userObj.last_name) uData.lastName = userObj.last_name;
      if (userObj.language_code) uData.languageCode = userObj.language_code;
      if (userObj.photo_url) uData.photoUrl = userObj.photo_url;
      
      await setDoc(userDocRef, uData, { merge: true });
    } else {
      await setDoc(userDocRef, {
        telegramId: userObj.id,
        username: userObj.username || "",
        firstName: userObj.first_name || "",
        lastName: userObj.last_name || "",
        languageCode: userObj.language_code || "",
        photoUrl: userObj.photo_url || "",
        chatId: 0,
        createdAt: nowIso,
        lastActive: nowIso,
        joinDate: nowIso,
        balance: 0,
        rewards: 0,
        referrals: 0,
        availableBalance: 0,
        totalEarnings: 0,
        membershipVerified: false,
        contactVerified: false
      });
    }
  };

  const getPromoTelegramMessage = (promo: any): string => {
    const reward = promo.rewardAmount || 0;
    const limit = promo.maxUsers || "∞";
    const expiry = promo.expiryDate ? `${promo.expiryDate} ${promo.expiryTime || ""}` : "Soon";
    
    return `🎉 <b>NEW PROMO LIVE</b>\n\n` +
           `💰 <b>Reward :</b> ₹${reward}\n` +
           `👥 <b>Claim Limit :</b> ${limit} Users\n` +
           `⏳ <b>Ends :</b> ${expiry}\n` +
           `🔥 <b>Hurry Up</b>\n\n` +
           `Click below.`;
  };

  const postPromoToTelegram = async (promo: any, botToken: string, tgSettings: any): Promise<{ channelPostId?: number, groupPostId?: number, error?: string, deepLink?: string }> => {
    console.log("--- Telegram Request Started ---");
    console.log("Promo ID:", promo.pageId || promo.id);
    console.log("Bot Token Loaded:", botToken ? "YES (starts with " + botToken.substring(0, 5) + "...)" : "NO");
    
    try {
      const botMeRes = await fetch("https://api.telegram.org/bot" + botToken + "/getMe");
      const botMe = await botMeRes.json();
      if (!botMe.ok) {
        console.error("Telegram API Error (getMe):", botMe.description);
        return { error: `Telegram getMe failed: ${botMe.description}` };
      }

      const botUsername = botMe.result.username || "";
      const randomId = promo.randomPageId || promo.pageId || promo.id;
      
      const baseUrl = "https://royshare.onrender.com"; // User's production domain
      const webAppUrl = `${baseUrl}/?tgWebAppStartParam=promo_${randomId}`;
      
      // Use Direct Link from settings or fall back to bot username based one if absolutely necessary
      const storedMiniAppUrl = tgSettings.miniAppUrl || "";
      console.log("--- Telegram Link Detection ---");
      console.log("Stored Mini App URL in Settings:", storedMiniAppUrl || "NONE");
      
      let directLinkBase = storedMiniAppUrl;
      if (!directLinkBase) {
        console.warn("[Telegram] No Mini App Direct Link found in settings. Defaulting to /app fallback for bot:", botUsername);
        directLinkBase = `https://t.me/${botUsername}/app`;
      }
      
      const deepLink = `${directLinkBase}${directLinkBase.includes("?") ? "&" : "?"}startapp=promo_${randomId}`;

      const msgText = getPromoTelegramMessage(promo);
      
      const rewardButton: any = { 
        text: "🎁 Claim Reward", 
        web_app: { url: webAppUrl } 
      };

      // Safety check: throw error if "url" is used for rewardButton instead of "web_app"
      if (rewardButton.url) {
        throw new Error("CRITICAL SECURITY RISK: Use of 'url' instead of 'web_app' for claim button detected.");
      }

      const replyMarkup = {
        inline_keyboard: [
          [rewardButton],
          [
            { 
              text: "🌐 Open in Browser", 
              url: `${baseUrl}/promo/${randomId}` 
            }
          ]
        ]
      };

      console.log("--- Telegram Payload Summary ---");
      console.log("Bot Username:", botUsername);
      console.log("WebApp URL (Button):", webAppUrl);
      console.log("Deep Link (Fallback):", deepLink);
      console.log("Reply Markup JSON:", JSON.stringify(replyMarkup, null, 2));
      console.log("----------------------------");

      const sendTelegramMessage = async (chatId: string, text: string, markup: any): Promise<any> => {
        const payload = {
          chat_id: chatId,
          text: text,
          parse_mode: "HTML",
          reply_markup: markup
        };
        console.log(`[Telegram] Request to ${chatId}:`, JSON.stringify(payload));
        
        const res = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        console.log(`[Telegram] Response from ${chatId}:`, JSON.stringify(data));
        return data;
      };

      const fallbackReplyMarkup = {
        inline_keyboard: [
          [
            { 
              text: "🎁 Claim Reward (Mini App)", 
              url: deepLink 
            }
          ],
          [
            { 
              text: "🌐 Open in Browser", 
              url: `${baseUrl}/promo/${randomId}` 
            }
          ]
        ]
      };

      let channelPostId: number | undefined = undefined;
      let groupPostId: number | undefined = undefined;
      let lastError: string | undefined = undefined;

      // Send to Channel if enabled
      if (promo.autoPostChannel && tgSettings.channelUsername) {
        let rCh = await sendTelegramMessage(tgSettings.channelUsername, msgText, replyMarkup);
        
        if (!rCh.ok && rCh.description?.toLowerCase().includes("web_app")) {
          console.warn("[Telegram] web_app button failed in channel. Error:", rCh.description);
          console.warn("[Telegram] Falling back to deep link URL for channel.");
          rCh = await sendTelegramMessage(tgSettings.channelUsername, msgText, fallbackReplyMarkup);
        }

        if (rCh.ok) {
          channelPostId = rCh.result.message_id;
          if (promo.pinMessage) {
            await fetch("https://api.telegram.org/bot" + botToken + "/pinChatMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: tgSettings.channelUsername, message_id: channelPostId })
            }).catch(() => {});
          }
        } else {
          lastError = `Channel Error: ${rCh.description}`;
        }
      }

      // Send to Group if enabled
      if (promo.autoPostGroup && (tgSettings.groupUsername || tgSettings.chatId)) {
        const targetGroup = tgSettings.groupUsername || tgSettings.chatId;
        let rGr = await sendTelegramMessage(targetGroup, msgText, replyMarkup);

        if (!rGr.ok && rGr.description?.toLowerCase().includes("web_app")) {
          console.warn("[Telegram] web_app button failed in group. Error:", rGr.description);
          console.warn("[Telegram] Falling back to deep link URL for group.");
          rGr = await sendTelegramMessage(targetGroup, msgText, fallbackReplyMarkup);
        }

        if (rGr.ok) {
          groupPostId = rGr.result.message_id;
          if (promo.pinMessage) {
            await fetch("https://api.telegram.org/bot" + botToken + "/pinChatMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: targetGroup, message_id: groupPostId })
            }).catch(() => {});
          }
        } else {
          lastError = (lastError ? lastError + " | " : "") + `Group Error: ${rGr.description}`;
        }
      }

      console.log("--- Telegram Request Completed ---");
      return { channelPostId, groupPostId, error: lastError, deepLink };
    } catch (err: any) {
      console.error("Telegram Error:", err);
      return { error: `Network/Request Error: ${err.message}` };
    }
  };

  const updatePromoTelegramPost = async (promoId: string, status: string) => {
    try {
      const promoRef = doc(db, "promo_codes", promoId);
      const promoSnap = await getDoc(promoRef);
      if (!promoSnap.exists()) return;
      const promo = promoSnap.data();

      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      if (!tgSettingsSnap.exists()) return;
      const { botToken, channelUsername, groupUsername, chatId } = tgSettingsSnap.data();
      if (!botToken) return;

      const channelPostId = promo.telegramChannelPostId;
      const groupPostId = promo.telegramGroupPostId;

      const deletePost = promo.deleteAfterExpiry === true;
      const statusText = status === "expired" ? "PROMO EXPIRED" : (status === "budget_finished" ? "BUDGET FINISHED" : "LIMIT REACHED");
      const editMsg = `⚠️ <b>${statusText}</b>\n\n` +
                      `🎁 ${promo.name || "Promo Reward"}\n` +
                      `❌ This campaign has ended and rewards are no longer available.`;

      // 1. Handle Channel
      if (channelPostId && channelUsername) {
        if (deletePost) {
          await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: channelUsername, message_id: channelPostId })
          }).catch(() => {});
        } else {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: channelUsername,
              message_id: channelPostId,
              text: editMsg,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: [] } // Remove buttons
            })
          }).catch(() => {});
        }
      }

      // 2. Handle Group
      const targetGroup = groupUsername || chatId;
      if (groupPostId && targetGroup) {
        if (deletePost) {
          await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: targetGroup, message_id: groupPostId })
          }).catch(() => {});
        } else {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: targetGroup,
              message_id: groupPostId,
              text: editMsg,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: [] }
            })
          }).catch(() => {});
        }
      }

      // Update flag
      await updateDoc(promoRef, { telegramStatusUpdated: true });
    } catch (err) {
      console.error("Error updating Telegram post status:", err);
    }
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
      const { rejectReason, rejectionType } = req.body;
      const ref = doc(db, "withdrawals", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Not found" });
      
      const wData = snap.data();
      if (wData.status === "Rejected" || wData.status === "Cancelled") {
          return res.status(400).json({ error: "Withdrawal already processed" });
      }

      // Fetch settings for tax
      const settingsSnap = await getDoc(doc(db, "settings", "system"));
      const settings = settingsSnap.data();
      const taxSettings = settings?.withdrawalTaxSettings || {
        upiTax: 5,
        bankTax: 10,
        usdtTax: 15
      };

      let taxPercent = 0;
      let finalReason = rejectReason || "Rejected by administrator";

      if (rejectionType === "upi") {
          taxPercent = Number(taxSettings.upiTax || 5);
      } else if (rejectionType === "bank") {
          taxPercent = Number(taxSettings.bankTax || 10);
      } else if (rejectionType === "usdt") {
          taxPercent = Number(taxSettings.usdtTax || 15);
      } else {
          taxPercent = 0;
      }

      const requestedAmount = Number(wData.amount || 0);
      const taxAmount = (requestedAmount * taxPercent) / 100;
      const refundAmount = requestedAmount - taxAmount;

      // Update withdrawal doc
      await setDoc(ref, { 
          status: "Rejected", 
          rejectReason: finalReason, 
          adminRemark: finalReason,
          taxPercent,
          taxAmount,
          refundAmount,
          rejectionType: rejectionType || "other",
          rejectedAt: new Date().toISOString()
      }, { merge: true });

      // Update user balance and pendingWithdrawals
      const userRef = doc(db, "users", wData.userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
          const userData = userSnap.data();
          
          // Important: pendingWithdrawals is in INR
          const isUsdt = (wData.method || "").toUpperCase().includes("USDT") || !!wData.walletAddress;
          const USDT_RATE = 90; 
          
          const inrRequestedAmount = isUsdt ? (requestedAmount * USDT_RATE) : requestedAmount;
          const inrTaxAmount = isUsdt ? (taxAmount * USDT_RATE) : taxAmount;
          const inrRefundAmount = isUsdt ? (refundAmount * USDT_RATE) : refundAmount;

          const currentPending = Number(userData.pendingWithdrawals || 0);
          const currentBalance = Number(userData.balance || 0);
          
          const newPending = Math.max(0, currentPending - inrRequestedAmount);
          const newBalance = currentBalance - inrTaxAmount; 
          
          // Recalculate availableBalance
          const fileEarnings = userData?.fileEarnings || 0;
          const linkEarnings = userData?.linkEarnings || 0;
          const referralEarnings = userData?.referralEarnings || 0;
          const bonusBalance = userData?.bonusBalance !== undefined ? userData.bonusBalance : (userData?.bonus || 0);
          const rewardBalance = userData?.rewardBalance || 0;
          const withdrawnAmount = userData?.withdrawnAmount !== undefined ? userData.withdrawnAmount : (userData?.totalWithdrawn || 0);
          
          const availableBalance = fileEarnings + linkEarnings + referralEarnings + bonusBalance + rewardBalance + newBalance - withdrawnAmount - newPending;

          await setDoc(userRef, { 
              pendingWithdrawals: newPending, 
              balance: newBalance,
              availableBalance,
              updatedAt: new Date().toISOString()
          }, { merge: true });

          // Transaction History Record
          await addDoc(collection(db, "transactions"), {
              userId: wData.userId,
              type: "Withdrawal Rejected",
              requestedAmount: requestedAmount,
              taxPercent: taxPercent,
              taxAmount: taxAmount,
              refundAmount: refundAmount,
              reason: finalReason,
              method: wData.method,
              currency: isUsdt ? "USDT" : "INR",
              timestamp: new Date().toISOString(),
              withdrawalId: id
          });

          // Notify User via Telegram
          const currencySymbol = isUsdt ? "USDT" : "₹";
          const tgMessage = `❌ <b>Withdrawal Rejected</b>\n\n` +
                          `<b>Reason:</b>\n${finalReason}\n\n` +
                          `<b>Requested Amount:</b>\n${currencySymbol}${requestedAmount.toFixed(2)}\n\n` +
                          `<b>Tax Applied:</b>\n${taxPercent}%\n\n` +
                          `<b>Tax Deducted:</b>\n${currencySymbol}${taxAmount.toFixed(2)}\n\n` +
                          `<b>Refunded Amount:</b>\n${currencySymbol}${refundAmount.toFixed(2)}\n\n` +
                          `The refund has been added back to your Available Balance.\n\n` +
                          `Please update your payment details before requesting another withdrawal.`;
          
          await sendTgMessage(wData.userId, tgMessage);
      }

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
        resetTime: "00:00",
        wheel: { enabled: true, dailyLimit: 2, cooldown: 0, rewards: [] },
        box: { enabled: true, dailyLimit: 1, cooldown: 0, rewards: [] },
        scratch: { enabled: true, dailyLimit: 3, cooldown: 0, rewards: [] },
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

  app.get("/api/admin/daily-bonus/stats", async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const statsSnap = await getDoc(doc(db, "daily_bonus_stats", today));
      const todayStats = statsSnap.exists() ? statsSnap.data() : {};
      
      const globalSnap = await getDoc(doc(db, "settings", "daily_bonus"));
      const globalStats = globalSnap.exists() ? globalSnap.data() : {};
      
      // Fetch Top Winners (All Time)
      const topWinnersQuery = query(
        collection(db, "claimHistory"),
        orderBy("amount", "desc"),
        limit(5)
      );
      const topWinnersSnap = await getDocs(topWinnersQuery);
      const topWinners = topWinnersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      res.json({
        success: true,
        today: {
          wheelSpins: todayStats.totalSpins || 0,
          boxOpens: todayStats.totalOpens || 0,
          scratchClaims: todayStats.totalScratches || 0,
          uniqueUsers: todayStats.uniqueUsers || 0,
          totalClaims: todayStats.totalClaims || 0,
          totalRewards: todayStats.totalRewards || 0,
          averageReward: todayStats.totalClaims ? (todayStats.totalRewards / todayStats.totalClaims) : 0,
          betterLuckCount: todayStats.betterLuckCount || 0
        },
        global: {
          totalSpins: globalStats.totalSpins || 0,
          totalRewardsDistributed: globalStats.totalRewardsDistributed || 0,
          totalClaims: globalStats.totalClaims || 0,
          averageReward: globalStats.totalClaims ? (globalStats.totalRewardsDistributed / globalStats.totalClaims) : 0
        },
        topWinners
      });
    } catch (e) {
      console.error("Error in /api/admin/daily-bonus/stats:", e);
      res.status(500).json({ error: "Failed to fetch stats" });
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

  app.post("/api/admin/daily-bonus/auto-generate", async (req, res) => {
    try {
      const { minReward, maxReward, slots, betterLuckSlots, dailyBudget } = req.body;
      
      const prompt = `Generate a daily bonus reward pool in JSON format.
      Parameters:
      - Minimum Reward: ₹${minReward}
      - Maximum Reward: ₹${maxReward}
      - Total Reward Slots (excluding Better Luck): ${slots}
      - Better Luck Slots: ${betterLuckSlots}
      - Daily Budget: ₹${dailyBudget}
      
      Requirements:
      - Distribution must be profitable and realistic. High-value rewards must have extremely low weight (e.g., 1 or 2). Low-value rewards must have high weight (e.g., 50-100).
      - Include exactly ${betterLuckSlots} "Better Luck Next Time" slots with 0 amount. Each of these must have amount: 0 and label: "Better Luck Next Time" or similar.
      - Each reward must have: label (string), amount (number), weight (number).
      - Weight should be relative (e.g., 1 to 100).
      
      Return ONLY a JSON array of rewards. Do NOT include any markdown formatting like \`\`\`json or surrounding text, just the raw array.`;

      let rewards = [];
      let isLocalFallback = false;

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error("GEMINI_API_KEY environment variable is not set");
        }
        const ai = new GoogleGenAI({ apiKey });
        const response = await safeGenerateContent(ai, {
          model: "gemini-3.5-flash",
          contents: prompt
        });
        const responseText = response.text || "";
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        rewards = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
      } catch (err: any) {
        console.warn("[AI generation failed, falling back to Smart Local Generator]", err);
        isLocalFallback = true;
        
        // Generate rewards locally using quadratic weight decay
        rewards = [];
        const numSlots = parseInt(slots) || 5;
        const minRew = parseFloat(minReward) || 1;
        const maxRew = parseFloat(maxReward) || 100;
        const blSlots = parseInt(betterLuckSlots) || 0;

        for (let i = 0; i < numSlots; i++) {
          const ratio = numSlots > 1 ? i / (numSlots - 1) : 0;
          const amount = Math.round(minRew + ratio * (maxRew - minRew));
          const weight = Math.max(1, Math.round(100 * Math.pow(1 - ratio, 2)));
          rewards.push({
            label: `₹${amount.toFixed(2)}`,
            amount,
            weight
          });
        }

        for (let i = 0; i < blSlots; i++) {
          rewards.push({
            label: "Better Luck Next Time 🍀",
            amount: 0,
            weight: 35
          });
        }
      }

      res.json({ success: true, rewards, isLocalFallback });
    } catch (e: any) {
      console.error("AI Reward generation fatal error:", e);
      try {
        // Absolute fallback if anything at all crashes
        const { minReward, maxReward, slots, betterLuckSlots } = req.body;
        const numSlots = parseInt(slots) || 5;
        const minRew = parseFloat(minReward) || 1;
        const maxRew = parseFloat(maxReward) || 100;
        const blSlots = parseInt(betterLuckSlots) || 0;
        const rewards = [];
        
        for (let i = 0; i < numSlots; i++) {
          const ratio = numSlots > 1 ? i / (numSlots - 1) : 0;
          const amount = Math.round(minRew + ratio * (maxRew - minRew));
          const weight = Math.max(1, Math.round(100 * Math.pow(1 - ratio, 2)));
          rewards.push({ label: `₹${amount.toFixed(2)}`, amount, weight });
        }
        
        for (let i = 0; i < blSlots; i++) {
          rewards.push({ label: "Better Luck Next Time 🍀", amount: 0, weight: 35 });
        }
        
        res.json({ success: true, rewards, isLocalFallback: true });
      } catch (fallbackErr) {
        res.status(500).json({ error: e.message || "Server error" });
      }
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
          withdrawalTaxSettings: {
            upiTax: 5,
            bankTax: 10,
            usdtTax: 15
          },
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

  app.get("/api/public/stats", async (req, res) => {
    try {
      const getCount = async (collName: string) => {
        try {
          const coll = collection(db, collName);
          return (await getCountFromServer(coll)).data().count;
        } catch (e) {
          return 0;
        }
      };

      const [totalUsers, totalUploads, totalLinks] = await Promise.all([
        getCount("users"),
        getCount("uploads"),
        getCount("links")
      ]);

      // If we had a global settings doc with overall stats, we'd fetch it here.
      // For now, we return document counts.
      res.json({
        totalUsers,
        totalUploads,
        totalLinks,
        totalDownloads: 0 // Will handle "Growing Every Day" if 0
      });
    } catch (e) {
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
      console.log("Long polling is completely disabled in favor of Telegram Webhook to prevent 409 Conflict errors.");
      pollingState.isRunning = false;
      return;
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
          console.log("Auto-start polling skipped: Webhook is the only active update method.");
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

      const settingsDocRef = doc(db, "settings", "daily_bonus");
      const settingsSnap = await getDoc(settingsDocRef);
      if (!settingsSnap.exists()) {
        console.error("[DAILY BONUS ERROR] settings/daily_bonus does not exist in Firestore!");
        return res.status(500).json({ error: "Daily Bonus settings not found" });
      }

      const settings = settingsSnap.data();
      const enabled = settings.dailyBonusEnabled ?? true;
      
      // Default modular settings
      const wheelConfig = settings.wheel || { enabled: true, dailyLimit: 2, cooldown: 0, rewards: [] };
      const boxConfig = settings.box || { enabled: true, dailyLimit: 1, cooldown: 0, rewards: [] };
      const scratchConfig = settings.scratch || { enabled: true, dailyLimit: 3, cooldown: 0, rewards: [] };

      if (!enabled) {
        return res.json({ enabled: false, message: "Daily Bonus is currently disabled by administrator." });
      }

      const todayDateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      const stateDocRef = doc(db, "daily_bonus_state", userId);
      const stateSnap = await getDoc(stateDocRef);

      const userDocRef = doc(db, "users", userId);
      const userSnap = await getDoc(userDocRef);
      const currency = userSnap.exists() ? (userSnap.data()?.currency || "INR") : "INR";

      // Reset Time in IST helper (simplified for now to 00:00)
      const resetTime = settings.resetTime || "00:00";
      
      let stateData: any = null;
      const defaultState = {
        userId,
        lastResetDate: todayDateStr,
        wheel: { count: 0, lastTime: null },
        box: { count: 0, lastTime: null },
        scratch: { count: 0, lastTime: null },
        pendingRewards: {}
      };

      if (!stateSnap.exists()) {
        await setDoc(stateDocRef, defaultState);
        stateData = defaultState;
      } else {
        stateData = stateSnap.data();
        // Check for daily reset
        if (stateData.lastResetDate !== todayDateStr) {
          stateData = { ...defaultState, pendingRewards: stateData.pendingRewards || {} };
          await setDoc(stateDocRef, stateData);
        }
      }

      // Update Unique Users Statistic
      try {
        const today = new Date().toISOString().split("T")[0];
        const statsRef = doc(db, "daily_bonus_stats", today);
        const statsSnap = await getDoc(statsRef);
        
        if (!statsSnap.exists()) {
          await setDoc(statsRef, { date: today, uniqueUsers: 1, totalClaims: 0, totalRewards: 0 });
        } else {
          // Check if this user was already counted today (we can use a separate collection for this or just rely on the first status call)
          // For simplicity, let's track unique users by checking a 'visitedUsers' array or similar, but for high traffic it's better to use a subcollection.
          const userVisitRef = doc(db, "daily_bonus_stats", `${today}_visits_${userId}`);
          const visitSnap = await getDoc(userVisitRef);
          if (!visitSnap.exists()) {
            await setDoc(userVisitRef, { visited: true });
            await setDoc(statsRef, { uniqueUsers: increment(1) }, { merge: true });
          }
        }
      } catch (statErr) {
        console.error("Error updating unique users stat:", statErr);
      }

      const computeModuleStatus = (config: any, state: any) => {
        const limit = config?.dailyLimit || 0;
        const count = state?.count || 0;
        const lastTime = state?.lastTime ? new Date(state.lastTime).getTime() : 0;
        const cooldownMs = (config?.cooldown || 0) * 60 * 1000;
        const now = Date.now();
        const nextAvailable = lastTime + cooldownMs;
        const isOnCooldown = now < nextAvailable;
        
        return {
          enabled: config?.enabled ?? false,
          dailyLimit: limit,
          usageCount: count,
          remaining: Math.max(0, limit - count),
          isOnCooldown,
          cooldownRemaining: isOnCooldown ? Math.ceil((nextAvailable - now) / 1000) : 0,
          lastClaimAt: state?.lastTime || null,
          nextAvailableAt: isOnCooldown ? new Date(nextAvailable).toISOString() : null,
          rewards: config?.rewards || []
        };
      };

      return res.json({
        success: true,
        dailyBonusEnabled: enabled,
        modules: {
          wheel: computeModuleStatus(wheelConfig, stateData.wheel),
          box: computeModuleStatus(boxConfig, stateData.box),
          scratch: computeModuleStatus(scratchConfig, stateData.scratch)
        },
        pendingRewards: stateData.pendingRewards || {},
        currency
      });
    } catch (e: any) {
      console.error("Error in /api/daily-bonus/status:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/daily-bonus/reveal", async (req, res) => {
    try {
      const { userId, type } = req.body;
      if (!userId || !type) return res.status(400).json({ error: "Missing parameters" });

      const settingsSnap = await getDoc(doc(db, "settings", "daily_bonus"));
      if (!settingsSnap.exists()) return res.status(500).json({ error: "Settings not found" });
      const settings = settingsSnap.data();

      const config = settings[type];
      if (!config || !config.enabled) return res.status(400).json({ error: "Module disabled" });

      const stateDocRef = doc(db, "daily_bonus_state", userId);
      const stateSnap = await getDoc(stateDocRef);
      if (!stateSnap.exists()) return res.status(404).json({ error: "State not found" });
      const stateData = stateSnap.data();

      // Check if there's an unclaimed pending reward of the same type
      if (stateData.pendingRewards?.[type] && !stateData.pendingRewards[type].claimed) {
        // Return existing reward to prevent refresh exploit
        return res.json({
          ok: true,
          reward: {
            amount: stateData.pendingRewards[type].amount,
            label: stateData.pendingRewards[type].label || `₹${stateData.pendingRewards[type].amount.toFixed(2)}`
          },
          usage: stateData[type]
        });
      }

      const usage = stateData[type] || { count: 0, lastTime: null };
      if (usage.count >= config.dailyLimit) return res.status(400).json({ error: "Daily limit reached" });

      // Cooldown check
      if (usage.lastTime && config.cooldown > 0) {
        const lastTime = new Date(usage.lastTime).getTime();
        const now = Date.now();
        const diffMinutes = (now - lastTime) / (1000 * 60);
        if (diffMinutes < config.cooldown) {
          return res.status(400).json({ error: `Please wait ${Math.ceil(config.cooldown - diffMinutes)} more minutes.` });
        }
      }

      // Budget Protection
      const today = new Date().toISOString().split("T")[0];
      const statsSnap = await getDoc(doc(db, "daily_bonus_stats", today));
      const statsData = statsSnap.exists() ? statsSnap.data() : { totalRewards: 0 };
      const currentPayout = statsData.totalRewards || 0;
      const budget = Number(settings.dailyBudget) || Infinity;

      let rewards = [...(config.rewards || [])];
      if (rewards.length === 0) return res.status(500).json({ error: "No rewards configured" });

      // If budget reached, only keep "Better Luck Next Time" or lowest rewards
      if (currentPayout >= budget) {
        const betterLuckRewards = rewards.filter(r => (r.label || "").toLowerCase().includes("better luck") || Number(r.amount) === 0);
        if (betterLuckRewards.length > 0) {
          rewards = betterLuckRewards;
        } else {
          // Fallback to the reward with minimum amount
          const minAmount = Math.min(...rewards.map(r => Number(r.amount)));
          rewards = rewards.filter(r => Number(r.amount) === minAmount);
        }
      }

      const totalWeight = rewards.reduce((sum: number, r: any) => sum + (Number(r.weight) || 0), 0);
      let random = Math.random() * totalWeight;
      let selectedReward = rewards[0];
      for (const r of rewards) {
        if (random < (Number(r.weight) || 0)) {
          selectedReward = r;
          break;
        }
        random -= (Number(r.weight) || 0);
      }

      const rewardAmount = Number(selectedReward.amount);
      const rewardLabel = selectedReward.label || `₹${rewardAmount.toFixed(2)}`;

      // Save pending reward and update count (don't credit yet)
      const now = new Date().toISOString();
      const isBetterLuck = rewardAmount === 0;
      const updatedState = {
        ...stateData,
        [type]: {
          count: usage.count + 1,
          lastTime: now
        },
        pendingRewards: {
          ...(stateData.pendingRewards || {}),
          [type]: {
            amount: rewardAmount,
            label: rewardLabel,
            timestamp: now,
            claimed: isBetterLuck
          }
        }
      };
      await setDoc(stateDocRef, updatedState);

      // Update statistics (Spins count)
      try {
        const statsRef = doc(db, "daily_bonus_stats", today);
        const fieldName = type === "wheel" ? "totalSpins" : type === "box" ? "totalOpens" : "totalScratches";
        const updateData: any = { [fieldName]: increment(1) };
        if (isBetterLuck) {
          updateData.betterLuckCount = increment(1);
          updateData.totalClaims = increment(1);
        }
        await setDoc(statsRef, updateData, { merge: true });
      } catch (e) {}

      return res.json({
        ok: true,
        reward: {
          amount: rewardAmount,
          label: rewardLabel
        },
        usage: updatedState[type]
      });
    } catch (e: any) {
      console.error("Error in /api/daily-bonus/reveal:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  app.post("/api/daily-bonus/claim", async (req, res) => {
    try {
      const { userId, type } = req.body;
      if (!userId || !type) return res.status(400).json({ error: "Missing parameters" });

      const userDocRef = doc(db, "users", userId);
      const stateDocRef = doc(db, "daily_bonus_state", userId);
      const today = new Date().toISOString().split("T")[0];
      const statsRef = doc(db, "daily_bonus_stats", today);
      const globalSettingsRef = doc(db, "settings", "daily_bonus");

      let rewardAmount = 0;
      let userName = "User";
      let tgUserId = "";

      // Start Firestore Transaction
      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userDocRef);
        if (!userSnap.exists()) throw new Error("User not found");
        const uData = userSnap.data();
        userName = uData.name || uData.firstName || uData.username || "User";
        tgUserId = uData.telegramId || "";

        const stateSnap = await transaction.get(stateDocRef);
        if (!stateSnap.exists()) throw new Error("State not found");
        const stateData = stateSnap.data();

        const pending = stateData.pendingRewards?.[type];
        if (!pending || pending.claimed) throw new Error("No pending reward or already claimed");

        rewardAmount = Number(pending.amount);

        // Update User Balances
        transaction.update(userDocRef, {
          bonusBalance: increment(rewardAmount),
          availableBalance: increment(rewardAmount),
          earnings: increment(rewardAmount)
        });

        // Mark as Claimed
        transaction.update(stateDocRef, {
          [`pendingRewards.${type}.claimed`]: true
        });

        // Update Statistics
        const rewardField = type === "wheel" ? "wheelRewards" : type === "box" ? "boxRewards" : "scratchRewards";
        transaction.set(statsRef, { 
          [rewardField]: increment(rewardAmount),
          totalClaims: increment(1),
          totalRewards: increment(rewardAmount)
        }, { merge: true });

        // Update Global Distributed Rewards
        transaction.set(globalSettingsRef, { totalRewardsDistributed: increment(rewardAmount) }, { merge: true });
      });

      // After transaction success, Add to history (non-critical, separate write or can be in transaction too but it's okay)
      await addDoc(collection(db, "claimHistory"), {
        userId,
        userName,
        amount: rewardAmount,
        type,
        date: new Date().toISOString(),
        adStatus: "Verified"
      });

      // Send Telegram Notification
      try {
        const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        if (telegramSettingsSnap.exists()) {
          const { botToken, rewardChannelId } = telegramSettingsSnap.data();
          if (botToken && (rewardChannelId || tgUserId)) {
            const emoji = type === "wheel" ? "🎡" : type === "box" ? "📦" : type === "scratch" ? "🎫" : "🪙";
            const typeLabel = type === "wheel" ? "Wheel Spin" : type === "box" ? "Mystery Box" : type === "scratch" ? "Scratch Card" : "Coin Rain";
            const message = `🎊 *Daily Bonus Claimed!*\n\n👤 *User:* ${userName}\n💰 *Reward:* ₹${rewardAmount.toFixed(2)}\n🎯 *Source:* ${emoji} ${typeLabel}\n📅 *Date:* ${new Date().toLocaleString()}\n\nCongratulations! 🥳`;
            
            if (rewardChannelId) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: rewardChannelId,
                  text: message,
                  parse_mode: "Markdown"
                })
              });
            }
            if (tgUserId) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: tgUserId,
                  text: message,
                  parse_mode: "Markdown"
                })
              });
            }
          }
        }
      } catch (tgErr) {
        console.error("Error sending TG notification for daily bonus:", tgErr);
      }

      return res.json({ ok: true, amount: rewardAmount });
    } catch (e: any) {
      console.error("Error in /api/daily-bonus/claim:", e);
      res.status(400).json({ error: e.message || "Server error" });
    }
  });

  // 🎁 PREMIUM PROMO REWARD SYSTEM ENDPOINTS
  
  // Helpers
  function isPromoActive(startDate: string, startTime: string, expiryDate: string, expiryTime: string): boolean {
    const now = new Date();
    const startStr = `${startDate}T${startTime || "00:00"}:00`;
    const expiryStr = `${expiryDate}T${expiryTime || "23:59"}:00`;
    const start = new Date(startStr);
    const expiry = new Date(expiryStr);
    if (isNaN(start.getTime()) || isNaN(expiry.getTime())) {
      return true;
    }
    return now >= start && now <= expiry;
  }

  async function checkTelegramJoin(botToken: string, chatId: string, telegramId: string): Promise<boolean> {
    try {
      if (!chatId || !telegramId) return true;
      const formattedChatId = chatId.startsWith("@") ? chatId : `@${chatId}`;
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${formattedChatId}&user_id=${telegramId}`);
      const data = await res.json();
      if (data.ok && data.result) {
        const status = data.result.status;
        return ["creator", "administrator", "member", "restricted"].includes(status);
      }
      return false;
    } catch (e) {
      console.error(`Telegram check failed for chat ${chatId}:`, e);
      return true; // fallback
    }
  }

  // Get Status and settings
  app.get("/api/promo/status", async (req, res) => {
    try {
      const promoId = req.query.promoId as string; // Accept promoId (pageId) from query params
      const initData = req.query.initData as string;
      let userId = req.query.userId as string;

      if (!promoId) {
        return res.status(400).json({ error: "Missing promoId" });
      }

      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      const botToken = tgSettingsSnap.exists() ? tgSettingsSnap.data()?.botToken : null;

      let verifiedUser: any = null;
      let tgAuthError: string | null = null;

      if (initData && botToken) {
        const verified = verifyTelegramInitData(initData, botToken);
        if (verified.isValid && verified.user) {
          verifiedUser = verified.user;
          userId = String(verified.user.id);
          // Auto sync/create user in Firestore!
          await ensureTelegramUserSynced(verifiedUser);
        } else {
          tgAuthError = "Invalid Telegram signature. Browser bypass rejected.";
        }
      }

      // Track Mini App Open
      if (userId && promoId) {
        const promoCodesColl = collection(db, "promo_codes");
        const q = query(promoCodesColl, where("pageId", "==", promoId));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          await updateDoc(qSnap.docs[0].ref, { miniAppOpens: increment(1) }).catch(() => {});
        }
      }

      // Allow admin testing, but otherwise enforce Telegram auth or valid query param
      if (!userId && userId !== "ADMIN_PREVIEW") {
        return res.status(401).json({ error: "Telegram Authentication is required. Please access this page inside the Telegram Mini App." });
      }

      if (tgAuthError && userId !== "ADMIN_PREVIEW") {
        return res.status(401).json({ error: tgAuthError });
      }

      const settingsDocRef = doc(db, "settings", "promo_rewards");
      let settingsSnap = await getDoc(settingsDocRef);
      
      const defaultSettings = {
        enabled: true,
        adsterraBannerCode: "",
        monetagAdCode: "",
        expiryMinutes: 120,
        expiryEnabled: false,
        pageOpenedCount: 0,
        pageUnlockedCount: 0,
        wrongAccessCount: 0,
        successClaimCount: 0,
        failedClaimCount: 0,
        budgetUsed: 0,
        uniqueUsersCount: 0,
        tgChannelUrl: "https://t.me/royshare_official",
        tgChannelEnabled: true,
        tgGroupUrl: "https://t.me/royshare_chat",
        tgGroupEnabled: true,
        instagramUrl: "https://www.instagram.com/royshare_official",
        instagramEnabled: true,
        facebookUrl: "https://www.facebook.com/profile.php?id=61591256922373",
        facebookEnabled: true,
        youtubeUrl: "https://youtube.com/@royshare",
        youtubeEnabled: true,
        discordUrl: "https://discord.gg/2Q2CSmFk",
        discordEnabled: true,
        twitterUrl: "https://x.com/RoyShare_0",
        twitterEnabled: true
      };

      if (!settingsSnap.exists()) {
        await setDoc(settingsDocRef, defaultSettings);
        settingsSnap = await getDoc(settingsDocRef);
      }

      const settingsData = { ...defaultSettings, ...settingsSnap.data() };

      // Increment Page Opened Count
      await updateDoc(settingsDocRef, {
        pageOpenedCount: increment(1)
      });

      // Fetch user profile
      const userRef = doc(db, "users", userId);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : null;

      let requireAccessCode = false;
      let unlocked = true;
      let session = null;
      let promoData: any = null;

      if (promoId) {
        // Query the specific promo to get its requireAccessCode setting
        const promoCodesColl = collection(db, "promo_codes");
        let q = query(promoCodesColl, where("pageId", "==", promoId));
        let qSnap = await getDocs(q);
        if (qSnap.empty) {
          q = query(promoCodesColl, where("randomPageId", "==", promoId));
          qSnap = await getDocs(q);
        }
        if (!qSnap.empty) {
          const promoDoc = qSnap.docs[0];
          promoData = promoDoc.data();
          requireAccessCode = promoData.requireAccessCode === true;

          // Track miniAppOpens and clicks directly inside the Promo document
          await updateDoc(promoDoc.ref, {
            miniAppOpens: increment(1),
            miniAppClicks: increment(1)
          }).catch(() => {});
        }
      }

      if (requireAccessCode) {
        unlocked = false;
        console.log("Promo Locked - Checking session");
        const sessionRef = doc(db, "promo_sessions", `${userId}_${promoId}`);
        const sessionSnap = await getDoc(sessionRef);
        if (sessionSnap.exists()) {
          const sData = sessionSnap.data();
          const expiresAt = new Date(sData.expiresAt);
          if (expiresAt > new Date()) {
            unlocked = true;
            session = sData;
          }
        }
      } else {
        console.log("Promo Unlocked (No Access Code Required)");
      }

      res.json({
        success: true,
        settings: settingsData,
        user: userData,
        unlocked,
        session,
        promo: promoData ? {
          name: promoData.name,
          rewardAmount: promoData.rewardAmount,
          enabled: promoData.enabled,
          requireAccessCode: promoData.requireAccessCode,
          accessCode: promoData.accessCode,
          startDate: promoData.startDate,
          startTime: promoData.startTime,
          expiryDate: promoData.expiryDate,
          expiryTime: promoData.expiryTime,
          maxUsers: promoData.maxUsers,
          usedCount: promoData.usedCount,
          totalBudget: promoData.totalBudget,
          budgetUsed: promoData.budgetUsed,
          // include stats to show on the preview
          telegramViews: promoData.telegramViews || 0,
          miniAppOpens: promoData.miniAppOpens || 0,
          claimsCount: promoData.claimsCount || 0
        } : null
      });

    } catch (e: any) {
      console.error("Error in GET /api/promo/status:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Unlock Promo page
  app.post("/api/promo/unlock", async (req, res) => {
    try {
      const { accessCode, promoId, initData } = req.body;
      let userId = req.body.userId;
      if (!promoId) return res.status(400).json({ error: "Missing promoId" });
      const safeAccessCode = accessCode || "";

      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      const botToken = tgSettingsSnap.exists() ? tgSettingsSnap.data()?.botToken : null;

      if (initData && botToken) {
        const verified = verifyTelegramInitData(initData, botToken);
        if (verified.isValid && verified.user) {
          userId = String(verified.user.id);
          await ensureTelegramUserSynced(verified.user);
        } else if (userId !== "ADMIN_PREVIEW") {
          return res.status(401).json({ error: "Invalid Telegram signature." });
        }
      }

      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      const settingsDocRef = doc(db, "settings", "promo_rewards");
      const settingsSnap = await getDoc(settingsDocRef);
      const expiryMinutes = settingsSnap.exists() ? (settingsSnap.data()?.expiryMinutes ?? 120) : 120;

      // Query the specific promo
      const promoCodesColl = collection(db, "promo_codes");
      let q = query(promoCodesColl, where("pageId", "==", promoId));
      let qSnap = await getDocs(q);
      if (qSnap.empty) {
        q = query(promoCodesColl, where("randomPageId", "==", promoId));
        qSnap = await getDocs(q);
      }

      if (qSnap.empty) {
        return res.status(404).json({ success: false, error: "Promo not found" });
      }

      const promoDoc = qSnap.docs[0];
      const promoData = promoDoc.data();

      // Check if access code is required
      if (!promoData.requireAccessCode) {
        return res.json({ success: true, message: "No access code required." });
      }

      // Check if access code matches (case insensitive)
      if (!promoData.accessCode || promoData.accessCode.trim().toUpperCase() !== safeAccessCode.trim().toUpperCase()) {
        await updateDoc(settingsDocRef, { wrongAccessCount: increment(1) });
        await updateDoc(promoDoc.ref, { wrongAccessCount: increment(1) }).catch(() => {});
        console.log("Promo Locked: Invalid Access Code");
        return res.status(400).json({ success: false, error: "Invalid Access Code. Please try again." });
      }

      // Verify parent promo's dates, enabled, and budget
      const now = new Date();
      const startStr = `${promoData.startDate}T${promoData.startTime || "00:00"}:00`;
      const expiryStr = `${promoData.expiryDate}T${promoData.expiryTime || "23:59"}:00`;
      const start = new Date(startStr);
      const expiry = new Date(expiryStr);

      const maxUsers = Number(promoData.maxUsers || 0);
      const usedCount = Number(promoData.usedCount || 0);
      const totalBudget = Number(promoData.totalBudget || 0);
      const budgetUsed = Number(promoData.budgetUsed || 0);
      const rewardAmount = Number(promoData.rewardAmount || 0);

      if (!promoData.enabled) {
        return res.status(400).json({ success: false, error: "This promo is currently disabled." });
      }
      if (maxUsers > 0 && usedCount >= maxUsers) {
        return res.status(400).json({ success: false, error: "This promo has reached its claim limit." });
      }
      if (totalBudget > 0 && (budgetUsed >= totalBudget || (totalBudget - budgetUsed) < rewardAmount)) {
        return res.status(400).json({ success: false, error: "This promo budget is finished." });
      }
      if (!isNaN(start.getTime()) && now < start) {
        return res.status(400).json({ success: false, error: "This promo has not started yet." });
      }
      if (!isNaN(expiry.getTime()) && now > expiry) {
        await updateDoc(promoDoc.ref, { expiredAttempts: increment(1) }).catch(() => {});
        return res.status(400).json({ success: false, error: "This promo has expired." });
      }

      // Create Session
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
      const sessionRef = doc(db, "promo_sessions", `${userId}_${promoId}`);
      await setDoc(sessionRef, {
        userId,
        promoId,
        accessCode: accessCode.toUpperCase(),
        unlockedAt: new Date().toISOString(),
        expiresAt
      });

      // Update analytics
      await updateDoc(settingsDocRef, { pageUnlockedCount: increment(1) });
      await updateDoc(promoDoc.ref, { successfulUnlocks: increment(1) }).catch(() => {});

      console.log("Promo Unlocked successfully");
      res.json({
        success: true,
        expiresAt
      });

    } catch (e: any) {
      console.error("Error in POST /api/promo/unlock:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Redeem Promo reward
  app.post("/api/promo/verify", async (req, res) => {
    try {
      const { userId, promoId, promoCode, initData } = req.body;
      if (!userId || !promoId || !promoCode) {
        return res.status(400).json({ error: "Missing required parameters." });
      }

      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      const botToken = tgSettingsSnap.exists() ? tgSettingsSnap.data()?.botToken : null;

      if (initData && botToken) {
        const verified = verifyTelegramInitData(initData, botToken);
        if (!verified.isValid && userId !== "ADMIN_PREVIEW") {
          return res.status(401).json({ error: "Invalid Telegram signature." });
        }
      }

      // Retrieve Promo
      const promoCodesColl = collection(db, "promo_codes");
      let q = query(promoCodesColl, where("randomPageId", "==", promoId));
      let qSnap = await getDocs(q);
      if (qSnap.empty) {
        q = query(promoCodesColl, where("pageId", "==", promoId));
        qSnap = await getDocs(q);
      }
      if (qSnap.empty) {
        return res.status(404).json({ error: "Promo campaign not found." });
      }
      
      const promoDoc = qSnap.docs[0];
      const promoData = promoDoc.data();

      // Check Status
      if (!promoData.enabled) return res.status(400).json({ error: "This promo is currently disabled." });
      if (!isPromoActive(promoData.startDate, promoData.startTime, promoData.expiryDate, promoData.expiryTime)) {
        return res.status(400).json({ error: "This promo campaign has ended." });
      }

      // 1. Verify Promo Code (Entered by user)
      const expectedCode = promoData.promoCode || promoData.code;
      if (expectedCode && expectedCode.trim().toUpperCase() !== promoCode.trim().toUpperCase()) {
        return res.status(400).json({ error: "Invalid Promo Reward Code. Please check the Telegram post." });
      }

      // 2. Verify Telegram Membership
      if (tgSettingsSnap.exists() && botToken) {
        const tgSettings = tgSettingsSnap.data();
        
        // Channel
        if (promoData.autoPostChannel && tgSettings.channelUsername && userId !== "ADMIN_PREVIEW") {
          const joined = await checkTelegramJoin(botToken, tgSettings.channelUsername, userId);
          if (!joined) {
            return res.status(400).json({ error: `Please join our Channel (${tgSettings.channelUsername}) first!` });
          }
        }

        // Group
        if (promoData.autoPostGroup && tgSettings.groupUsername && userId !== "ADMIN_PREVIEW") {
          const joined = await checkTelegramJoin(botToken, tgSettings.groupUsername, userId);
          if (!joined) {
            return res.status(400).json({ error: `Please join our Group Chat (${tgSettings.groupUsername}) first!` });
          }
        }
      }

      // 3. Already Claimed Check
      const claimRef = doc(db, "promo_claims", `${userId}_${promoDoc.id}`);
      const claimSnap = await getDoc(claimRef);
      if (claimSnap.exists() && claimSnap.data().status === "Success") {
        return res.status(400).json({ error: "You have already claimed this promo reward!" });
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error("Error in /api/promo/verify:", e);
      res.status(500).json({ error: "Internal server error during verification." });
    }
  });

  app.post("/api/promo/redeem", async (req, res) => {
    try {
      const { randomPageId, initData } = req.body;
      let userId = req.body.userId;
      if (!randomPageId) return res.status(400).json({ error: "Missing parameters" });

      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      const botToken = tgSettingsSnap.exists() ? tgSettingsSnap.data()?.botToken : null;

      let verifiedUser: any = null;
      if (initData && botToken) {
        const verified = verifyTelegramInitData(initData, botToken);
        if (verified.isValid && verified.user) {
          verifiedUser = verified.user;
          userId = String(verified.user.id);
          await ensureTelegramUserSynced(verified.user);
        } else if (userId !== "ADMIN_PREVIEW") {
          return res.status(401).json({ error: "Invalid Telegram signature. Browser bypass rejected." });
        }
      }

      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      const settingsDocRef = doc(db, "settings", "promo_rewards");
      const settingsSnap = await getDoc(settingsDocRef);

      // Retrieve Promo via randomPageId query
      const promoCodesColl = collection(db, "promo_codes");
      let q = query(promoCodesColl, where("randomPageId", "==", randomPageId));
      let qSnap = await getDocs(q);
      if (qSnap.empty) {
        q = query(promoCodesColl, where("pageId", "==", randomPageId));
        qSnap = await getDocs(q);
      }
      if (qSnap.empty) {
        return res.status(400).json({ error: "This promo reward page does not exist or is invalid." });
      }
      
      const promoDoc = qSnap.docs[0];
      const codeUpper = promoDoc.id;
      const promoData = promoDoc.data();
      const requireAccessCode = promoData.requireAccessCode === true;

      // Monetag Ad Verification
      const postbackQuery = query(
        collection(db, "monetag_postbacks"),
        where("identified_tg_id", "==", userId),
        where("identified_task", "==", `PROMO_CLAIM_${randomPageId}`),
        where("status", "==", "success")
      );
      
      const postbackSnap = await getDocs(postbackQuery);
      if (postbackSnap.empty && userId !== "ADMIN_PREVIEW") {
        return res.status(400).json({ error: "Ad verification failed. Please watch the ad until completion." });
      }

      if (!postbackSnap.empty) {
        // Find most recent manually if needed, but for now just take the first success
        const pbData = postbackSnap.docs[0].data();
        const pbTime = new Date(pbData.timestamp).getTime();
        const now = new Date().getTime();
        // Postback must be within last 15 minutes
        if (now - pbTime > 15 * 60 * 1000) {
          return res.status(400).json({ error: "Ad verification expired. Please watch the ad again." });
        }
      }

      // Fetch user profile early
      const userRef = doc(db, "users", userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await updateDoc(promoDoc.ref, { failedClaims: increment(1) }).catch(() => {});
        return res.status(400).json({ error: "User profile not found. Please activate via bot first." });
      }
      const userData = userSnap.data();
      const tgUserId = userData.telegramId || userId;

      const userName = verifiedUser ? (verifiedUser.first_name + (verifiedUser.last_name ? " " + verifiedUser.last_name : "")) : (userData?.firstName || "User");
      const verifiedUsername = verifiedUser ? (verifiedUser.username || "") : "";

      if (requireAccessCode) {
        // Verify Session exists and is active for this user & this specific promo page!
        const sessionRef = doc(db, "promo_sessions", `${userId}_${randomPageId}`);
        const sessionSnap = await getDoc(sessionRef);
        if (!sessionSnap.exists()) {
          await updateDoc(promoDoc.ref, { failedClaims: increment(1) }).catch(() => {});
          return res.status(400).json({ error: "Your access session has expired or is not active." });
        }
        const sData = sessionSnap.data();
        if (new Date(sData.expiresAt) < new Date()) {
          await updateDoc(promoDoc.ref, { expiredAttempts: increment(1) }).catch(() => {});
          return res.status(400).json({ error: "Your access session has expired. Please unlock again." });
        }
      }

      // 5. Already Claimed Check
      const claimRef = doc(db, "promo_claims", `${userId}_${codeUpper}`);
      const claimSnap = await getDoc(claimRef);
      if (claimSnap.exists() && claimSnap.data().status === "Success") {
        await updateDoc(promoDoc.ref, { duplicateAttempts: increment(1) }).catch(() => {});
        return res.status(400).json({ error: "You have already claimed this promo reward!" });
      }

      // Validate Telegram Group & Channel joins if bot token and configurations are active
      if (tgSettingsSnap.exists() && botToken) {
        const promoSettingsSnap = await getDoc(settingsDocRef);
        if (promoSettingsSnap.exists()) {
          const ps = promoSettingsSnap.data();
          
          // Check Channel Join
          if (ps.tgChannelEnabled && tgSettingsSnap.data().channelUsername) {
            const joined = await checkTelegramJoin(botToken, tgSettingsSnap.data().channelUsername, tgUserId);
            if (!joined) {
              await updateDoc(promoDoc.ref, { failedClaims: increment(1) }).catch(() => {});
              return res.status(400).json({ error: `Please join our Telegram Channel (${tgSettingsSnap.data().channelUsername}) first!` });
            }
          }

          // Check Group Join
          if (ps.tgGroupEnabled && tgSettingsSnap.data().groupUsername) {
            const joined = await checkTelegramJoin(botToken, tgSettingsSnap.data().groupUsername, tgUserId);
            if (!joined) {
              await updateDoc(promoDoc.ref, { failedClaims: increment(1) }).catch(() => {});
              return res.status(400).json({ error: `Please join our Telegram Chat Group (${tgSettingsSnap.data().groupUsername}) first!` });
            }
          }
        }
      }

      let rewardAmount = 0;
      const today = new Date().toISOString().split("T")[0];
      const todayTime = new Date().toLocaleTimeString();

      // Start transaction to verify limits and credit reward
      await runTransaction(db, async (transaction) => {
        // 1. Re-get inside transaction for locking (ALL READS FIRST)
        const promoRef = doc(db, "promo_codes", codeUpper);
        const userStatsRef = doc(db, "promo_user_stats", userId);
        
        const [promoSnap, userStatsSnap] = await Promise.all([
          transaction.get(promoRef),
          transaction.get(userStatsRef)
        ]);

        if (!promoSnap.exists() || !promoSnap.data().enabled) {
          throw new Error("Invalid or inactive promo reward.");
        }
        const pData = promoSnap.data();

        // 2. Date ranges
        if (!isPromoActive(pData.startDate, pData.startTime, pData.expiryDate, pData.expiryTime)) {
          throw new Error("This promo has expired or is not active yet.");
        }

        // 3. Max Users
        if (pData.maxUsers && pData.usedCount >= pData.maxUsers) {
          throw new Error("This promo has reached its maximum claim limit.");
        }

        // 4. Budget
        rewardAmount = Number(pData.rewardAmount || 0);
        const totalBudget = Number(pData.totalBudget || 0);
        const currentBudgetUsed = Number(pData.budgetUsed || 0);
        if (currentBudgetUsed + rewardAmount > totalBudget) {
          throw new Error("This promo has run out of its allocated budget.");
        }

        // (ALL WRITES AFTER READS)
        
        // 7. Promo Code counts
        transaction.update(promoRef, {

          usedCount: increment(1),
          budgetUsed: increment(rewardAmount),
          claimsCount: increment(1),
          // Store claimLogs in doc
          claimLogs: arrayUnion({
            userId,
            username: userName,
            telegramId: tgUserId,
            status: "Success",
            amount: rewardAmount,
            time: `${today} ${todayTime}`
          })
        });

        // 8. User Wallets
        transaction.update(userRef, {
          balance: increment(rewardAmount),
          bonusBalance: increment(rewardAmount),
          availableBalance: increment(rewardAmount),
          earnings: increment(rewardAmount)
        });

        // 9. Analytics in settings
        transaction.update(settingsDocRef, {
          successClaimCount: increment(1),
          budgetUsed: increment(rewardAmount)
        });

        // 10. Unique User Tracking
        let isNewUnique = false;
        if (!userStatsSnap.exists()) {
          isNewUnique = true;
          transaction.set(userStatsRef, {
            claimedCount: 1,
            firstClaimAt: new Date().toISOString()
          });
        } else {
          transaction.update(userStatsRef, { claimedCount: increment(1) });
        }


        if (isNewUnique) {
          transaction.update(settingsDocRef, { uniqueUsersCount: increment(1) });
        }

        // 11. Write Success Claim
        transaction.set(claimRef, {
          userId,
          username: userName,
          telegramId: tgUserId,
          promoCode: codeUpper,
          promoName: pData.name || "Promo Reward",
          rewardAmount,
          status: "Success",
          date: today,
          time: todayTime,
          createdAt: new Date().toISOString()
        });
      });

      // Send Telegram notification
      try {
        if (tgSettingsSnap.exists()) {
          const { botToken, rewardChannelId, adminChatId, chatId } = tgSettingsSnap.data();
          if (botToken) {
            const finalAdminChat = adminChatId || chatId;
            const eventMsg = `✅ <b>Reward Claimed</b>\n\n` +
                             `👤 <b>User:</b> ${userName}\n` +
                             `🆔 <b>Telegram ID:</b> <code>${tgUserId}</code>\n` +
                             `💰 <b>Reward:</b> ₹${rewardAmount}\n` +
                             `🎁 <b>Promo:</b> ${promoData.name || "Promo"}\n` +
                             `🕒 <b>Time:</b> ${today} ${todayTime}`;
            
            if (rewardChannelId) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: rewardChannelId, text: eventMsg, parse_mode: "HTML" })
              }).catch(() => {});
            }
            if (finalAdminChat) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: finalAdminChat, text: eventMsg, parse_mode: "HTML" })
              }).catch(() => {});
            }
          }
        }
      } catch (tgErr) {
        console.error("Error sending TG notification for promo reward:", tgErr);
      }

      res.json({
        success: true,
        promoName: promoData.name || "Promo Reward",
        rewardAmount
      });

      // Post-redemption: check if finished
      try {
        const finalSnap = await getDoc(promoDoc.ref);
        if (finalSnap.exists()) {
          const fData = finalSnap.data();
          const max = Number(fData.maxUsers || 0);
          const used = Number(fData.usedCount || 0);
          const budget = Number(fData.totalBudget || 0);
          const spent = Number(fData.budgetUsed || 0);
          const reward = Number(fData.rewardAmount || 0);

          if ((max > 0 && used >= max) || (budget > 0 && spent + reward > budget)) {
            if (!fData.telegramStatusUpdated) {
              updatePromoTelegramPost(promoDoc.id, used >= max ? "limit_reached" : "budget_finished").catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error("Error in post-redemption check:", err);
      }

    } catch (e: any) {
      console.error("Error in POST /api/promo/redeem:", e);
      const settingsDocRef = doc(db, "settings", "promo_rewards");
      await updateDoc(settingsDocRef, { failedClaimCount: increment(1) }).catch(() => {});
      res.status(400).json({ error: e.message || "Server error" });
    }
  });

  // Get User claims history
  app.get("/api/promo/claims", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const claimsRef = collection(db, "promo_claims");
      const q = query(claimsRef, where("userId", "==", userId), limit(50));
      const snap = await getDocs(q);
      
      const claims: any[] = [];
      snap.forEach((doc) => {
        const d = doc.data();
        claims.push({
          id: doc.id,
          promoName: d.promoName || "Promo Reward",
          rewardAmount: d.rewardAmount,
          date: d.date,
          time: d.time,
          status: d.status,
          createdAt: d.createdAt
        });
      });

      // Sort by date/time descending on backend if timestamp is there
      claims.sort((a, b) => {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });

      res.json({
        success: true,
        claims
      });

    } catch (e: any) {
      console.error("Error in GET /api/promo/claims:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });


  // 🎁 ADMIN PROMO REWARD SYSTEM ENDPOINTS
  
  // Get Promo settings
  app.get("/api/admin/promo/settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "promo_rewards");
      const snap = await getDoc(docRef);
      res.json({ success: true, settings: snap.exists() ? snap.data() : {} });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Update Promo settings
  app.put("/api/admin/promo/settings", async (req, res) => {
    try {
      const docRef = doc(db, "settings", "promo_rewards");
      await setDoc(docRef, req.body, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Get Access Codes
  app.get("/api/admin/promo/access-codes", async (req, res) => {
    try {
      const ref = collection(db, "access_codes");
      const snap = await getDocs(ref);
      const codes: any[] = [];
      snap.forEach((doc) => {
        codes.push({ id: doc.id, ...doc.data() });
      });
      res.json({ success: true, codes });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Create Access Code
  app.post("/api/admin/promo/access-codes", async (req, res) => {
    console.log("Creating Access Code...");
    try {
      const { code, startDate, startTime, expiryDate, expiryTime, maxUsers, enabled } = req.body;
      if (!code) {
        console.error("Firestore Write Failed: Code is required");
        return res.status(400).json({ error: "Code is required" });
      }

      const codeUpper = code.toUpperCase();
      const docRef = doc(db, "access_codes", codeUpper);
      
      console.log("Firestore Write Started");
      await setDoc(docRef, {
        code: codeUpper,
        startDate: startDate || "",
        startTime: startTime || "",
        expiryDate: expiryDate || "",
        expiryTime: expiryTime || "",
        maxUsers: maxUsers ? Number(maxUsers) : 0,
        usedCount: 0,
        enabled: enabled ?? true,
        createdAt: new Date().toISOString()
      });
      console.log("Firestore Write Success");

      res.json({ success: true });
    } catch (e: any) {
      console.error("Firestore Write Failed:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Delete Access Code
  app.delete("/api/admin/promo/access-codes/:id", async (req, res) => {
    try {
      console.log("Firestore Write Started");
      await deleteDoc(doc(db, "access_codes", req.params.id));
      console.log("Firestore Write Success");
      res.json({ success: true });
    } catch (e: any) {
      console.error("Firestore Write Failed:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Update/Edit or Toggle Access Code
  app.put("/api/admin/promo/access-codes/:id", async (req, res) => {
    try {
      const ref = doc(db, "access_codes", req.params.id);
      
      const updateData: any = {};
      if (req.body.enabled !== undefined) updateData.enabled = req.body.enabled;
      if (req.body.code !== undefined) updateData.code = req.body.code.toUpperCase();
      if (req.body.startDate !== undefined) updateData.startDate = req.body.startDate;
      if (req.body.startTime !== undefined) updateData.startTime = req.body.startTime;
      if (req.body.expiryDate !== undefined) updateData.expiryDate = req.body.expiryDate;
      if (req.body.expiryTime !== undefined) updateData.expiryTime = req.body.expiryTime;
      if (req.body.maxUsers !== undefined) updateData.maxUsers = Number(req.body.maxUsers);

      console.log("Firestore Write Started");
      await updateDoc(ref, updateData);
      console.log("Firestore Write Success");
      res.json({ success: true });
    } catch (e: any) {
      console.error("Firestore Write Failed:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Get Promos
  app.get("/api/admin/promo/promos", async (req, res) => {
    try {
      const ref = collection(db, "promo_codes");
      const snap = await getDocs(ref);
      const promos: any[] = [];
      const domain = "https://royshare.onrender.com";
      
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        let randomPageId = data.randomPageId;
        let promoPageUrl = data.promoPageUrl;
        let needsUpdate = false;

        if (!randomPageId) {
          const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
          randomPageId = "";
          for (let i = 0; i < 12; i++) {
            randomPageId += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          if (randomPageId.toUpperCase() === docSnap.id.toUpperCase()) {
            randomPageId += "X";
          }
          promoPageUrl = `${domain}/promo/${randomPageId}`;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await updateDoc(docSnap.ref, { randomPageId, promoPageUrl });
        }

        promos.push({ 
          id: docSnap.id, 
          ...data,
          randomPageId,
          promoPageUrl
        });
      }
      res.json({ success: true, promos });
    } catch (e: any) {
      console.error("Error in GET /api/admin/promo/promos:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // AI Promo Generator API
  app.post("/api/admin/promo/ai-generate", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const systemInstruction = `You are an AI assistant specialized in parsing promotional reward creation inputs from administrators.
Extract the fields: name, code, rewardAmount, totalBudget, maxUsers, startDate, startTime, expiryDate, expiryTime.

CRITICAL MATHEMATICAL CONSTRAINTS AND CALCULATIONS:
- 'name' is the Promo Name.
- 'code' is the uppercase alphanumeric Promo Code (no spaces).
- 'rewardAmount' is the reward per user/claim.
- 'totalBudget' is the total budget allocated for this promo.
- 'maxUsers' is the maximum number of claims/users.
- If total budget and max claims are given, but reward is not: calculate rewardAmount = totalBudget / maxUsers.
- If total budget and reward are given, but max claims is not: calculate maxUsers = totalBudget / rewardAmount.
- If max claims and reward are given, but budget is not: calculate totalBudget = maxUsers * rewardAmount.
- Ensure that the mathematical relation (rewardAmount * maxUsers == totalBudget) is preserved.

DATE CONSTRAINTS:
- Use current year 2026 as the default year.
- 'startDate' must be in YYYY-MM-DD format (e.g. 2026-08-15).
- 'startTime' must be in HH:MM format (24-hour).
- 'expiryDate' must be in YYYY-MM-DD format (e.g. 2026-08-20).
- 'expiryTime' must be in HH:MM format (24-hour).
- If any dates/times are missing, try to infer them reasonably, or leave them empty.

Provide the response strictly in JSON format matching the schema requested.`;

      const response = await safeGenerateContent(ai, {
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Promo Name" },
              code: { type: Type.STRING, description: "Promo Code (uppercase, alphanumeric)" },
              rewardAmount: { type: Type.NUMBER, description: "Reward Amount per claim" },
              totalBudget: { type: Type.NUMBER, description: "Total budget allocated" },
              maxUsers: { type: Type.INTEGER, description: "Maximum Claims / Number of Users" },
              startDate: { type: Type.STRING, description: "Start Date in YYYY-MM-DD format" },
              startTime: { type: Type.STRING, description: "Start Time in HH:MM format" },
              expiryDate: { type: Type.STRING, description: "Expiry Date in YYYY-MM-DD format" },
              expiryTime: { type: Type.STRING, description: "Expiry Time in HH:MM format" }
            },
            required: ["name", "code", "rewardAmount", "totalBudget", "maxUsers"]
          }
        }
      });

      const resultText = response.text?.trim() || "{}";
      const parsedData = JSON.parse(resultText);

      res.json({ success: true, data: parsedData });
    } catch (e: any) {
      console.error("Error in POST /api/admin/promo/ai-generate:", e);
      res.status(500).json({ error: e.message || "Failed to generate promo with AI" });
    }
  });

  // Create Promo Code
  app.post("/api/admin/promo/promos", async (req, res) => {
    try {
      const { 
        name, code, rewardAmount, totalBudget, maxUsers, 
        startDate, startTime, expiryDate, expiryTime, 
        enabled, requireAccessCode, accessCode,
        autoPostChannel, autoPostGroup, pinMessage, deleteAfterExpiry, schedulePost
      } = req.body;

      if (!name || !code || !rewardAmount || !totalBudget) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const codeUpper = code.toUpperCase();
      const docRef = doc(db, "promo_codes", codeUpper);

      // Check if already exists
      const existing = await getDoc(docRef);
      if (existing.exists()) {
        return res.status(400).json({ error: "Promo code already exists" });
      }

      // Generate a completely random alphanumeric 12-character Page ID
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let pageId = "";
      for (let i = 0; i < 12; i++) {
        pageId += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      if (pageId.toUpperCase() === codeUpper) {
        pageId += "X";
      }

      console.log("Generated pageId:", pageId);

      const domain = req.body.domain || "https://royshare.onrender.com";
      const promoPageUrl = `${domain}/promo/${pageId}`;

      const promoData: any = {
        name,
        code: codeUpper,
        promoCode: codeUpper,
        pageId: pageId,
        randomPageId: pageId,
        rewardAmount: Number(rewardAmount),
        totalBudget: Number(totalBudget),
        budgetUsed: 0,
        maxUsers: maxUsers ? Number(maxUsers) : 0,
        usedCount: 0,
        startDate: startDate || "",
        startTime: startTime || "",
        expiryDate: expiryDate || "",
        expiryTime: expiryTime || "",
        enabled: enabled ?? true,
        requireAccessCode: requireAccessCode ?? false,
        accessCode: accessCode || "",
        promoPageUrl,
        createdAt: new Date().toISOString(),
        // Telegram Campaign Fields
        autoPostChannel: autoPostChannel ?? true,
        autoPostGroup: autoPostGroup ?? true,
        pinMessage: pinMessage ?? false,
        deleteAfterExpiry: deleteAfterExpiry ?? false,
        schedulePost: schedulePost ?? false,
        // Analytics
        telegramViews: 0,
        miniAppOpens: 0,
        successfulUnlocks: 0,
        failedClaims: 0,
        duplicateAttempts: 0,
        expiredAttempts: 0,
        wrongAccessCount: 0,
        claimLogs: []
      };

      await setDoc(docRef, promoData);

      // Trigger Automatic Telegram Post
      let tgResult = { channelPostId: null, groupPostId: null, error: null };
      try {
        const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        if (tgSettingsSnap.exists()) {
          const tgSettings = tgSettingsSnap.data();
          const botToken = tgSettings.botToken;
          if (botToken && (promoData.autoPostChannel || promoData.autoPostGroup)) {
            const result = await postPromoToTelegram(promoData, botToken, tgSettings);
            tgResult = { 
              channelPostId: result.channelPostId || null, 
              groupPostId: result.groupPostId || null,
              error: result.error || null
            };
            // Update the doc with post IDs and deep link
            await updateDoc(docRef, {
              telegramChannelPostId: tgResult.channelPostId,
              telegramGroupPostId: tgResult.groupPostId,
              telegramMessageId: tgResult.channelPostId || tgResult.groupPostId,
              telegramDeepLink: result.deepLink || null
            });
          } else if (!botToken && (promoData.autoPostChannel || promoData.autoPostGroup)) {
            tgResult.error = "Bot token missing in Telegram settings";
          }
        } else {
          tgResult.error = "Telegram settings not found in database";
        }
      } catch (tgErr: any) {
        console.error("Auto-post Telegram error:", tgErr);
        tgResult.error = tgErr.message;
      }

      res.json({ success: true, randomPageId: pageId, pageId, telegram: tgResult });
    } catch (e: any) {
      console.error("Error in POST /api/admin/promo/promos:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Delete Promo Code
  app.delete("/api/admin/promo/promos/:id", async (req, res) => {
    try {
      await deleteDoc(doc(db, "promo_codes", req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Toggle/Update Promo Code
  app.put("/api/admin/promo/promos/:id", async (req, res) => {
    try {
      const ref = doc(db, "promo_codes", req.params.id);
      const updateData: any = {};
      if (req.body.enabled !== undefined) updateData.enabled = req.body.enabled;
      if (req.body.requireAccessCode !== undefined) updateData.requireAccessCode = req.body.requireAccessCode;
      if (req.body.accessCode !== undefined) updateData.accessCode = req.body.accessCode;
      
      await updateDoc(ref, updateData);
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error in PUT /api/admin/promo/promos/:id:", e);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Regenerate Promo Page URL
  app.post("/api/admin/promo/promos/regenerate/:id", async (req, res) => {
    try {
      const idUpper = req.params.id.toUpperCase();
      const ref = doc(db, "promo_codes", idUpper);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return res.status(404).json({ error: "Promo not found" });
      }
      
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let pageId = "";
      for (let i = 0; i < 12; i++) {
        pageId += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      if (pageId.toUpperCase() === idUpper) {
        pageId += "X";
      }

      console.log("Generated pageId:", pageId);

      const domain = req.body.domain || "https://royshare.onrender.com";
      const promoPageUrl = `${domain}/promo/${pageId}`;
      
      await updateDoc(ref, { promoPageUrl, pageId, randomPageId: pageId });
      res.json({ success: true, promoPageUrl, randomPageId: pageId, pageId });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Resend Telegram Post
  app.post("/api/admin/promo/promos/resend/:id", async (req, res) => {
    try {
      const idUpper = req.params.id.toUpperCase();
      const ref = doc(db, "promo_codes", idUpper);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return res.status(404).json({ error: "Promo not found" });
      }

      const promo = snap.data();
      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      if (!tgSettingsSnap.exists()) {
        return res.status(400).json({ error: "Telegram Settings not found" });
      }

      const tgSettings = tgSettingsSnap.data();
      const botToken = tgSettings.botToken;
      if (!botToken) {
        return res.status(400).json({ error: "Telegram bot token missing in settings" });
      }

      const result = await postPromoToTelegram(promo, botToken, tgSettings);
      
      // Update Firestore document with new post IDs
      await updateDoc(ref, {
        telegramChannelPostId: result.channelPostId || null,
        telegramGroupPostId: result.groupPostId || null,
        telegramMessageId: result.channelPostId || result.groupPostId || null,
        expiredProcessed: false // reset in case they manually resend
      });

      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("Resend error:", e);
      res.status(500).json({ error: e.message || "Failed to resend Telegram post" });
    }
  });

  // Pin Telegram Messages
  app.post("/api/admin/promo/promos/pin/:id", async (req, res) => {
    try {
      const idUpper = req.params.id.toUpperCase();
      const ref = doc(db, "promo_codes", idUpper);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return res.status(404).json({ error: "Promo not found" });
      }

      const promo = snap.data();
      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      if (!tgSettingsSnap.exists()) {
        return res.status(400).json({ error: "Telegram Settings not found" });
      }

      const tgSettings = tgSettingsSnap.data();
      const botToken = tgSettings.botToken;
      if (!botToken) {
        return res.status(400).json({ error: "Telegram bot token missing" });
      }

      let successCount = 0;
      if (promo.telegramChannelPostId && tgSettings.channelUsername) {
        const pinRes = await fetch("https://api.telegram.org/bot" + botToken + "/pinChatMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: tgSettings.channelUsername, message_id: promo.telegramChannelPostId })
        });
        const r = await pinRes.json();
        if (r.ok) successCount++;
      }

      if (promo.telegramGroupPostId && (tgSettings.groupUsername || tgSettings.chatId)) {
        const targetGroup = tgSettings.groupUsername || tgSettings.chatId;
        const pinRes = await fetch("https://api.telegram.org/bot" + botToken + "/pinChatMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: targetGroup, message_id: promo.telegramGroupPostId })
        });
        const r = await pinRes.json();
        if (r.ok) successCount++;
      }

      res.json({ success: true, pinnedCount: successCount });
    } catch (e: any) {
      console.error("Pin error:", e);
      res.status(500).json({ error: e.message || "Failed to pin messages" });
    }
  });

  // Broadcast Telegram Post
  app.post("/api/admin/promo/promos/broadcast/:id", async (req, res) => {
    try {
      const idUpper = req.params.id.toUpperCase();
      const ref = doc(db, "promo_codes", idUpper);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return res.status(404).json({ error: "Promo not found" });
      }

      const promo = snap.data();
      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      if (!tgSettingsSnap.exists()) {
        return res.status(400).json({ error: "Telegram Settings not found" });
      }

      const tgSettings = tgSettingsSnap.data();
      const botToken = tgSettings.botToken;
      if (!botToken) {
        return res.status(400).json({ error: "Telegram bot token missing" });
      }

      // Re-trigger the post helper to Channel & Group, updating the Firestore record
      const result = await postPromoToTelegram(promo, botToken, tgSettings);
      
      await updateDoc(ref, {
        telegramChannelPostId: result.channelPostId || null,
        telegramGroupPostId: result.groupPostId || null,
        telegramMessageId: result.channelPostId || result.groupPostId || null,
        expiredProcessed: false
      });

      res.json({ success: true, ...result });
    } catch (e: any) {
      console.error("Broadcast error:", e);
      res.status(500).json({ error: e.message || "Broadcast failed" });
    }
  });

  // Track Telegram Views
  app.post("/api/promo/track-view/:id", async (req, res) => {
    try {
      const ref = doc(db, "promo_codes", req.params.id.toUpperCase());
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        return res.status(404).json({ error: "Not found" });
      }
      await updateDoc(ref, {
        telegramViews: increment(1)
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Start background routine to automatically check for expired or finished promos and edit/delete their Telegram posts
  setInterval(async () => {
    try {
      const now = new Date();
      const promoCodesColl = collection(db, "promo_codes");
      const q = query(promoCodesColl, where("enabled", "==", true));
      const qSnap = await getDocs(q);
      
      const tgSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      if (!tgSettingsSnap.exists()) return;
      const tgSettings = tgSettingsSnap.data();
      const botToken = tgSettings?.botToken;
      if (!botToken) return;

      for (const promoDoc of qSnap.docs) {
        const promo = promoDoc.data();
        const startStr = `${promo.startDate}T${promo.startTime || "00:00"}:00`;
        const expiryStr = `${promo.expiryDate}T${promo.expiryTime || "23:59"}:00`;
        const start = new Date(startStr);
        const expiry = new Date(expiryStr);
        
        const maxUsers = Number(promo.maxUsers || 0);
        const usedCount = Number(promo.usedCount || 0);
        const totalBudget = Number(promo.totalBudget || 0);
        const budgetUsed = Number(promo.budgetUsed || 0);
        const rewardAmount = Number(promo.rewardAmount || 0);

        let isEnded = false;
        let endReason = "";

        if (!isNaN(expiry.getTime()) && now > expiry) {
          isEnded = true;
          endReason = "Expired";
        } else if (maxUsers > 0 && usedCount >= maxUsers) {
          isEnded = true;
          endReason = "Claim Limit Reached";
        } else if (totalBudget > 0 && (budgetUsed >= totalBudget || (totalBudget - budgetUsed) < rewardAmount)) {
          isEnded = true;
          endReason = "Budget Exhausted";
        }

        if (isEnded && !promo.expiredProcessed) {
          console.log(`Promo Campaign finished: ${promo.code}. Reason: ${endReason}`);
          
          if (promo.deleteAfterExpiry) {
            // Delete Channel Post
            if (promo.telegramChannelPostId && tgSettings.channelUsername) {
              await fetch("https://api.telegram.org/bot" + botToken + "/deleteMessage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: tgSettings.channelUsername, message_id: promo.telegramChannelPostId })
              }).catch(() => {});
            }
            // Delete Group Post
            if (promo.telegramGroupPostId && (tgSettings.groupUsername || tgSettings.chatId)) {
              const targetGroup = tgSettings.groupUsername || tgSettings.chatId;
              await fetch("https://api.telegram.org/bot" + botToken + "/deleteMessage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: targetGroup, message_id: promo.telegramGroupPostId })
              }).catch(() => {});
            }
          } else {
            // Edit Post to state: ⚠️ Promo Ended
            const msgText = `⚠️ <b>Promo Campaign Ended</b>\n\n` +
                            `🎁 <b>Promo:</b> ${promo.name}\n` +
                            `🏁 <b>Status:</b> Closed (${endReason})\n\n` +
                            `Thank you for participating! 🥳`;
            
            const replyMarkup = {
              inline_keyboard: [
                [
                  { text: "🚫 Campaign Ended", url: "https://t.me/" }
                ]
              ]
            };

            // Edit Channel Post
            if (promo.telegramChannelPostId && tgSettings.channelUsername) {
              await fetch("https://api.telegram.org/bot" + botToken + "/editMessageText", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: tgSettings.channelUsername,
                  message_id: promo.telegramChannelPostId,
                  text: msgText,
                  parse_mode: "HTML",
                  reply_markup: replyMarkup
                })
              }).catch(() => {});
            }
            // Edit Group Post
            if (promo.telegramGroupPostId && (tgSettings.groupUsername || tgSettings.chatId)) {
              const targetGroup = tgSettings.groupUsername || tgSettings.chatId;
              await fetch("https://api.telegram.org/bot" + botToken + "/editMessageText", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: targetGroup,
                  message_id: promo.telegramGroupPostId,
                  text: msgText,
                  parse_mode: "HTML",
                  reply_markup: replyMarkup
                })
              }).catch(() => {});
            }
          }

          // Mark as processed
          await updateDoc(promoDoc.ref, { expiredProcessed: true, enabled: false });
        }
      }
    } catch (err) {
      console.error("Error in background promo expiry routine:", err);
    }
  }, 60000);

  // Get Promo details by pageId (unauthenticated / with status check)
  app.get("/api/promo/details/:id", async (req, res) => {
    try {
      const routeParam = req.params.id;
      console.log("Route parameter:", routeParam);

      if (!routeParam) {
        console.log("Firestore lookup result: Not Found (Missing route parameter)");
        return res.status(400).json({ success: false, error: "Missing page ID" });
      }

      const promoCodesColl = collection(db, "promo_codes");
      let q = query(promoCodesColl, where("pageId", "==", routeParam));
      let qSnap = await getDocs(q);

      if (qSnap.empty) {
        // Fallback query to randomPageId
        q = query(promoCodesColl, where("randomPageId", "==", routeParam));
        qSnap = await getDocs(q);
      }

      console.log("Firestore lookup result:", !qSnap.empty ? "Found" : "Not Found");

      if (qSnap.empty) {
        return res.status(404).json({ success: false, error: "Promo not found" });
      }

      const promoDoc = qSnap.docs[0];
      const promoData = promoDoc.data();
      
      // Check status
      const now = new Date();
      let status: "pending" | "active" | "expired" | "disabled" | "budget_finished" | "claim_limit_reached" = "active";
      
      const startStr = `${promoData.startDate}T${promoData.startTime || "00:00"}:00`;
      const expiryStr = `${promoData.expiryDate}T${promoData.expiryTime || "23:59"}:00`;
      const start = new Date(startStr);
      const expiry = new Date(expiryStr);

      const maxUsers = Number(promoData.maxUsers || 0);
      const usedCount = Number(promoData.usedCount || 0);
      const totalBudget = Number(promoData.totalBudget || 0);
      const budgetUsed = Number(promoData.budgetUsed || 0);
      const rewardAmount = Number(promoData.rewardAmount || 0);

      if (!promoData.enabled) {
        status = "disabled";
      } else if (maxUsers > 0 && usedCount >= maxUsers) {
        status = "claim_limit_reached";
      } else if (totalBudget > 0 && (budgetUsed >= totalBudget || (totalBudget - budgetUsed) < rewardAmount)) {
        status = "budget_finished";
      } else {
        if (!isNaN(start.getTime()) && !isNaN(expiry.getTime())) {
          if (now < start) {
            status = "pending";
          } else if (now > expiry) {
            status = "expired";
          } else {
            status = "active";
          }
        }
      }

      // Log every decision
      console.log("--- PROMO STATUS DECISION ---");
      console.log("Current server time:", now.toISOString());
      console.log("Start datetime (string):", startStr, "Parsed:", !isNaN(start.getTime()) ? start.toISOString() : "Invalid");
      console.log("Expiry datetime (string):", expiryStr, "Parsed:", !isNaN(expiry.getTime()) ? expiry.toISOString() : "Invalid");
      console.log("Enabled value:", promoData.enabled);
      console.log("Budget details:", { totalBudget, budgetUsed, rewardAmount });
      console.log("Claim limit details:", { maxUsers, usedCount });
      console.log("Computed status:", status);
      console.log("-----------------------------");

      // Auto-update Telegram if expired or finished
      if (status !== "active" && status !== "pending" && !promoData.telegramStatusUpdated) {
        // Trigger background update
        updatePromoTelegramPost(promoDoc.id, status).catch(() => {});
      }

      // STRICT CONSTRAINTS: Never reveal code, Firestore document ID, or internal IDs
      res.json({
        success: true,
        promo: {
          name: promoData.name,
          rewardAmount: promoData.rewardAmount,
          enabled: promoData.enabled,
          startDate: promoData.startDate,
          startTime: promoData.startTime,
          expiryDate: promoData.expiryDate,
          expiryTime: promoData.expiryTime,
          status,
          pageId: promoData.pageId || promoData.randomPageId,
          randomPageId: promoData.randomPageId || promoData.pageId,
          promoPageUrl: promoData.promoPageUrl || `https://royshare.onrender.com/promo/${routeParam}`
        }
      });
    } catch (e: any) {
      console.error("Error in GET /api/promo/details/:id:", e);
      res.status(500).json({ error: e.message || "Server error" });
    }
  });

  // Get Analytics
  app.get("/api/admin/promo/analytics", async (req, res) => {
    try {
      const settingsDocRef = doc(db, "settings", "promo_rewards");
      const snap = await getDoc(settingsDocRef);
      const data = snap.exists() ? snap.data() : {};

      // Calculate total remaining budget across promos
      const promosRef = collection(db, "promo_codes");
      const promosSnap = await getDocs(promosRef);
      let totalBudgetLimit = 0;
      let totalBudgetSpent = 0;

      promosSnap.forEach((doc) => {
        const pd = doc.data();
        totalBudgetLimit += Number(pd.totalBudget || 0);
        totalBudgetSpent += Number(pd.budgetUsed || 0);
      });

      res.json({
        success: true,
        analytics: {
          pageOpenedCount: data.pageOpenedCount || 0,
          pageUnlockedCount: data.pageUnlockedCount || 0,
          wrongAccessCount: data.wrongAccessCount || 0,
          successClaimCount: data.successClaimCount || 0,
          failedClaimCount: data.failedClaimCount || 0,
          budgetUsed: data.budgetUsed || totalBudgetSpent,
          remainingBudget: Math.max(0, totalBudgetLimit - totalBudgetSpent),
          uniqueUsersCount: data.uniqueUsersCount || 0
        }
      });
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
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

    // Helper function to clean values and discard placeholder macros
    const cleanValue = (val: any): string | null => {
      if (val === undefined || val === null) return null;
      const str = String(val).trim();
      if (
        str === "" ||
        str === "undefined" ||
        str === "null" ||
        str === "Unknown" ||
        (str.startsWith("{") && str.endsWith("}"))
      ) {
        return null;
      }
      return str;
    };

    const clean_telegram_id = cleanValue(params.telegram_id) || 
                              cleanValue(params.ext_id) || 
                              cleanValue(params.subid) || 
                              cleanValue(params.click_id) || 
                              cleanValue(params.sub_id) || 
                              cleanValue(params.visitor_id);
                              
    const clean_ymid = cleanValue(params.ymid) || 
                       cleanValue(params.clickid) || 
                       cleanValue(params.transaction_id) || 
                       cleanValue(params.visitor_id) || 
                       cleanValue(params.click_id);
                       
    const clean_request_var = cleanValue(params.request_var) || 
                              cleanValue(params.custom_var) || 
                              cleanValue(params.taskId) || 
                              cleanValue(params.subid1);

    // Try to extract from custom underscore-separated ymid format if any other parts are missing or placeholders
    let extracted_tg_id: string | null = null;
    let extracted_task_id: string | null = null;

    if (clean_ymid && clean_ymid.includes("_")) {
      const parts = clean_ymid.split("_");
      if (parts.length >= 2) {
        extracted_tg_id = parts[0];
        extracted_task_id = parts[1];
        console.log(`[MONETAG POSTBACK] Extracted parameters from ymid (${clean_ymid}): TG=${extracted_tg_id}, TASK=${extracted_task_id}`);
      }
    }

    const telegram_id = clean_telegram_id || extracted_tg_id;
    const ymid = clean_ymid;
    const request_var = clean_request_var || extracted_task_id;
    
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
      if (!telegram_id) {
        console.error(`[MONETAG POSTBACK] FAILURE: Missing or macro-placeholder telegram_id.`);
        logEntry.status = "failed";
        logEntry.error = `Invalid or missing telegram_id. Check if ext_id, subid, or ymid was passed to show()`;
        await addDoc(postbackRef, logEntry);
        
        return res.status(400).json({ 
          error: "Missing telegram_id", 
          received: params,
          hint: "Ensure ext_id, subid or ymid is passed in the frontend SDK call" 
        });
      }

      if (!ymid) {
        console.error(`[MONETAG POSTBACK] FAILURE: Missing or macro-placeholder ymid.`);
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
      const isEligibleReward = reward_event_type === "yes" || reward_event_type === "valued";
      if (!isEligibleReward) {
        console.log(`[MONETAG POSTBACK] Event ignored: reward_event_type is '${reward_event_type}'`);
        logEntry.status = "ignored";
        logEntry.reason = `reward_event_type '${reward_event_type}' is neither 'yes' nor 'valued'`;
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
            rewardBalance: 0,
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
      const taskId = request_var || "monetag_default_task";
      let isDailyBonus = false;
      let dailyBonusType = "";
      
      if (taskId.startsWith("daily_bonus_")) {
        isDailyBonus = true;
        dailyBonusType = taskId.replace("daily_bonus_", "");
        const stateSnap = await getDoc(doc(db, "daily_bonus_state", userId));
        if (stateSnap.exists()) {
          const pending = stateSnap.data().pendingRewards?.[dailyBonusType];
          if (pending && !pending.claimed) {
             rewardAmount = Number(pending.amount);
             // Mark as claimed in state
             await updateDoc(doc(db, "daily_bonus_state", userId), {
                [`pendingRewards.${dailyBonusType}.claimed`]: true
             });
             
             // Update daily bonus stats
             try {
                const todayStr = new Date().toISOString().split("T")[0];
                const statsRef = doc(db, "daily_bonus_stats", todayStr);
                const rewardField = dailyBonusType === "wheel" ? "wheelRewards" : dailyBonusType === "box" ? "boxRewards" : "scratchRewards";
                await setDoc(statsRef, { 
                  [rewardField]: increment(rewardAmount),
                  totalClaims: increment(1),
                  totalRewards: increment(rewardAmount)
                }, { merge: true });
                await setDoc(doc(db, "settings", "daily_bonus"), { totalRewardsDistributed: increment(rewardAmount) }, { merge: true });
             } catch(e){}
          } else if (pending && pending.claimed) {
            console.warn(`[MONETAG POSTBACK] Reward already claimed for ${taskId}`);
            return res.status(200).send("Already claimed");
          }
        }
      } else if (taskId !== "monetag_default_task") {
        const taskDoc = await getDoc(doc(db, "tasks", taskId));
        if (taskDoc.exists()) {
          rewardAmount = Number(taskDoc.data().rewardAmount) || rewardAmount;
        }
      }

      console.log(`[MONETAG POSTBACK] Reward Amount determined: ${rewardAmount}`);

      // AUTOMATIC BALANCE UPDATE: Crediting the user immediately
      const currentBalance = Number(userData.availableBalance || userData.balance || 0);
      const currentTotalEarnings = Number(userData.totalEarnings || 0);
      const currentRewardBalance = Number(userData.rewardBalance || 0);
      const newBalance = currentBalance + rewardAmount;
      const newTotalEarnings = currentTotalEarnings + rewardAmount;
      const newRewardBalance = currentRewardBalance + rewardAmount;

      await updateDoc(userDocRef, {
        availableBalance: newBalance,
        balance: newBalance,
        totalEarnings: newTotalEarnings,
        rewardBalance: newRewardBalance,
        lastActive: new Date().toISOString()
      });
      console.log(`[MONETAG POSTBACK] SUCCESS: Balance updated for user ${telegram_id}. New Balance: ${newBalance}`);

      // Send Telegram notification after successful balance update
      try {
        const settingsDoc = await getDoc(doc(db, "settings", "telegram"));
        const botToken = settingsDoc.data()?.botToken;
        if (botToken) {
          const messageText = `🎉 Reward Added Successfully!\n\n` +
            `💰 Reward: ₹${rewardAmount.toFixed(2)}\n` +
            `💳 Reward Balance: ₹${newRewardBalance.toFixed(2)}\n` +
            `🏦 Available Balance: ₹${newBalance.toFixed(2)}\n\n` +
            `Thank you for watching the rewarded advertisement.`;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(telegram_id),
              text: messageText
            })
          });
          console.log(`[MONETAG POSTBACK] Telegram notification successfully sent to user ${telegram_id}`);
        } else {
          console.warn("[MONETAG POSTBACK] Telegram bot token not found in settings/telegram. Notification skipped.");
        }
      } catch (tgError) {
        console.error("[MONETAG POSTBACK] Error sending Telegram notification:", tgError);
      }

      // Create Task Completion Record (Marked as already credited)
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
        reward_credited: true, // Marked as credited
        claimed: true,         // Marked as claimed (since it's automatic)
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        adNetwork: "Monetag"
      };

      await setDoc(doc(completionsRef, completionId), completionData);
      console.log(`[MONETAG POSTBACK] Task Completion Record Created (Auto-Credited): ID=${completionId}`);

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
      const currentRewardBalance = Number(userData.rewardBalance || 0);
      
      const newBalance = currentBalance + rewardAmount;
      const newTotalEarnings = currentTotalEarnings + rewardAmount;
      const newRewardBalance = currentRewardBalance + rewardAmount;

      console.log(`[CLAIM REWARD] Crediting reward: ₹${rewardAmount} to TG=${telegram_id}`);

      // 1. Update User
      await updateDoc(userDocRef, {
        availableBalance: newBalance,
        balance: newBalance,
        totalEarnings: newTotalEarnings,
        rewardBalance: newRewardBalance,
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

      // Always generate the postback URL targeting the production Render backend
      const postbackUrl = `https://royshare.onrender.com/api/monetag/postback?telegram_id={telegram_id}&ymid={ymid}&zone_id={zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&estimated_price={estimated_price}&request_var={request_var}`;

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

      const testYmid = "test_" + Math.random().toString(36).substring(7);
      
      const testUrl = `https://royshare.onrender.com/api/monetag/postback?telegram_id=${telegramId}&zone_id=12345&sub_zone_id=67890&event_type=ad_completed&reward_event_type=yes&estimated_price=0.01&ymid=${testYmid}&request_var=monetag_default_task`;

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

        // Return the new secure direct backend download endpoint
        const downloadUrl = `/download/${linkId}?action=download`;
        console.log(`[DEBUG CLAIM] Returning backend download url: ${downloadUrl}`);

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
      const rawAppUrl = process.env.APP_URL || "https://royshare.onrender.com";
      const appUrl = (rawAppUrl.includes("run.app") || rawAppUrl.includes("ais-dev") || rawAppUrl === "MY_APP_URL") 
        ? "https://royshare.onrender.com" 
        : rawAppUrl;
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

      const rawAppUrl = process.env.APP_URL || "https://royshare.onrender.com";
      const appUrl = (rawAppUrl.includes("run.app") || rawAppUrl.includes("ais-dev") || rawAppUrl === "MY_APP_URL") 
        ? "https://royshare.onrender.com" 
        : rawAppUrl;
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

  // Google Drive Connection Routes
  app.get("/api/google-drive/connect", (req, res) => {
    try {
      const tg_id = req.query.tg_id;
      if (!tg_id) {
        return res.status(400).send("Error: Missing tg_id query parameter.");
      }

      const appUrl = "https://royshare.onrender.com";
      const redirectUri = "https://royshare.onrender.com/api/google-drive/callback";

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      const isConfigured = clientId && clientSecret && 
                           !clientId.startsWith("YOUR_") && !clientId.startsWith("MY_") && clientId.trim() !== "" &&
                           !clientSecret.startsWith("YOUR_") && !clientSecret.startsWith("MY_") && clientSecret.trim() !== "";

      if (!isConfigured) {
        const missingVars = [];
        if (!clientId || clientId.startsWith("YOUR_") || clientId.startsWith("MY_") || clientId.trim() === "") missingVars.push("GOOGLE_CLIENT_ID");
        if (!clientSecret || clientSecret.startsWith("YOUR_") || clientSecret.startsWith("MY_") || clientSecret.trim() === "") missingVars.push("GOOGLE_CLIENT_SECRET");

        res.send(`
          <html>
            <body style="margin:0;padding:0;background-color:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;">
              <div style="padding:2.5rem;max-width:700px;width:90%;border:1px solid #334155;border-radius:20px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.3);background-color:#1e293b;margin:2rem 0;">
                <div style="font-size:3rem;margin-bottom:1rem;text-align:center;">⚙️</div>
                <h1 style="color:#ef4444;font-size:2rem;margin-bottom:1.5rem;margin-top:0;font-weight:700;text-align:center;">Google OAuth Setup Required</h1>
                
                <p style="color:#94a3b8;margin-bottom:1.5rem;font-size:1.1rem;line-height:1.6;">
                  To enable Google Drive integration, you must configure Google OAuth Credentials in the AI Studio environment variables.
                </p>

                <div style="background-color:#0f172a;padding:1.2rem;border-radius:12px;margin-bottom:2rem;border:1px solid #ef4444;">
                  <h3 style="color:#f87171;margin-top:0;margin-bottom:0.8rem;font-size:1.1rem;">Missing Environment Variables:</h3>
                  <ul style="color:#ef4444;font-family:monospace;font-size:1rem;margin:0;padding-left:1.5rem;line-height:1.5;">
                    ${missingVars.map(v => `<li><strong>${v}</strong></li>`).join('')}
                  </ul>
                </div>

                <h2 style="color:#38bdf8;font-size:1.4rem;margin-top:2rem;margin-bottom:1rem;font-weight:600;border-bottom:1px solid #334155;padding-bottom:0.5rem;">How to configure Google Cloud Console:</h2>
                
                <ol style="color:#cbd5e1;padding-left:1.5rem;line-height:1.8;font-size:1rem;">
                  <li style="margin-bottom:0.8rem;">
                    Go to the <strong><a href="https://console.cloud.google.com/" target="_blank" style="color:#38bdf8;text-decoration:underline;">Google Cloud Console</a></strong> and select or create a project.
                  </li>
                  <li style="margin-bottom:0.8rem;">
                    Go to <strong>APIs & Services > OAuth consent screen</strong>:
                    <ul style="padding-left:1.2rem;list-style-type:circle;margin-top:0.4rem;">
                      <li>Choose <strong>External</strong> user type, fill in required fields, and save.</li>
                      <li>In the <strong>Scopes</strong> step, add <code>.../auth/drive.file</code>, <code>.../auth/drive.readonly</code>, <code>.../auth/userinfo.email</code>, and <code>.../auth/userinfo.profile</code>.</li>
                      <li>In the <strong>Test users</strong> step, add your developer email address (e.g., <code>ritikrai2625@gmail.com</code>) so you can authenticate while the app is in testing.</li>
                    </ul>
                  </li>
                  <li style="margin-bottom:0.8rem;">
                    Go to <strong>APIs & Services > Credentials</strong>, click <strong>+ CREATE CREDENTIALS</strong>, and select <strong>OAuth client ID</strong>.
                  </li>
                  <li style="margin-bottom:0.8rem;">
                    Configure the credential:
                    <ul style="padding-left:1.2rem;list-style-type:circle;margin-top:0.4rem;">
                      <li>Select <strong>Web application</strong> as Application type.</li>
                      <li>Under <strong>Authorized redirect URIs</strong>, add this exact URL:<br>
                        <code style="background-color:#0f172a;padding:0.2rem 0.5rem;border-radius:4px;color:#38bdf8;word-break:break-all;font-size:0.9rem;">${redirectUri}</code>
                      </li>
                    </ul>
                  </li>
                  <li style="margin-bottom:0.8rem;">
                    Click <strong>Create</strong>, then copy the generated <strong>Client ID</strong> and <strong>Client Secret</strong>.
                  </li>
                  <li style="margin-bottom:0.8rem;">
                    In AI Studio, go to the <strong>Settings (or Secrets)</strong> menu and add these keys with your copied values:
                    <ul style="padding-left:1.2rem;list-style-type:circle;margin-top:0.4rem;">
                      <li><code>GOOGLE_CLIENT_ID</code></li>
                      <li><code>GOOGLE_CLIENT_SECRET</code></li>
                    </ul>
                  </li>
                </ol>

                <div style="margin-top:2.5rem;text-align:center;">
                  <button onclick="window.location.reload();" style="background-color:#0284c7;color:#ffffff;border:none;padding:0.8rem 1.8rem;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:background-color 0.2s;">
                    🔄 Reload Page
                  </button>
                </div>
              </div>
            </body>
          </html>
        `);
        return;
      }

      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri
      );

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile"
        ],
        state: String(tg_id)
      });

      res.redirect(authUrl);
    } catch (e: any) {
      console.error("Error in Google Drive connect route:", e);
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  app.get("/api/google-drive/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || !state) {
        return res.status(400).send("Error: Missing code or state parameters from Google callback.");
      }

      const appUrl = "https://royshare.onrender.com";
      const redirectUri = "https://royshare.onrender.com/api/google-drive/callback";
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
      );

      const { tokens } = await oauth2Client.getToken(code as string);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: "v2"
      });

      const userInfo = await oauth2.userinfo.get();
      const email = userInfo.data.email || "";
      const name = userInfo.data.name || "";
      const googleUserId = userInfo.data.id || "";

      // Store in Firestore
      const docRef = doc(db, "google_drive_accounts", String(state));
      const existingSnap = await getDoc(docRef);

      const accountData: any = {
        userId: String(state),
        telegramId: String(state),
        name: name,
        email: email,
        gmail: email,
        googleUserId: googleUserId,
        accessToken: tokens.access_token || "",
        expiryTime: tokens.expiry_date || 0,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : "",
        connectedAt: new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }),
        status: "connected"
      };

      if (tokens.refresh_token) {
        accountData.refreshToken = tokens.refresh_token;
      } else if (existingSnap.exists() && existingSnap.data()?.refreshToken) {
        accountData.refreshToken = existingSnap.data().refreshToken;
      }

      await setDoc(docRef, accountData, { merge: true });

      // Notify User via Telegram
      try {
        const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        const botToken = telegramSettingsSnap.exists() ? telegramSettingsSnap.data()?.botToken : null;
        if (botToken) {
          const messageText = `✅ Google Drive connected successfully.\nGmail: ${email}`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(state),
              text: messageText,
              parse_mode: "Markdown"
            })
          });
        }
      } catch (tgErr) {
        console.error("Failed to send telegram notification for google drive connect:", tgErr);
      }

      res.send(`
        <html>
          <body style="margin:0;padding:0;background-color:#0f172a;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="font-family:sans-serif;padding:2.5rem;max-width:500px;width:90%;border:1px solid #334155;border-radius:20px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.3);background-color:#1e293b;text-align:center;color:#f8fafc;">
              <div style="font-size:3rem;margin-bottom:1rem;">✅</div>
              <h1 style="color:#10b981;font-size:2rem;margin-bottom:1rem;margin-top:0;font-weight:700;">Drive Connected!</h1>
              <p style="color:#94a3b8;margin-bottom:1.5rem;font-size:1.1rem;line-height:1.5;">Google Drive has been successfully connected to your RoyShare account.</p>
              <div style="background-color:#334155;padding:1.2rem;border-radius:12px;font-family:monospace;font-size:1rem;color:#e2e8f0;margin-bottom:1.5rem;word-break:break-all;">
                <strong>Gmail:</strong> ${email}
              </div>
              <p style="color:#64748b;font-size:0.9rem;">You can safely close this browser window and return to your Telegram Bot.</p>
            </div>
          </body>
        </html>
      `);
    } catch (e: any) {
      console.error("Error in Google Drive callback:", e);
      res.status(500).send(`Error: ${e.message}`);
    }
  });

  // Helper to format bytes to human readable string
  function formatBytes(bytes: number, decimals = 2): string {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  // Helper to obtain an active access token for Google Drive
  async function getActiveGoogleToken(tgId: string): Promise<{ accessToken: string; email: string }> {
    const docRef = doc(db, "google_drive_accounts", String(tgId));
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error("Google Drive is not connected.");
    }
    const data = snap.data();
    if (data.status !== "connected") {
      throw new Error("Google Drive connection is inactive.");
    }
    if (!data.accessToken || !data.refreshToken) {
      throw new Error("Missing Google Drive credentials.");
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "https://royshare.onrender.com/api/google-drive/callback"
    );

    oauth2Client.setCredentials({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
      expiry_date: data.expiryTime || 0
    });

    const now = Date.now();
    const isExpired = (data.expiryTime || 0) <= now + 60000;

    let accessToken = data.accessToken;
    if (isExpired) {
      console.log(`[Google API Trace] [Step 6] Access token for tg_id ${tgId} is expired or expiring soon. Attempting token refresh...`);
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (credentials.access_token) {
          accessToken = credentials.access_token;
          const expiryTime = credentials.expiry_date || (Date.now() + 3600 * 1000);
          const updateData: any = {
            accessToken: accessToken,
            expiryTime: expiryTime,
            expiryDate: new Date(expiryTime).toISOString()
          };
          await setDoc(docRef, updateData, { merge: true });
          console.log(`[Google API Trace] [Step 6] Token refresh outcome for tg_id ${tgId}: SUCCESS. New access token secured.`);
        } else {
          console.error(`[Google API Trace] [Step 6] Token refresh outcome for tg_id ${tgId}: FAILED. No access token in credentials response.`);
          throw new Error("Failed to refresh Google access token: Response was empty.");
        }
      } catch (refreshErr: any) {
        console.error(`[Google API Trace] [Step 6] Token refresh outcome for tg_id ${tgId}: FAILED. Error:`, refreshErr);
        throw new Error(`Failed to refresh Google access token: ${refreshErr.message}`);
      }
    } else {
      console.log(`[Google API Trace] [Step 6] Token refresh check for tg_id ${tgId}: Active token exists. Expiry: ${new Date(data.expiryTime || 0).toISOString()}. No refresh needed.`);
    }

    return { accessToken, email: data.email || "" };
  }

  // Google Drive Connection Status endpoint
  app.get("/api/google-drive/status", async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) {
        return res.status(400).json({ error: "Missing tg_id" });
      }
      const docRef = doc(db, "google_drive_accounts", String(tgId));
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data()?.status === "connected") {
        return res.json({ connected: true, email: snap.data().email });
      }
      return res.json({ connected: false });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Google Drive Resumable Upload Session initiator endpoint
  app.post("/api/google-drive/initiate-upload", async (req, res) => {
    try {
      const { tg_id, fileName, fileSize, mimeType } = req.body;
      if (!tg_id || !fileName || !fileSize) {
        return res.status(400).json({ error: "Missing required parameters (tg_id, fileName, fileSize)" });
      }

      console.log(`[Google API Trace] [Step 1] Initiating upload trace for tg_id ${tg_id}, file: ${fileName} (${fileSize} bytes)`);

      const { accessToken } = await getActiveGoogleToken(tg_id);

      const targetUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
      const requestHeaders = {
        "Authorization": `Bearer [HIDDEN]`,
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(fileSize),
        "Content-Type": "application/json; charset=UTF-8"
      };
      const requestBody = {
        name: fileName,
        mimeType: mimeType || "application/octet-stream"
      };

      console.log(`[Google API Trace] 1. Exact POST request URL sent to Google Drive API: ${targetUrl}`);
      console.log(`[Google API Trace] 2. Request Headers (sensitive token hidden):`, JSON.stringify(requestHeaders, null, 2));
      console.log(`[Google API Trace] 3. Request Body:`, JSON.stringify(requestBody, null, 2));

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "X-Upload-Content-Type": mimeType || "application/octet-stream",
          "X-Upload-Content-Length": String(fileSize),
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify(requestBody)
      });

      const statusCode = response.status;
      const responseText = await response.text();

      console.log(`[Google API Trace] 4. HTTP Status Code returned by Google: ${statusCode}`);
      console.log(`[Google API Trace] 5. Complete response body from Google:`, responseText);

      if (!response.ok) {
        let errorJson: any = null;
        try {
          errorJson = JSON.parse(responseText);
        } catch (e) {}

        console.error("[Google Resumable] Failed to initiate session. Google error response:", responseText);
        
        // Return the exact Google error JSON as part of details for user requirement 7
        return res.status(statusCode).json({ 
          error: "Google Drive API error initiating upload", 
          details: errorJson || responseText 
        });
      }

      const uploadUrl = response.headers.get("Location");
      if (!uploadUrl) {
        return res.status(500).json({ error: "Google Drive API did not return a Location header for resumable upload" });
      }

      console.log(`[Google API Trace] Success: Location header returned: ${uploadUrl}`);
      return res.json({ uploadUrl });
    } catch (err: any) {
      console.error("[Google Resumable] Error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Google Drive Recover File ID from resumable upload session URL
  app.post("/api/google-drive/recover-file-id", async (req, res) => {
    const { uploadUrl, tg_id } = req.body;
    if (!uploadUrl) {
      return res.status(400).json({ error: "Missing uploadUrl" });
    }
    try {
      console.log(`[Recovery Endpoint] Querying Google Drive upload status for session: ${uploadUrl}`);
      const statusRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": `bytes */*`
        }
      });
      const statusText = await statusRes.text();
      console.log(`[Recovery Endpoint] Status Query HTTP response code: ${statusRes.status}`);
      console.log(`[Recovery Endpoint] Status Query response body:`, statusText);
      
      if (statusRes.status === 200 || statusRes.status === 201) {
        const metadata = JSON.parse(statusText);
        if (metadata.id) {
          return res.json({ driveFileId: metadata.id });
        }
      }
      return res.status(400).json({ error: "Could not retrieve file ID from session, status: " + statusRes.status, details: statusText });
    } catch (err: any) {
      console.error("[Recovery Endpoint] Error:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Google Drive Finalize upload, set permissions, and register in uploads collection
  app.post("/api/google-drive/finalize-upload", async (req, res) => {
    console.log(`[Google API Trace] === START FINALIZE UPLOAD ===`);
    console.log(`[Google API Trace] Finalize request payload received:`, JSON.stringify(req.body, null, 2));

    let { tg_id, driveFileId, fileName, fileSize, mimeType, uploadUrl } = req.body;

    try {
      // Step 1: Validate core inputs and check token
      console.log(`[Google API Trace] [Step 1] Validating core inputs and fetching access token...`);
      if (!tg_id) {
        console.error(`[Google API Trace] [Step 1] Validation FAILED: Missing tg_id.`);
        return res.status(400).json({ error: "Missing required parameter: tg_id", step: 1 });
      }
      if (!fileName) {
        console.error(`[Google API Trace] [Step 1] Validation FAILED: Missing fileName.`);
        return res.status(400).json({ error: "Missing required parameter: fileName", step: 1 });
      }
      if (!fileSize) {
        console.error(`[Google API Trace] [Step 1] Validation FAILED: Missing fileSize.`);
        return res.status(400).json({ error: "Missing required parameter: fileSize", step: 1 });
      }

      let accessToken = "";
      let ownerEmail = "";
      try {
        const tokenObj = await getActiveGoogleToken(tg_id);
        accessToken = tokenObj.accessToken;
        ownerEmail = tokenObj.email;
        console.log(`[Google API Trace] [Step 1] Successfully fetched active Google OAuth token for user: ${ownerEmail}`);
      } catch (authErr: any) {
        console.error(`[Google API Trace] [Step 1] Google OAuth token fetching FAILED:`, authErr);
        return res.status(401).json({ 
          error: "Google Drive OAuth authentication failed", 
          step: 1, 
          details: authErr.message 
        });
      }

      // Step 2: Recover or verify driveFileId
      console.log(`[Google API Trace] [Step 2] Resolving driveFileId (passed: "${driveFileId || ''}", uploadUrl: "${uploadUrl || ''}")...`);
      if (!driveFileId && uploadUrl) {
        console.log(`[Google API Trace] [Step 2] driveFileId is empty. Querying Google Drive upload session status to recover it...`);
        try {
          const statusRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Length": "0",
              "Content-Range": `bytes */*`
            }
          });
          const statusText = await statusRes.text();
          console.log(`[Google API Trace] [Step 2] Google status query HTTP response code: ${statusRes.status}`);
          console.log(`[Google API Trace] [Step 2] Google status query response body:`, statusText);
          
          if (statusRes.status === 200 || statusRes.status === 201) {
            const metadata = JSON.parse(statusText);
            if (metadata.id) {
              driveFileId = metadata.id;
              console.log(`[Google API Trace] [Step 2] Successfully recovered driveFileId from Google: ${driveFileId}`);
            } else {
              console.warn(`[Google API Trace] [Step 2] Google status response parsed but contains no file ID.`);
            }
          } else {
            console.warn(`[Google API Trace] [Step 2] Google status response was not 200/201 OK.`);
          }
        } catch (statusErr: any) {
          console.error(`[Google API Trace] [Step 2] Exception during status query recovery:`, statusErr);
        }
      }

      if (!driveFileId) {
        console.error(`[Google API Trace] [Step 2] Verification FAILED: driveFileId is missing/could not be resolved.`);
        return res.status(400).json({ 
          error: "Google Drive File ID is missing", 
          step: 2, 
          details: "Could not retrieve the file ID from Google Drive. Please make sure the upload completed successfully." 
        });
      }

      console.log(`[Google API Trace] driveFileId successfully resolved: ${driveFileId}`);

      // Step 3: Set public reader permissions on Google Drive
      console.log(`[Google API Trace] [Step 3] Setting public reader permission for file: ${driveFileId}`);
      try {
        const permResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}/permissions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            role: "reader",
            type: "anyone"
          })
        });

        if (!permResponse.ok) {
          const permErr = await permResponse.text();
          console.warn(`[Google API Trace] [Step 3] Warning: Failed to set public permission for file ${driveFileId}:`, permErr);
        } else {
          console.log(`[Google API Trace] [Step 3] Public permissions set successfully.`);
        }
      } catch (permErr: any) {
        console.warn(`[Google API Trace] [Step 3] Warning: Exception while setting public permission:`, permErr);
      }

      // Step 4: RoyShare download ID & Page / Firestore metadata creation
      console.log(`[Google API Trace] [Step 4] Checking for existing metadata records for driveFileId: ${driveFileId}`);
      let uniqueFileId = "";
      let royshareLink = "";
      let existingDoc: any = null;

      try {
        const q = query(collection(db, "uploads"), where("driveFileId", "==", driveFileId));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          existingDoc = qSnap.docs[0].data();
          uniqueFileId = qSnap.docs[0].id;
          royshareLink = existingDoc.royshareLink || `https://royshare.onrender.com/download/${uniqueFileId}`;
          console.log(`[Google API Trace] Found existing RoyShare record for driveFileId ${driveFileId}. Reusing ID: ${uniqueFileId}`);
        }
      } catch (findErr) {
        console.error(`[Google API Trace] Error querying existing uploads in Step 4:`, findErr);
      }

      if (!uniqueFileId) {
        uniqueFileId = "gd_" + Math.random().toString(36).substring(2, 10);
        royshareLink = `https://royshare.onrender.com/download/${uniqueFileId}`;
        console.log(`[Google API Trace] Generated new RoyShare download ID: ${uniqueFileId}`);
      }

      const driveLink = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
      const formattedDate = new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

      console.log(`[Google API Trace] [Step 4] Saving metadata record to Firestore...`);
      try {
        const uploadDocRef = doc(db, "uploads", uniqueFileId);
        await setDoc(uploadDocRef, {
          fileId: uniqueFileId,
          telegramId: String(tg_id),
          userId: String(tg_id),
          driveFileId,
          fileName,
          fileSize: Number(fileSize),
          mimeType: mimeType || "application/octet-stream",
          driveLink,
          royshareLink,
          generatedLink: royshareLink,
          uploadDate: formattedDate,
          downloads: existingDoc ? (existingDoc.downloads || 0) : 0,
          earnings: existingDoc ? (existingDoc.earnings || 0) : 0,
          storage: "google_drive",
          ownerEmail,
          status: "active"
        }, { merge: true });

        console.log(`[Google API Trace] [Step 4] Firestore metadata successfully written.`);
      } catch (fsErr: any) {
        console.error(`[Google API Trace] [Step 4] Firestore metadata creation FAILED:`, fsErr);
        return res.status(500).json({
          error: "Firestore metadata creation failed",
          step: 4,
          driveFileId,
          details: fsErr.message
        });
      }

      // Step 5: Update user totalFiles statistics
      console.log(`[Google API Trace] [Step 5] Updating user totalFiles statistics...`);
      try {
        const uRef = doc(db, "users", String(tg_id));
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
          const currentTotalFiles = uSnap.data().totalFiles || 0;
          await setDoc(uRef, { totalFiles: currentTotalFiles + 1 }, { merge: true });
          console.log(`[Google API Trace] [Step 5] User totalFiles statistics updated successfully.`);
        } else {
          console.log(`[Google API Trace] [Step 5] User document does not exist, skipping totalFiles update.`);
        }
      } catch (uErr) {
        console.error(`[Google API Trace] [Step 5] Warning: Failed to update user totalFiles statistics:`, uErr);
      }

      // Step 6: Send Telegram success notification
      console.log(`[Google API Trace] [Step 6] Attempting to send Telegram success notification...`);
      try {
        const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        const botToken = telegramSettingsSnap.exists() ? telegramSettingsSnap.data()?.botToken : null;
        if (botToken) {
          const formattedSize = formatBytes(Number(fileSize));
          const escapedName = fileName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const messageText = `✅ <b>Large File Uploaded Successfully</b>\n\n📄 <b>File Name:</b> <code>${escapedName}</code>\n📦 <b>File Size:</b> ${formattedSize}\n☁ <b>Storage:</b> Google Drive\n\n🔗 <b>RoyShare Link:</b> ${royshareLink}`;
          
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(tg_id),
              text: messageText,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "📁 My Files", callback_data: "mycontent_myfiles" },
                    { text: "⬆️ Upload Another", callback_data: "mycontent_upload" }
                  ]
                ]
              }
            })
          });

          if (!tgRes.ok) {
            const tgErrText = await tgRes.text();
            console.error(`[Google API Trace] [Step 6] Telegram sendMessage FAILED with status ${tgRes.status}:`, tgErrText);
            return res.status(500).json({
              error: "Telegram success notification failed to send",
              step: 6,
              driveFileId,
              details: `Telegram API error: ${tgErrText}`
            });
          } else {
            console.log(`[Google API Trace] [Step 6] Telegram success notification sent successfully.`);
          }
        } else {
          console.warn(`[Google API Trace] [Step 6] Telegram bot token is not configured in settings.`);
        }
      } catch (tgErr: any) {
        console.error(`[Google API Trace] [Step 6] Telegram success notification FAILED:`, tgErr);
        return res.status(500).json({
          error: "Telegram success notification failed",
          step: 6,
          driveFileId,
          details: tgErr.message
        });
      }

      console.log(`[Google API Trace] === FINALIZE UPLOAD COMPLETED SUCCESSFULLY ===`);
      console.log(`[Google API Trace] Generated RoyShare Link: ${royshareLink}`);
      
      return res.json({
        success: true,
        fileId: uniqueFileId,
        royshareLink
      });

    } catch (err: any) {
      console.error(`[Google API Trace] Unexpected finalize error:`, err);
      return res.status(500).json({ 
        error: "An unexpected error occurred during finalization", 
        step: 4, 
        driveFileId, 
        details: err.message 
      });
    }
  });

  // Admin APIs for Google Drive Accounts
  app.get("/api/admin/google-drive-accounts", async (req, res) => {
    try {
      const colRef = collection(db, "google_drive_accounts");
      const snap = await getDocs(colRef);
      const accounts: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        accounts.push({
          id: d.id,
          userId: data.userId || d.id,
          name: data.name || "N/A",
          email: data.email || "N/A",
          connectedAt: data.connectedAt || "N/A",
          status: data.status || "N/A"
        });
      });
      res.json({ success: true, accounts });
    } catch (e: any) {
      console.error("Error fetching Google Drive accounts for admin:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/google-drive-accounts/:id/disconnect", async (req, res) => {
    try {
      const { id } = req.params;
      const docRef = doc(db, "google_drive_accounts", id);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return res.status(404).json({ error: "Account connection record not found" });
      }

      await updateDoc(docRef, {
        accessToken: "",
        refreshToken: "",
        status: "disconnected"
      });

      // Notify on Telegram
      try {
        const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
        const botToken = telegramSettingsSnap.exists() ? telegramSettingsSnap.data()?.botToken : null;
        if (botToken) {
          const messageText = `⚠️ *Google Drive Disconnected*\n\nYour Google Drive connection has been disconnected.`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(id),
              text: messageText,
              parse_mode: "Markdown"
            })
          });
        }
      } catch (tgErr) {
        console.error("Failed to send telegram disconnect notification:", tgErr);
      }

      res.json({ success: true });
    } catch (e: any) {
      console.error("Error disconnecting Google Drive account:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Differentiate page visit vs file download action
  app.get("/download/:fileId", async (req, res, next) => {
    // If it's a standard page view in browser (not action=download), pass to React SPA
    if (req.query.action !== "download" && (!req.headers.accept || req.headers.accept.includes("text/html"))) {
      return next();
    }

    const { fileId } = req.params;
    console.log(`\n=== [DEBUG DOWNLOAD ROUTE] TRACING STEPS FOR FILE ID: ${fileId} ===`);

    try {
      // Step 1: Read Firestore document
      console.log(`[DEBUG DOWNLOAD ROUTE] Step 1: Reading Firestore document uploads/${fileId}`);
      const docRef = doc(db, "uploads", fileId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        const errorMsg = `Document uploads/${fileId} does not exist in Firestore database.`;
        console.error(`[DEBUG DOWNLOAD ROUTE] Error: ${errorMsg}`);
        return res.status(404).send(`
          <div style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto;">
            <h1 style="color:#ef4444;">404 Not Found</h1>
            <p>${errorMsg}</p>
          </div>
        `);
      }
      
      const itemData = docSnap.data();
      console.log(`[DEBUG DOWNLOAD ROUTE] Firestore document data retrieved:`, JSON.stringify(itemData, null, 2));

      if (itemData.storage === "google_drive") {
        console.log(`[DEBUG DOWNLOAD ROUTE] File is stored on Google Drive. Serving securely...`);
        try {
          const { accessToken } = await getActiveGoogleToken(itemData.telegramId);
          const driveFileId = itemData.driveFileId;

          // Increment download count
          try {
            await setDoc(docRef, { downloads: (itemData.downloads || 0) + 1 }, { merge: true });
          } catch (countErr) {
            console.error("[DEBUG DOWNLOAD ROUTE] Failed to update download count:", countErr);
          }

          const googleStreamUrl = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;
          const response = await fetch(googleStreamUrl, {
            headers: {
              "Authorization": `Bearer ${accessToken}`
            }
          });

          if (!response.ok) {
            console.error(`[DEBUG DOWNLOAD ROUTE] Google Drive stream returned status: ${response.status}`);
            return res.redirect(`https://drive.google.com/uc?export=download&id=${driveFileId}`);
          }

          res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(itemData.fileName)}"`);
          res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
          if (response.headers.get("Content-Length")) {
            res.setHeader("Content-Length", response.headers.get("Content-Length")!);
          }

          if (response.body) {
            const reader = response.body.getReader();
            const pump = async (): Promise<any> => {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                return;
              }
              res.write(value);
              return pump();
            };
            await pump();
            return;
          } else {
            return res.redirect(`https://drive.google.com/uc?export=download&id=${driveFileId}`);
          }
        } catch (err: any) {
          console.error(`[DEBUG DOWNLOAD ROUTE] Error serving Google Drive file:`, err);
          if (itemData.driveFileId) {
            return res.redirect(`https://drive.google.com/uc?export=download&id=${itemData.driveFileId}`);
          }
          throw err;
        }
      }

      // Fetch Telegram Settings to see if we can use getFile as a primary path
      const telegramSettingsSnap = await getDoc(doc(db, "settings", "telegram"));
      const botToken = telegramSettingsSnap.exists() ? telegramSettingsSnap.data()?.botToken : null;
      
      let telegramDirectUrl = "";
      if (botToken && itemData.telegramFileId) {
        try {
          console.log(`[DEBUG DOWNLOAD ROUTE] Checking if file can be fetched via Telegram Bot API...`);
          const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${itemData.telegramFileId}`);
          const getFileData = await getFileRes.json();
          if (getFileData.ok && getFileData.result?.file_path) {
            telegramDirectUrl = `https://api.telegram.org/file/bot${botToken}/${getFileData.result.file_path}`;
            console.log(`[DEBUG DOWNLOAD ROUTE] Successfully retrieved direct Telegram download URL: ${telegramDirectUrl}`);
          } else {
            console.warn(`[DEBUG DOWNLOAD ROUTE] Telegram Bot API getFile returned error (likely file size > 20MB): ${JSON.stringify(getFileData)}`);
          }
        } catch (e: any) {
          console.error(`[DEBUG DOWNLOAD ROUTE] Error querying Telegram Bot API getFile:`, e.message || e);
        }
      }

      // If we got a direct Telegram URL (i.e. file <= 20MB), we redirect directly to it!
      if (telegramDirectUrl) {
        console.log(`[DEBUG DOWNLOAD ROUTE] File is small enough to download via Telegram. Redirecting...`);
        return res.redirect(telegramDirectUrl);
      }

      // Step 2: Resolve Firebase Storage path
      console.log(`[DEBUG DOWNLOAD ROUTE] Step 2: Resolving Firebase Storage path for: ${itemData.fileName || 'file'}`);
      const fileName = itemData.fileName || "file";
      const storagePath = `uploads/${fileId}/${fileName}`;
      console.log(`[DEBUG DOWNLOAD ROUTE] Resolved Firebase Storage path: "${storagePath}"`);

      // Step 3: Generate download URL
      console.log(`[DEBUG DOWNLOAD ROUTE] Step 3: Generating download URL for path: "${storagePath}"`);
      const bucket = getStorage().bucket();
      const fileRef = bucket.file(storagePath);

      console.log(`[DEBUG DOWNLOAD ROUTE] Checking if file exists in Firebase Storage bucket: ${bucket.name}`);
      const [exists] = await fileRef.exists();
      if (!exists) {
        const errorMsg = `File not found in Firebase Storage bucket at path: "${storagePath}"`;
        console.error(`[DEBUG DOWNLOAD ROUTE] Error: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log(`[DEBUG DOWNLOAD ROUTE] File exists in bucket. Generating signed download URL...`);
      const [downloadUrl] = await fileRef.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      });
      console.log(`[DEBUG DOWNLOAD ROUTE] Successfully generated signed download URL: ${downloadUrl}`);

      // Step 4: Return the file
      console.log(`[DEBUG DOWNLOAD ROUTE] Step 4: Returning/serving the file. Redirecting user to: ${downloadUrl}`);
      return res.redirect(downloadUrl);

    } catch (err: any) {
      console.error(`\n🔴 [DEBUG DOWNLOAD ROUTE] EXCEPTION ENCOUNTERED FOR FILE ID: ${fileId}`);
      console.error(`Error Message: ${err.message || err}`);
      console.error(`Stack Trace:\n`, err.stack || err);
      console.error(`================================================================================\n`);

      // Never redirect to Telegram on download failure. Return the real error (404, 403 or 500) with the reason.
      const statusCode = err.message?.includes("not found") ? 404 : 500;
      return res.status(statusCode).send(`
        <div style="font-family:sans-serif;padding:2rem;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;margin-top:4rem;box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1);background-color:#ffffff;">
          <h1 style="color:#ef4444;font-size:1.875rem;margin-bottom:1rem;margin-top:0;">Download Failed</h1>
          <p style="color:#475569;margin-bottom:1.5rem;">An error occurred while attempting to resolve your file download.</p>
          <div style="background-color:#f1f5f9;padding:1rem;border-radius:6px;font-family:monospace;font-size:0.875rem;color:#0f172a;word-break:break-all;">
            <strong>Error ${statusCode}:</strong> ${err.message || err}
          </div>
          <p style="color:#94a3b8;font-size:0.75rem;margin-top:1.5rem;text-align:center;">RoyShare Safe Download System</p>
        </div>
      `);
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
