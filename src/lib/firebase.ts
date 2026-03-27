import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: "jcdigitalsolutions-jc7.firebaseapp.com",
  projectId: "jcdigitalsolutions-jc7",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
