import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, setLogLevel, doc, getDoc, setDoc, collection, getDocs, deleteDoc, query, where } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

try {
  setLogLevel('silent');
} catch {}

// Active and exclusive project identifiers
export const ACTIVE_FIREBASE_PROJECT_ID = 'itissimple-8663d';
export const ACTIVE_PROJECT_NUMBER = '245342369537';
export const ACTIVE_FIREBASE_AUTH_DOMAIN = `${ACTIVE_FIREBASE_PROJECT_ID}.firebaseapp.com`;
export const ACTIVE_FIREBASE_STORAGE_BUCKET = `${ACTIVE_FIREBASE_PROJECT_ID}.firebasestorage.app`;
export const ACTIVE_OAUTH_CLIENT_ID = '245342369537-9e4gb01shgsacvt7dkd66d64orr20fn6.apps.googleusercontent.com';
export const ACTIVE_FIREBASE_APP_ID = '1:245342369537:web:9ef6a4347068d358d68d00';
export const ACTIVE_APP_ID = ACTIVE_FIREBASE_APP_ID;
export const ACTIVE_FIREBASE_DATABASE_ID = 
  (typeof process !== 'undefined' && process.env && process.env.FIREBASE_DATABASE_ID && process.env.FIREBASE_DATABASE_ID !== '(default)')
    ? process.env.FIREBASE_DATABASE_ID
    : '(default)';
export const ACTIVE_FIRESTORE_DATABASE_ID = ACTIVE_FIREBASE_DATABASE_ID;

let dbInstance: any = null;
let defaultDbInstance: any = null;

export function getDefaultFirestoreDb() {
  if (defaultDbInstance) return defaultDbInstance;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.projectId = ACTIVE_FIREBASE_PROJECT_ID;
      config.appId = config.appId || ACTIVE_FIREBASE_APP_ID;
      config.apiKey = process.env.FIREBASE_API_KEY || config.apiKey || 'AIzaSyBDgPCPMD5wd36mSX0lkkyECz6-rHJdBqk';
      config.authDomain = ACTIVE_FIREBASE_AUTH_DOMAIN;
      config.storageBucket = config.storageBucket || ACTIVE_FIREBASE_STORAGE_BUCKET;
      const app = getApps().length === 0 ? initializeApp(config) : getApp();
      defaultDbInstance = getFirestore(app);
      return defaultDbInstance;
    }
  } catch (err) {
    console.warn('Could not initialize default Firebase Firestore SDK:', err);
  }
  return null;
}

export function getFirestoreDb() {
  if (dbInstance) return dbInstance;

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Enforce active project configuration: itissimple-8663d and dedicated firestore database ID
      config.projectId = ACTIVE_FIREBASE_PROJECT_ID;
      config.appId = config.appId || ACTIVE_FIREBASE_APP_ID;
      config.apiKey = process.env.FIREBASE_API_KEY || config.apiKey || 'AIzaSyBDgPCPMD5wd36mSX0lkkyECz6-rHJdBqk';
      config.authDomain = ACTIVE_FIREBASE_AUTH_DOMAIN;
      config.storageBucket = config.storageBucket || ACTIVE_FIREBASE_STORAGE_BUCKET;
      const targetDbId = (config.firestoreDatabaseId && config.firestoreDatabaseId !== '(default)')
        ? config.firestoreDatabaseId
        : ACTIVE_FIRESTORE_DATABASE_ID;
      config.firestoreDatabaseId = targetDbId;
      config.messagingSenderId = ACTIVE_PROJECT_NUMBER;
      config.oAuthClientId = config.oAuthClientId || ACTIVE_OAUTH_CLIENT_ID;

      const app = getApps().length === 0 ? initializeApp(config) : getApp();
      dbInstance = targetDbId && targetDbId !== '(default)'
        ? getFirestore(app, targetDbId)
        : getFirestore(app);
      return dbInstance;
    }
  } catch (err) {
    console.warn('Could not initialize Firebase Firestore SDK:', err);
  }
  return null;
}

export function getAllServerFirestoreDbs(): any[] {
  const list: any[] = [];
  const def = getDefaultFirestoreDb();
  if (def) list.push(def);
  const custom = getFirestoreDb();
  if (custom && !list.includes(custom)) list.push(custom);
  return list;
}

// Timeout helper so remote Firestore never blocks an Express API response
function withTimeout<T>(promise: Promise<T>, ms: number = 1500): Promise<T | null> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([
    promise.then((res) => {
      clearTimeout(timer);
      return res;
    }),
    timeoutPromise,
  ]);
}

