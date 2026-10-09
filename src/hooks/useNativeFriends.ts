import { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, query, where, getDocs, onSnapshot, Firestore } from 'firebase/firestore';
import { getAllFirestoreDbs, getDb, auth } from '../firebase';
import { NativeFriendTutor } from '../types';
import { INITIAL_NATIVE_FRIENDS } from '../data/tutors';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

/**
 * Checks if a tutor has been approved by admin or registration workflow.
 * Verifies all standard fields recorded by the admin panel and registration forms.
 */
export function isTutorApproved(t: any): boolean {
  if (!t) return false;
  return (
    t.approvalStatus === 'approved' ||
    t.isApproved === true ||
    t.status === 'approved' ||
    t.approved === true
  );
}

/**
 * Checks if a user has teacher/native friend role.
 */
export function isTeacherRole(t: any): boolean {
  if (!t) return false;
  const role = (t.role || '').toLowerCase().trim();
  return role === 'teacher' || role === 'native_friend' || role === 'tutor' || !t.role;
}

/**
 * Normalizes a raw Firestore document into a typed NativeFriendTutor.
 */
function normalizeTutorDoc(docId: string, data: any): NativeFriendTutor | null {
  if (!data) return null;
  const cleanEmail = (data.email || '').toLowerCase().trim();
  const name = (data.name || '').trim();

  // If there's no name and no email, it's an incomplete stub
  if (!name && !cleanEmail) return null;

  const isApproved = isTutorApproved(data);
  const approvalStatus = isApproved ? 'approved' : (data.approvalStatus || data.status || 'pending');

  const resolvedId = data.id || docId;
  const avatar = data.avatar || data.picture || data.photoUrl || '';

  return {
    id: resolvedId,
    uid: data.uid || resolvedId,
    name: name || cleanEmail.split('@')[0] || 'Native Friend',
    email: cleanEmail,
    avatar: avatar,
    photoUrl: avatar,
    country: data.country || 'Global',
    countryCode: data.countryCode || '',
    flag: data.flag || '🇺🇸',
    accent: data.accent || 'North American',
    rating: typeof data.rating === 'number' ? data.rating : 5.0,
    reviewsCount: typeof data.reviewsCount === 'number' ? data.reviewsCount : 0,
    activeStudents: typeof data.activeStudents === 'number' ? data.activeStudents : 0,
    lessonsTaught: typeof data.lessonsTaught === 'number' ? data.lessonsTaught : 12,
    pricePerSessionUsd: Number(data.pricePerSessionUsd) || (data.pricePerSessionBrl ? Math.round(Number(data.pricePerSessionBrl) / 5.5) : 20),
    pricePerSessionBrl: Number(data.pricePerSessionBrl) || Math.round((Number(data.pricePerSessionUsd) || 20) * 5.5),
    headline: data.headline || 'English Conversational Native Friend',
    bio: data.bio || 'Native English speaker ready to help you speak with natural fluency.',
    specialties: Array.isArray(data.specialties) ? data.specialties : ['Conversação', 'Pronúncia', 'Fluência'],
    videoIntroUrl: data.videoIntroUrl || data.youtubeUrl || data.videoUrl || data.introVideoUrl || '',
    youtubeEmbedId: data.youtubeEmbedId || '',
    introVideoUrl: data.introVideoUrl || data.videoUrl || '',
    videoUrl: data.videoUrl || '',
    youtubeUrl: data.youtubeUrl || '',
    availableDays: Array.isArray(data.availableDays) ? data.availableDays : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    availableHours: Array.isArray(data.availableHours) ? data.availableHours : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
    isSuperTutor: Boolean(data.isSuperTutor),
    languagesSpoken: Array.isArray(data.languagesSpoken) ? data.languagesSpoken : ['English'],
    approvalStatus: approvalStatus as any,
    isApproved: isApproved,
    status: approvalStatus,
    approved: isApproved,
    appliedAt: data.appliedAt || data.createdAt || new Date().toISOString(),
    meetUrl: data.meetUrl || data.meetLink || '',
    meetLink: data.meetLink || data.meetUrl || '',
    timezone: data.timezone || 'America/Toronto',
    availability: data.availability || {},
    availableHoursByDay: data.availableHoursByDay || {},
    role: 'teacher',
  };
}

/**
 * Direct fetch from unified Firestore collections across production and preview databases.
 * Guarantees no external/remote records (e.g. Charles) are filtered out.
 */
