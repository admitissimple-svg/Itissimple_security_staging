import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, setLogLevel, Firestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Silence internal gRPC stream disconnection logs
try {
  setLogLevel('silent');
} catch {}

// Active and exclusive project constants for itissimple-8663d
export const ACTIVE_FIREBASE_PROJECT_ID = firebaseConfig.projectId || 'itissimple-8663d';
export const ACTIVE_PROJECT_NUMBER = firebaseConfig.messagingSenderId || '245342369537';
export const ACTIVE_FIREBASE_AUTH_DOMAIN = firebaseConfig.authDomain || `${ACTIVE_FIREBASE_PROJECT_ID}.firebaseapp.com`;
export const ACTIVE_FIREBASE_STORAGE_BUCKET = firebaseConfig.storageBucket || `${ACTIVE_FIREBASE_PROJECT_ID}.firebasestorage.app`;
export const ACTIVE_OAUTH_CLIENT_ID = firebaseConfig.oAuthClientId || '';
export const ACTIVE_FIREBASE_APP_ID = firebaseConfig.appId || '1:245342369537:web:9ef6a4347068d358d68d00';
export const ACTIVE_APP_ID = ACTIVE_FIREBASE_APP_ID;
export const ACTIVE_FIREBASE_DATABASE_ID =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_DATABASE_ID) ||
  firebaseConfig.firestoreDatabaseId ||
  '(default)';
export const ACTIVE_FIRESTORE_DATABASE_ID = ACTIVE_FIREBASE_DATABASE_ID;

// Configuração oficial unificada e blindada
const explicitConfig = {
  apiKey: (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_FIREBASE_API_KEY) || firebaseConfig.apiKey || "AIzaSyBDgPCPMD5wd36mSX0lkkyECz6-rHJdBqk",
  authDomain: ACTIVE_FIREBASE_AUTH_DOMAIN,
  projectId: ACTIVE_FIREBASE_PROJECT_ID,
  storageBucket: ACTIVE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ACTIVE_PROJECT_NUMBER,
  appId: ACTIVE_FIREBASE_APP_ID,
  measurementId: firebaseConfig.measurementId || "G-9TC6P83DPQ",
  oAuthClientId: ACTIVE_OAUTH_CLIENT_ID
};

// Inicialização segura do Firebase (evita duplicação de instâncias)
export const app = !getApps().length ? initializeApp(explicitConfig) : getApp();

export const auth = getAuth(app);
export const db = ACTIVE_FIREBASE_DATABASE_ID && ACTIVE_FIREBASE_DATABASE_ID !== '(default)'
  ? getFirestore(app, ACTIVE_FIREBASE_DATABASE_ID)
  : getFirestore(app);

// Google Auth Provider
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
googleAuthProvider.addScope('https://www.googleapis.com/auth/calendar.events');
googleAuthProvider.addScope('https://www.googleapis.com/auth/gmail.send');
googleAuthProvider.addScope('https://www.googleapis.com/auth/drive.file');
googleAuthProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');

export function getDb(): Firestore {
  return db;
}

export function getDefaultDb(): Firestore {
  return db;
}

export function getAllFirestoreDbs(): Firestore[] {
  return [db];
}

export default app;