/**
 * Direct persistence for individual Native Friend / Tutor profiles in /tutors/{tutorId}
 */
export async function saveTutorToFirestore(tutor: any): Promise<boolean> {
  const dbs = getAllServerFirestoreDbs();
  if (dbs.length === 0 || !tutor) return false;
  try {
    const cleanEmail = (tutor.email || '').toLowerCase().trim();
    const tutorId = tutor.id || `tutor-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const approvalStatus = tutor.approvalStatus || (tutor.isApproved ? 'approved' : 'pending');
    const isApproved = approvalStatus === 'approved' || tutor.isApproved === true || tutor.status === 'approved' || tutor.approved === true;

    const sanitized = JSON.parse(JSON.stringify({
      ...tutor,
      id: tutorId,
      email: cleanEmail,
      role: 'teacher',
      approvalStatus,
      isApproved,
      status: approvalStatus,
      approved: isApproved,
      updatedAt: new Date().toISOString(),
    }));

    const cleanEmailDocId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '-');
    const writePromises: Promise<any>[] = [];

    for (const db of dbs) {
      writePromises.push(setDoc(doc(db, 'users', tutorId), sanitized, { merge: true }).catch(() => null));
      writePromises.push(setDoc(doc(db, 'tutors', tutorId), sanitized, { merge: true }).catch(() => null));
      if (cleanEmailDocId !== tutorId) {
        writePromises.push(setDoc(doc(db, 'users', cleanEmailDocId), sanitized, { merge: true }).catch(() => null));
        writePromises.push(setDoc(doc(db, 'tutors', cleanEmailDocId), sanitized, { merge: true }).catch(() => null));
      }
    }

    const savePromise = Promise.all(writePromises).then(() => true);
    const result = await withTimeout(savePromise, 8000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveTutor error:', err);
    return false;
  }
}

/**
 * Fetch all Native Friend / Teacher profiles directly from unified /users collection (role == 'teacher')
 * with fallback to legacy /tutors collection across production and custom databases.
 */
export async function fetchTutorsFromFirestore(): Promise<any[]> {
  const dbs = getAllServerFirestoreDbs();
  if (dbs.length === 0) return [];
  try {
    const fetchPromise = async () => {
      const listMap = new Map<string, any>();

      for (const db of dbs) {
        try {
          // Primary: query unified 'users' collection where role == 'teacher'
          const teachersQuery = query(collection(db, 'users'), where('role', '==', 'teacher'));
          const [usersSnap, legacySnap] = await Promise.all([
            getDocs(teachersQuery).catch(() => null),
            getDocs(collection(db, 'tutors')).catch(() => null),
          ]);

          if (usersSnap) {
            usersSnap.forEach((d) => {
              const data = d.data();
              if (data && (data.email || data.name)) {
                const key = (data.email || d.id).toLowerCase().trim();
                const existing = listMap.get(key) || {};
                const isApproved =
                  data.approvalStatus === 'approved' ||
                  data.isApproved === true ||
                  data.status === 'approved' ||
                  data.approved === true ||
                  existing.isApproved;
                listMap.set(key, {
                  ...existing,
                  id: d.id,
                  ...data,
                  role: 'teacher',
                  ...(isApproved ? { approvalStatus: 'approved', isApproved: true, status: 'approved', approved: true } : {}),
                });
              }
            });
          }

          if (legacySnap) {
            legacySnap.forEach((d) => {
              const data = d.data();
              if (data && (data.email || data.name)) {
                const key = (data.email || d.id).toLowerCase().trim();
                const existing = listMap.get(key) || {};
                const isApproved =
                  data.approvalStatus === 'approved' ||
                  data.isApproved === true ||
                  data.status === 'approved' ||
                  data.approved === true ||
                  existing.isApproved;
                const merged = { ...data, ...existing, id: existing.id || d.id, role: 'teacher' };
                if (isApproved) {
                  merged.approvalStatus = 'approved';
                  merged.isApproved = true;
                  merged.status = 'approved';
                  merged.approved = true;
                }
                listMap.set(key, merged);
              }
            });
          }
        } catch (dbErr) {
          console.warn('Error reading tutors from one database instance:', dbErr);
        }
      }

      const results = Array.from(listMap.values());
      const approvedIds = results
        .filter((t) => t.approvalStatus === 'approved' || t.isApproved === true)
        .map((t) => t.id || t.email);
      console.log('[NativeFriends Server] Retrieved Firestore tutor IDs:', approvedIds);
      return results;
    };

    const result = await withTimeout(fetchPromise(), 10000);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.warn('Firestore fetchTutors error:', err);
    return [];
  }
}

/**
 * Delete a tutor profile from /users/{tutorId} and /tutors/{tutorId}
 */
export async function deleteTutorFromFirestore(tutorId: string): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !tutorId) return false;
  try {
    const delFromUsers = deleteDoc(doc(db, 'users', tutorId)).catch(() => null);
    const delFromTutors = deleteDoc(doc(db, 'tutors', tutorId)).catch(() => null);
    const delPromise = Promise.all([delFromUsers, delFromTutors]).then(() => true);
    const result = await withTimeout(delPromise, 6000);
    return !!result;
  } catch (err) {
    console.warn('Firestore deleteTutor error:', err);
    return false;
  }
}

export async function fetchAppStateFromFirestore(): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchDoc = async (docName: string) => {
      try {
        const snap = await getDoc(doc(db, 'app_state', docName));
        return snap.exists() ? snap.data() : null;
      } catch {
        return null;
      }
    };

    const fetchAllPromise = Promise.all([
      fetchDoc('main_data'),
      fetchDoc('routines'),
      fetchDoc('tutors'),
      fetchDoc('assignments'),
      fetchDoc('lessons'),
      fetchDoc('youtube_playlists'),
      fetchTutorsFromFirestore().catch(() => []),
      fetchUsersFromFirestore().catch(() => []),
    ]).then(([mainData, routines, tutors, assignments, lessons, ytPlaylists, directTutors, directUsers]) => {
      if (!mainData && !routines && !tutors && !assignments && !lessons && !ytPlaylists && (!directTutors || directTutors.length === 0) && (!directUsers || directUsers.length === 0)) {
        return null;
      }

      // Merge direct users from /users collection into userProfiles, authUsers, and students
      const mergedUserProfiles = { ...(mainData?.userProfiles || {}) };
      const mergedAuthUsers = { ...(mainData?.authUsers || {}) };
      const studentMap = new Map<string, any>();
      (mainData?.students || []).forEach((s: any) => {
        const key = (s.studentEmail || s.email || '').toLowerCase().trim();
        if (key) studentMap.set(key, s);
      });

      (directUsers || []).forEach((u: any) => {
        const key = (u.email || '').toLowerCase().trim();
        if (key) {
          if (!mergedUserProfiles[key]) {
            mergedUserProfiles[key] = {
              id: u.uid || u.id || `usr-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
              uid: u.uid || u.id,
              name: u.name || key.split('@')[0],
              email: key,
              level: u.level || u.englishLevel || 'iniciante',
              enrollmentStatus: u.enrollmentStatus || 'active',
              learningGoal: u.learningGoal || u.goal || 'English for everyday life & work',
              weeklyStudyDaysTarget: u.weeklyStudyDaysTarget ?? 7,
              weeklyStudyDays: u.weeklyStudyDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
              createdAt: u.createdAt || new Date().toISOString(),
            };
          }
          if (!mergedAuthUsers[key]) {
            mergedAuthUsers[key] = {
              uid: u.uid || u.id || `usr-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
              email: key,
              name: u.name || key.split('@')[0],
              password: u.password || '',
              role: u.role || 'student',
              createdAt: u.createdAt || new Date().toISOString(),
            };
          }
          if ((u.role === 'student' || !u.role) && !studentMap.has(key)) {
            studentMap.set(key, {
              id: u.uid || u.id || `usr-${key.replace(/[^a-zA-Z0-9]/g, '-')}`,
              studentUid: u.uid || u.id,
              name: u.name || key.split('@')[0],
              studentName: u.name || key.split('@')[0],
              email: key,
              studentEmail: key,
              level: u.level || u.englishLevel || 'iniciante',
              studentLevel: u.level || u.englishLevel || 'iniciante',
              goal: u.learningGoal || u.goal || 'English for everyday life & work',
              learningGoal: u.learningGoal || u.goal || 'English for everyday life & work',
              contractedLessons: u.contractedLessons || 5,
              completedLessonsCount: u.completedLessonsCount || 0,
              status: 'active',
              activeSince: (u.createdAt || new Date().toISOString()).split('T')[0],
              createdAt: u.createdAt || new Date().toISOString(),
            });
          }
        }
      });

      const hydratedMainData = {
        ...(mainData || {}),
        userProfiles: mergedUserProfiles,
        authUsers: mergedAuthUsers,
        students: Array.from(studentMap.values()),
      };

      // Merge tutors from /tutors collection with tutors from app_state/tutors so NO tutor is EVER lost
      const tutorMap = new Map<string, any>();
      const stateTutors = Array.isArray(tutors?.tutorsList) ? tutors.tutorsList : [];
      stateTutors.forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) tutorMap.set(key, t);
      });
      (directTutors || []).forEach((t: any) => {
        const key = (t.email || t.id || '').toLowerCase().trim();
        if (key) {
          const existing = tutorMap.get(key) || {};
          const isExistingApproved = existing.approvalStatus === 'approved' || existing.isApproved === true || existing.status === 'approved';
          const isDirectApproved = t.approvalStatus === 'approved' || t.isApproved === true || t.status === 'approved';
          const merged = { ...existing, ...t };
          if (isExistingApproved || isDirectApproved) {
            merged.approvalStatus = 'approved';
            merged.isApproved = true;
            merged.status = 'approved';
          }
          tutorMap.set(key, merged);
        }
      });

      const consolidatedTutorsList = Array.from(tutorMap.values());
      const mergedTutorsDoc = {
        ...(tutors || {}),
        tutorsList: consolidatedTutorsList,
      };

      return {
        ...hydratedMainData,
        ...(routines || {}),
        ...mergedTutorsDoc,
        ...(assignments || {}),
        ...(lessons || {}),
        ...(ytPlaylists && ytPlaylists.playlists ? { youtubePlaylists: ytPlaylists.playlists } : {}),
      };
    });
    return await withTimeout(fetchAllPromise, 15000);
  } catch (err) {
    console.warn('Firestore fetchAppState error:', err);
  }
  return null;
}

export async function saveYouTubePlaylistsToFirestore(playlists: any[]): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !Array.isArray(playlists)) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(playlists));
    const savePromise = setDoc(
      doc(db, 'app_state', 'youtube_playlists'),
      {
        playlists: sanitized,
        count: sanitized.length,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    ).then(() => true);
    const result = await withTimeout(savePromise, 3000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveYouTubePlaylists error:', err);
    return false;
  }
}

export async function fetchYouTubePlaylistsFromFirestore(): Promise<any[] | null> {
  const db = getFirestoreDb();
  if (!db) return null;
  try {
    const fetchPromise = async () => {
      const snap = await getDoc(doc(db, 'app_state', 'youtube_playlists'));
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.playlists)) {
          return data.playlists;
        }
      }
      return null;
    };
    return await withTimeout(fetchPromise(), 3000);
  } catch (err) {
    console.warn('Firestore fetchYouTubePlaylists error:', err);
    return null;
  }
}

export async function saveAppStateToFirestore(data: any): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !data) return false;
  try {
    // Sanitize data: JSON roundtrip eliminates any undefined properties that cause Firestore setDoc to fail
    const sanitized = JSON.parse(JSON.stringify(data));
    const cachedYtPlaylists = Array.isArray(sanitized.youtubePlaylists) ? sanitized.youtubePlaylists : null;

    // Strip out bulky external API caches that must not be stored in main Firestore documents
    delete sanitized.youtubePlaylists;

    // Partition state into modular documents under /app_state/ so each document is well under 250 KB
    // (Firestore has a strict maximum document limit of 1,048,576 bytes).
    const routinesData = {
      studentRoutinesMap: sanitized.studentRoutinesMap || {},
      studentCurrentRoutines: sanitized.studentCurrentRoutines || {},
      routinesByDay: sanitized.routinesByDay || {},
      studentWeeklyChecks: sanitized.studentWeeklyChecks || {},
      weeklyNativeTargets: sanitized.weeklyNativeTargets || {},
      updatedAt: new Date().toISOString(),
    };

    const tutorsData = {
      tutorsList: sanitized.tutorsList || [],
      teachers: sanitized.teachers || [],
      deletedTutorEmails: sanitized.deletedTutorEmails || [],
      deletedTutorIds: sanitized.deletedTutorIds || [],
      updatedAt: new Date().toISOString(),
    };

    const assignmentsData = {
      studentVideoAssignments: sanitized.studentVideoAssignments || {},
      studentSpotifyAssignments: sanitized.studentSpotifyAssignments || {},
      studentWatchedVideos: sanitized.studentWatchedVideos || {},
      studentListenedTracks: sanitized.studentListenedTracks || {},
      studentAwaitingTopicSelection: sanitized.studentAwaitingTopicSelection || {},
      weeklyStudyDays: sanitized.weeklyStudyDays || {},
      weeklyStudyDaysTargets: sanitized.weeklyStudyDaysTargets || {},
      updatedAt: new Date().toISOString(),
    };

    const lessonsData = {
      liveLessons: sanitized.liveLessons || [],
      contractedLessons: sanitized.contractedLessons || [],
      weeklyHomework: sanitized.weeklyHomework || {},
      studentHomeworkMap: sanitized.studentHomeworkMap || {},
      updatedAt: new Date().toISOString(),
    };

    // Keep core system & user settings in main_data, stripped of the partitioned collections
    const mainData = { ...sanitized };
    delete mainData.studentRoutinesMap;
    delete mainData.studentCurrentRoutines;
    delete mainData.routinesByDay;
    delete mainData.studentWeeklyChecks;
    delete mainData.weeklyNativeTargets;
    delete mainData.tutorsList;
    delete mainData.teachers;
    delete mainData.deletedTutorEmails;
    delete mainData.deletedTutorIds;
    delete mainData.studentVideoAssignments;
    delete mainData.studentSpotifyAssignments;
    delete mainData.studentWatchedVideos;
    delete mainData.studentListenedTracks;
    delete mainData.studentAwaitingTopicSelection;
    delete mainData.weeklyStudyDays;
    delete mainData.weeklyStudyDaysTargets;
    delete mainData.liveLessons;
    delete mainData.contractedLessons;
    delete mainData.weeklyHomework;
    delete mainData.studentHomeworkMap;
    mainData.updatedAt = new Date().toISOString();

    // Safe tutors preservation: never overwrite existing tutors with an empty list unless an explicit deletion was requested
    let tutorsDocToWrite = tutorsData;
    const hasIntentionalDeletion = Array.isArray(tutorsData.deletedTutorEmails) && tutorsData.deletedTutorEmails.length > 0;
    if ((!tutorsData.tutorsList || tutorsData.tutorsList.length === 0) && !hasIntentionalDeletion) {
      try {
        const existingSnap = await getDoc(doc(db, 'app_state', 'tutors')).catch(() => null);
        if (existingSnap && existingSnap.exists()) {
          const exData = existingSnap.data();
          if (Array.isArray(exData?.tutorsList) && exData.tutorsList.length > 0) {
            tutorsDocToWrite = {
              ...tutorsData,
              tutorsList: exData.tutorsList,
              teachers: (tutorsData.teachers && tutorsData.teachers.length > 1) ? tutorsData.teachers : (exData.teachers || tutorsData.teachers),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      } catch {}
    }

    const tutorSavePromises = (Array.isArray(tutorsDocToWrite.tutorsList) ? tutorsDocToWrite.tutorsList : []).map((tut: any) => {
      if (tut && (tut.id || tut.email)) {
        const cEmail = (tut.email || '').toLowerCase().trim();
        const tId = tut.id || `tutor-${cEmail.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const teacherData = {
          ...tut,
          id: tId,
          email: cEmail,
          role: 'teacher',
          updatedAt: tut.updatedAt || new Date().toISOString(),
        };
        const p1 = setDoc(doc(db, 'users', tId), teacherData, { merge: true }).catch(() => null);
        const p2 = setDoc(doc(db, 'tutors', tId), teacherData, { merge: true }).catch(() => null);
        return Promise.all([p1, p2]);
      }
      return Promise.resolve();
    });

    const savePromises = Promise.all([
      setDoc(doc(db, 'app_state', 'main_data'), mainData, { merge: true }),
      setDoc(doc(db, 'app_state', 'routines'), routinesData, { merge: true }),
      setDoc(doc(db, 'app_state', 'tutors'), tutorsDocToWrite, { merge: true }),
      setDoc(doc(db, 'app_state', 'assignments'), assignmentsData, { merge: true }),
      setDoc(doc(db, 'app_state', 'lessons'), lessonsData, { merge: true }),
      ...tutorSavePromises,
      ...(cachedYtPlaylists ? [saveYouTubePlaylistsToFirestore(cachedYtPlaylists)] : []),
    ]).then(() => true);

    const result = await withTimeout(savePromises, 15000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveAppState error:', err);
    return false;
  }
}