export async function fetchPublicNativeFriendsFromFirestore(): Promise<{
  allTutors: NativeFriendTutor[];
  publicTutors: NativeFriendTutor[];
}> {
  const dbs = getAllFirestoreDbs();
  const tutorMap = new Map<string, NativeFriendTutor>();

  for (const dbInstance of dbs) {
    try {
      // 1. Primary unified query: /users where role == 'teacher'
      const teachersQuery = query(collection(dbInstance, 'users'), where('role', '==', 'teacher'));
      const teachersSnap = await getDocs(teachersQuery).catch((err) => {
        handleFirestoreError(err, OperationType.GET, 'users');
        return null;
      });

      if (teachersSnap) {
        teachersSnap.forEach((d) => {
          const tutor = normalizeTutorDoc(d.id, d.data());
          if (tutor) {
            const key = (tutor.email || tutor.id).toLowerCase().trim();
            const existing = tutorMap.get(key);
            if (!existing || (!isTutorApproved(existing) && isTutorApproved(tutor))) {
              tutorMap.set(key, tutor);
            } else {
              tutorMap.set(key, { ...existing, ...tutor, isApproved: existing.isApproved || tutor.isApproved });
            }
          }
        });
      }

      // 2. Authoritative fallback collection: /tutors
      const tutorsSnap = await getDocs(collection(dbInstance, 'tutors')).catch((err) => {
        handleFirestoreError(err, OperationType.GET, 'tutors');
        return null;
      });

      if (tutorsSnap) {
        tutorsSnap.forEach((d) => {
          const tutor = normalizeTutorDoc(d.id, d.data());
          if (tutor) {
            const key = (tutor.email || tutor.id).toLowerCase().trim();
            const existing = tutorMap.get(key);
            if (!existing || (!isTutorApproved(existing) && isTutorApproved(tutor))) {
              tutorMap.set(key, tutor);
            } else {
              tutorMap.set(key, { ...existing, ...tutor, isApproved: existing.isApproved || tutor.isApproved });
            }
          }
        });
      }
    } catch (err) {
      console.warn('[useNativeFriends] Database query notice:', err);
    }
  }

  const allTutors = Array.from(tutorMap.values());
  const publicTutors = allTutors.filter((t) => isTutorApproved(t) && isTeacherRole(t));

  // Required production logging: list retrieved Firestore tutor IDs for verification
  console.log('[NativeFriends Directory] Retrieved Firestore tutor IDs:', publicTutors.map((t) => t.id || t.email));

  return { allTutors, publicTutors };
}

export interface UseNativeFriendsOptions {
  userEmail?: string;
  userRole?: string;
  uid?: string;
  initialData?: NativeFriendTutor[];
}

/**
 * Authoritative hook for fetching, subscribing to, and synchronizing Native Friends
 * across the public landing directory and administrative approval panels.
 */
