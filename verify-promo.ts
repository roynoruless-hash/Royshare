
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
import * as fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
const app = initializeApp(config);
const db = getFirestore(app);

async function verifyPromo(pageId: string) {
  const q = query(collection(db, "promo_codes"), where("pageId", "==", pageId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    console.log("Firestore Document Found:");
    console.log(JSON.stringify(snap.docs[0].data(), null, 2));
  } else {
    console.log("Firestore Document NOT FOUND for pageId:", pageId);
  }
  process.exit(0);
}

const pageId = process.argv[2];
if (!pageId) {
  console.log("Please provide pageId");
  process.exit(1);
}
verifyPromo(pageId);