export async function saveUserToFirestore(user: any): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !user?.email) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify(user));
    const cleanEmail = user.email.toLowerCase().trim();
    // Guarantee that documents in 'users' collection strictly use the Auth UID as document ID, not email or custom strings
    const docId = user.uid || (user.id && !user.id.includes('@') && !user.id.startsWith('usr-') ? user.id : '');
    if (!docId) {
      console.warn('saveUserToFirestore skipped: user has no valid Auth UID');
      return false;
    }

    sanitized.email = cleanEmail;
    sanitized.uid = docId;
    sanitized.id = docId;

    const savePromise = setDoc(doc(db, 'users', docId), sanitized, { merge: true });
    const result = await withTimeout(savePromise.then(() => true), 10000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveUser error:', err);
    return false;
  }
}

export async function fetchUsersFromFirestore(): Promise<any[]> {
  const db = getFirestoreDb();
  if (!db) return [];
  try {
    const fetchPromise = async () => {
      const snap = await getDocs(collection(db, 'users'));
      const list: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data && (data.email || data.id)) {
          list.push({
            id: d.id,
            ...data,
          });
        }
      });
      return list;
    };
    const result = await withTimeout(fetchPromise(), 10000);
    return result || [];
  } catch (err) {
    console.warn('Firestore fetchUsers error:', err);
    return [];
  }
}

