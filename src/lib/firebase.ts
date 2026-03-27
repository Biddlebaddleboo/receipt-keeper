import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDummyKeyForPublicRead",
  authDomain: "jcdigitalsolutions-jc7.firebaseapp.com",
  projectId: "jcdigitalsolutions-jc7",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