export function useNativeFriends(options: UseNativeFriendsOptions = {}) {
  const { userEmail, userRole, uid, initialData } = options;
  const [tutors, setTutors] = useState<NativeFriendTutor[]>(
    initialData && initialData.length > 0 ? initialData : INITIAL_NATIVE_FRIENDS
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const cleanUserEmail = (userEmail || '').toLowerCase().trim();
  const isAdmin = userRole === 'admin' || cleanUserEmail === 'adm.itissimple@gmail.com';

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { allTutors } = await fetchPublicNativeFriendsFromFirestore();
      if (allTutors.length > 0) {
        setTutors((prev) => {
          const map = new Map<string, NativeFriendTutor>();
          prev.forEach((t) => map.set((t.email || t.id).toLowerCase().trim(), t));
          allTutors.forEach((t) => {
            const k = (t.email || t.id).toLowerCase().trim();
            const existing = map.get(k);
            const approved = isTutorApproved(t) || (existing && isTutorApproved(existing));
            map.set(k, {
              ...existing,
              ...t,
              isApproved: approved,
              approvalStatus: approved ? 'approved' : t.approvalStatus,
              status: approved ? 'approved' : t.status,
            });
          });
          return Array.from(map.values());
        });
      }
    } catch (err) {
      console.warn('[useNativeFriends] refresh notice:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 1. Initial hydration and real-time Firestore synchronization
  useEffect(() => {
    let isMounted = true;

    // Load initial data
    fetchPublicNativeFriendsFromFirestore()
      .then(({ allTutors }) => {
        if (!isMounted) return;
        if (allTutors.length > 0) {
          setTutors((prev) => {
            const map = new Map<string, NativeFriendTutor>();
            prev.forEach((t) => map.set((t.email || t.id).toLowerCase().trim(), t));
            allTutors.forEach((t) => {
              const k = (t.email || t.id).toLowerCase().trim();
              const existing = map.get(k);
              const approved = isTutorApproved(t) || (existing && isTutorApproved(existing));
              map.set(k, {
                ...existing,
                ...t,
                isApproved: approved,
                approvalStatus: approved ? 'approved' : t.approvalStatus,
                status: approved ? 'approved' : t.status,
              });
            });
            return Array.from(map.values());
          });
        }
      })
      .catch((err) => {
        if (isMounted) console.warn('[useNativeFriends] mount fetch notice:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    // Attach real-time listeners across all databases
    const unsubs: Array<() => void> = [];
    const dbs = getAllFirestoreDbs();

    dbs.forEach((dbInstance) => {
      try {
        const teachersQuery = query(collection(dbInstance, 'users'), where('role', '==', 'teacher'));
        const unsubUsers = onSnapshot(
          teachersQuery,
          (snap) => {
            if (!isMounted) return;
            const liveList: NativeFriendTutor[] = [];
            snap.forEach((d) => {
              const tutor = normalizeTutorDoc(d.id, d.data());
              if (tutor) liveList.push(tutor);
            });
            if (liveList.length > 0) {
              setTutors((prev) => {
                const map = new Map<string, NativeFriendTutor>();
                prev.forEach((t) => map.set((t.email || t.id).toLowerCase().trim(), t));
                liveList.forEach((t) => {
                  const k = (t.email || t.id).toLowerCase().trim();
                  const existing = map.get(k);
                  const approved = isTutorApproved(t) || (existing && isTutorApproved(existing));
                  map.set(k, {
                    ...existing,
                    ...t,
                    isApproved: approved,
                    approvalStatus: approved ? 'approved' : t.approvalStatus,
                    status: approved ? 'approved' : t.status,
                  });
                });
                return Array.from(map.values());
              });
            }
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, 'users');
          }
        );
        unsubs.push(unsubUsers);
      } catch (err) {
        console.warn('[useNativeFriends] Realtime users listener notice:', err);
      }

      try {
        const unsubTutors = onSnapshot(
          collection(dbInstance, 'tutors'),
          (snap) => {
            if (!isMounted) return;
            const liveList: NativeFriendTutor[] = [];
            snap.forEach((d) => {
              const tutor = normalizeTutorDoc(d.id, d.data());
              if (tutor) liveList.push(tutor);
            });
            if (liveList.length > 0) {
              setTutors((prev) => {
                const map = new Map<string, NativeFriendTutor>();
                prev.forEach((t) => map.set((t.email || t.id).toLowerCase().trim(), t));
                liveList.forEach((t) => {
                  const k = (t.email || t.id).toLowerCase().trim();
                  const existing = map.get(k);
                  const approved = isTutorApproved(t) || (existing && isTutorApproved(existing));
                  map.set(k, {
                    ...existing,
                    ...t,
                    isApproved: approved,
                    approvalStatus: approved ? 'approved' : t.approvalStatus,
                    status: approved ? 'approved' : t.status,
                  });
                });
                return Array.from(map.values());
              });
            }
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, 'tutors');
          }
        );
        unsubs.push(unsubTutors);
      } catch (err) {
        console.warn('[useNativeFriends] Realtime tutors listener notice:', err);
      }
    });

    return () => {
      isMounted = false;
      unsubs.forEach((u) => {
        try {
          u();
        } catch {}
      });
    };
  }, []);

  // Filter public tutors for the main landing directory
  const publicTutors = useMemo(() => {
    return tutors.filter((t) => {
      const isApproved = isTutorApproved(t);
      const isTeacher = isTeacherRole(t);
      if (isApproved && isTeacher) return true;

      // Allow tutor themselves to view their profile even if pending
      if (cleanUserEmail && t.email?.toLowerCase().trim() === cleanUserEmail) {
        return true;
      }
      if (uid && t.uid === uid) {
        return true;
      }
      return false;
    });
  }, [tutors, cleanUserEmail, uid]);

  // Log whenever public tutors update in production
  useEffect(() => {
    if (publicTutors.length > 0) {
      console.log(
        '[NativeFriends Directory] Retrieved Firestore tutor IDs:',
        publicTutors.map((t) => t.id || t.email)
      );
    }
  }, [publicTutors]);

  return {
    tutors,
    setTutors,
    publicTutors,
    allTutors: tutors,
    isLoading,
    error,
    refresh,
    isAdmin,
  };
}