export async function fetchUserFromFirestore(email: string, uid?: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || (!email && !uid)) return null;
  try {
    const cleanDocId = email ? email.toLowerCase().trim().replace(/[^a-zA-Z0-9]/g, '-') : '';
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    const fetchPromise = (async () => {
      if (uid) {
        const snapUid = await getDoc(doc(db, 'users', uid));
        if (snapUid.exists()) return snapUid.data();
      }
      if (cleanDocId) {
        const snapEmail = await getDoc(doc(db, 'users', cleanDocId));
        if (snapEmail.exists()) return snapEmail.data();
      }
      if (cleanEmail) {
        try {
          const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            return qSnap.docs[0].data();
          }
        } catch {}
      }
      return null;
    })();
    return await withTimeout(fetchPromise, 8000);
  } catch (err) {
    console.warn('Firestore fetchUser error:', err);
    return null;
  }
}

export async function checkUserExistsInFirestore(email: string): Promise<boolean> {
  if (!email) return false;
  const user = await fetchUserFromFirestore(email);
  return Boolean(user);
}

/**
 * Dedicated persistence for Student Media Assignments (YouTube & Spotify) directly linked to UID.
 * Guarantees that even across reloads, disconnects, or new logins, the assigned content is retained in Firestore.
 */
export async function saveStudentAssignmentsByUid(
  uid: string,
  data: {
    uid?: string;
    email?: string;
    level?: string;
    weeklyCycle?: number;
    weeklyStudyDaysTarget?: number;
    weeklyStudyDays?: string[];
    videoAssignments?: any[];
    spotifyAssignments?: any[];
    routines?: any;
    watchedVideos?: string[];
    listenedTracks?: string[];
    updatedAt?: string;
  }
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      uid,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));
    const savePromise = setDoc(doc(db, 'student_assignments', uid), sanitized, { merge: true }).then(() => true);
    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveStudentAssignmentsByUid error:', err);
    return false;
  }
}

