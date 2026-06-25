import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

async function diagnose() {
    console.log("--- Diagnostic Start ---");
    try {
        console.log("Process GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT);
        console.log("Process GOOGLE_APPLICATION_CREDENTIALS:", process.env.GOOGLE_APPLICATION_CREDENTIALS);
        
        initializeApp();
        
        const app = getApp();
        console.log("App projectId:", app.options.projectId);
        console.log("App credential type:", typeof app.options.credential);
        
    } catch (e) {
        console.error("Diagnostic error:", e);
    }
    console.log("--- Diagnostic End ---");
}
diagnose();
