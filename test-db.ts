import { getDb } from './src/lib/firebase';
import { getDoc, doc } from 'firebase/firestore';

async function inspectDb() {
    try {
        const db = getDb();
        console.log("--- Inspection Start ---");
        
        // 3. Settings/telegram check
        const telegramDocRef = doc(db, 'settings', 'telegram');
        const docSnap = await getDoc(telegramDocRef);

        console.log("Document 'settings/telegram' exists:", docSnap.exists());
        if (docSnap.exists()) {
            console.log("Document data:", docSnap.data());
        } else {
            console.log("Document 'settings/telegram' does not exist.");
        }

        console.log("--- Inspection End ---");
    } catch (e: any) {
        console.error("--- Inspection Exception ---");
        console.error("Code:", e.code);
        console.error("Stack:", e.stack);
    }
}
inspectDb();