export async function fetchStudentAssignmentsByUid(uid: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !uid) return null;
  try {
    const fetchPromise = getDoc(doc(db, 'student_assignments', uid)).then((snap) => {
      if (snap.exists()) {
        return snap.data();
      }
      return null;
    });
    return await withTimeout(fetchPromise, 2000);
  } catch (err) {
    console.warn('Firestore fetchStudentAssignmentsByUid error:', err);
    return null;
  }
}

/**
 * Dedicated persistence for Teacher Availability Schedule directly linked to UID and Email.
 * Stores granular 30-min slots partitioned by day of week.
 */
export async function saveTeacherAvailabilityToFirestore(
  uidOrEmail: string,
  data: {
    uid?: string;
    teacherEmail?: string;
    meetLink?: string;
    timezone?: string;
    availableDays?: string[];
    availableHours?: string[];
    availableHoursByDay?: Record<string, string[]>;
    availability?: Record<string, string[]>;
    workingHoursStart?: string;
    workingHoursEnd?: string;
    updatedAt?: string;
  }
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !uidOrEmail) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    const cleanDocId = uidOrEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const savePromise = setDoc(doc(db, 'teacher_availability', cleanDocId), sanitized, { merge: true }).then(() => true);

    // If teacher UID is present and different from cleanDocId, also mirror to UID doc
    if (data.uid && data.uid !== cleanDocId) {
      setDoc(doc(db, 'teacher_availability', data.uid), sanitized, { merge: true }).catch(() => {});
    }

    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveTeacherAvailabilityToFirestore error:', err);
    return false;
  }
}

