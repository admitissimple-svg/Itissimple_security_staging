import { initializeApp, getApps, applicationDefault, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

let adminAppInstance: App | null = null;
let adminAuthInstance: Auth | null = null;

/**
 * Resolves the Firebase project ID using existing app configuration.
 * Does not read any private keys or secret credentials.
 */
function resolveProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    return process.env.GOOGLE_CLOUD_PROJECT;
  }
  if (process.env.GCLOUD_PROJECT) {
    return process.env.GCLOUD_PROJECT;
  }

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config && config.projectId) {
        return config.projectId;
      }
    }
  } catch {
    // Non-fatal fallback if file cannot be read
  }

  return 'itissimple-8663d';
}

/**
 * Initializes Firebase Admin SDK once using Application Default Credentials (ADC).
 * Never reads or downloads service account JSON keys.
 */
export function getFirebaseAdminApp(): App {
  if (adminAppInstance) {
    return adminAppInstance;
  }

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0]) {
    adminAppInstance = existingApps[0];
    return adminAppInstance;
  }

  const projectId = resolveProjectId();

  adminAppInstance = initializeApp({
    credential: applicationDefault(),
    projectId,
  });

  return adminAppInstance;
}

/**
 * Exposes a safe singleton accessor for Firebase Admin Auth service.
 */
export function getFirebaseAdminAuth(): Auth {
  if (adminAuthInstance) {
    return adminAuthInstance;
  }

  const app = getFirebaseAdminApp();
  adminAuthInstance = getAuth(app);
  return adminAuthInstance;
}
