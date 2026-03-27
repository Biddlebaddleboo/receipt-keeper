import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { FIREBASE_DATABASE_ID } from "@/config";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: "jcdigitalsolutions-jc7.firebaseapp.com",
  projectId: "jcdigitalsolutions-jc7",
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
export const db = getFirestore(app, FIREBASE_DATABASE_ID);