export async function fetchTeacherAvailabilityFromFirestore(uidOrEmail: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !uidOrEmail) return null;
  try {
    const cleanDocId = uidOrEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const fetchPromise = getDoc(doc(db, 'teacher_availability', cleanDocId)).then(async (snap) => {
      if (snap.exists()) {
        return snap.data();
      }
      // If not found by cleanDocId and uidOrEmail is different, try directly
      if (uidOrEmail !== cleanDocId) {
        const snapDirect = await getDoc(doc(db, 'teacher_availability', uidOrEmail));
        if (snapDirect.exists()) return snapDirect.data();
      }
      return null;
    });
    return await withTimeout(fetchPromise, 2000);
  } catch (err) {
    console.warn('Firestore fetchTeacherAvailabilityFromFirestore error:', err);
    return null;
  }
}

/**
 * Persists daily routine video selection to users/{uid}/routines/{dayOfWeek}
 */
export async function saveRoutineVideoSubcollection(
  uid: string,
  dayOfWeek: string,
  data: any
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !uid || !dayOfWeek) return false;
  try {
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      dayOfWeek,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));
    const savePromise = setDoc(doc(db, 'users', uid, 'routines', dayOfWeek), sanitized, { merge: true }).then(() => true);
    const result = await withTimeout(savePromise, 2000);
    return !!result;
  } catch (err) {
    console.warn('Firestore saveRoutineVideoSubcollection error:', err);
    return false;
  }
}

