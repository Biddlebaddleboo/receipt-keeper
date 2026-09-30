import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore/lite";
import { FIREBASE_DATABASE_ID } from "@/config";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDW1XNpjfpBQ0grRZurnxJRZn296lhDQrk",
  authDomain: "receipt-keeper-510215.firebaseapp.com",
  projectId: "receipt-keeper-510215",
  appId: "1:974614483217:web:a87be02273a1a3747b7cb0",
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
export const db = getFirestore(app, FIREBASE_DATABASE_ID);