/**
 * Resets isRepeatVideo: false for all days in users/{uid}/routines/{dayOfWeek}
 */
export async function resetRepeatFlagsSubcollection(
  uid: string,
  days: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !uid) return false;
  try {
    await Promise.all(
      days.map((day) =>
        setDoc(
          doc(db, 'users', uid, 'routines', day),
          { isRepeatVideo: false, updatedAt: new Date().toISOString() },
          { merge: true }
        )
      )
    );
    return true;
  } catch (err) {
    console.warn('Firestore resetRepeatFlagsSubcollection error:', err);
    return false;
  }
}

/**
 * Appends videoId to users/{uid} watchedVideosHistory array
 */
export async function addWatchedVideoToUserDoc(
  uid: string,
  videoId: string,
  videoTitle?: string
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !uid || !videoId) return false;
  try {
    const cleanVid = (videoId || '').trim();
    const cleanTitle = (videoTitle || 'Daily Video Practice').trim();
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    const existing = snap.exists() ? (snap.data().watchedVideosHistory || snap.data().watchedVideos || []) : [];
    const list = Array.isArray(existing) ? [...existing] : [];

    const alreadyExists = list.some((item) => {
      if (typeof item === 'string') return item.toLowerCase() === cleanVid.toLowerCase();
      if (item && typeof item === 'object') {
        const id = item.videoId || item.id || '';
        return id.toLowerCase() === cleanVid.toLowerCase();
      }
      return false;
    });

    if (!alreadyExists) {
      list.push({
        videoId: cleanVid,
        videoTitle: cleanTitle,
        watchedAt: new Date().toISOString(),
      });
      await setDoc(userRef, { watchedVideosHistory: list, updatedAt: new Date().toISOString() }, { merge: true });
    }
    return true;
  } catch (err) {
    console.warn('Firestore addWatchedVideoToUserDoc error:', err);
    return false;
  }
}

/**
 * Server-side persistent storage of student vocabulary in Cloud Firestore.
 * CUMULATIVE: Merges incoming words with existing words and writes both to the user doc
 * and the users/{uid}/vocabulary/{wordId} subcollection.
 */
export async function saveStudentVocabularyToFirestoreServer(
  studentUid: string,
  entries: any[],
  studentEmail?: string
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || (!studentUid && !studentEmail)) return false;
  if (!entries || entries.length === 0) return true;

  try {
    const cleanUid = studentUid || (studentEmail ? studentEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    const cleanEmail = (studentEmail || '').toLowerCase().trim();
    const emailDocId = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9_-]/g, '_') : '';
    const hyphenDocId = cleanEmail ? cleanEmail.replace(/[^a-zA-Z0-9]/g, '-') : '';

    const targetDocIds = Array.from(new Set([cleanUid, emailDocId, hyphenDocId].filter(Boolean)));
    const sanitizedEntries = JSON.parse(JSON.stringify(entries || []));

    for (const docId of targetDocIds) {
      let existingList: any[] = [];
      try {
        const userSnap = await getDoc(doc(db, 'users', docId));
        if (userSnap.exists() && Array.isArray(userSnap.data()?.vocabulary)) {
          existingList = userSnap.data().vocabulary;
        }
      } catch {}

      const map = new Map<string, any>();
      existingList.forEach((e) => {
        if (e && e.word) map.set(e.word.toLowerCase().trim(), e);
      });
      sanitizedEntries.forEach((e: any) => {
        if (e && e.word) {
          const key = e.word.toLowerCase().trim();
          map.set(key, { ...(map.get(key) || {}), ...e });
        }
      });
      const accumulated = Array.from(map.values()).sort((a, b) => (a.word || '').localeCompare(b.word || ''));

      await setDoc(doc(db, 'users', docId), { vocabulary: accumulated, updatedAt: new Date().toISOString() }, { merge: true });

      for (const item of sanitizedEntries) {
        if (item && item.word) {
          const wordDocId = (item.id || item.word).toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_');
          await setDoc(
            doc(db, 'users', docId, 'vocabulary', wordDocId),
            { ...item, studentUid: cleanUid, studentEmail: cleanEmail, updatedAt: new Date().toISOString() },
            { merge: true }
          );
        }
      }
    }
    return true;
  } catch (err) {
    console.warn('Firestore server vocabulary save notice:', err);
    return false;
  }
}

/**
 * Server-side persistent storage of Native Friend In-Session Notes & Recommendations in Cloud Firestore.
 * Automatically saves document keyed by specific session date / ID:
 * 1. Under top-level /session_notes/{sessionKey}
 * 2. Under /users/{studentId}/session_notes/{sessionKey}
 * 3. In /lessons/{lessonId} if lessonId is present
 */
export async function saveSessionNotesToFirestoreServer(
  sessionKey: string,
  data: {
    id?: string;
    sessionDate: string;
    lessonId?: string;
    studentEmail: string;
    studentUid?: string;
    teacherEmail?: string;
    teacherName?: string;
    topic?: string;
    content: string;
    updatedAt?: string;
    driveFileId?: string;
    driveFileUrl?: string;
    driveFolderName?: string;
    driveLastSyncedAt?: string;
  }
): Promise<boolean> {
  const db = getFirestoreDb();
  if (!db || !sessionKey || !data) return false;

  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitized = JSON.parse(JSON.stringify({
      ...data,
      id: cleanKey,
      updatedAt: data.updatedAt || new Date().toISOString(),
    }));

    const savePromises: Promise<any>[] = [
      setDoc(doc(db, 'session_notes', cleanKey), sanitized, { merge: true }),
    ];

    // Mirror under student user record
    const studentId = data.studentUid || (data.studentEmail ? data.studentEmail.toLowerCase().trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '');
    if (studentId) {
      savePromises.push(
        setDoc(doc(db, 'users', studentId, 'session_notes', cleanKey), sanitized, { merge: true })
      );
    }

    // Mirror to lesson doc if lessonId is available
    if (data.lessonId) {
      savePromises.push(
        setDoc(
          doc(db, 'lessons', data.lessonId),
          {
            sessionNotesDocument: data.content,
            liveNotes: data.content,
            recommendations: data.content,
            title: data.topic,
            notesLastSavedAt: sanitized.updatedAt,
            updatedAt: sanitized.updatedAt,
            ...(data.driveFileId ? { driveFileId: data.driveFileId } : {}),
            ...(data.driveFileUrl ? { driveFileUrl: data.driveFileUrl } : {}),
            ...(data.driveFolderName ? { driveFolderName: data.driveFolderName } : {}),
            ...(data.driveLastSyncedAt ? { driveLastSyncedAt: data.driveLastSyncedAt } : {}),
          },
          { merge: true }
        )
      );
    }

    await Promise.all(savePromises);
    return true;
  } catch (err) {
    console.warn('Firestore server session notes save notice:', err);
    return false;
  }
}

export async function fetchSessionNotesFromFirestoreServer(sessionKey: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (!db || !sessionKey) return null;
  try {
    const cleanKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const snap = await getDoc(doc(db, 'session_notes', cleanKey));
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    console.warn('Firestore fetch session notes notice:', err);
    return null;
  }
}


