import { Request, Response, NextFunction } from 'express';
import { getFirebaseAdminAuth } from '../serverFirebaseAdmin';

/**
 * Accepted coarse-grained roles within the trusted role authorization model.
 */
export type UserRole = 'admin' | 'teacher' | 'student';

/**
 * Verified Firebase Identity attached to the request by authentication middleware.
 * Only verified server-side claims are populated; untrusted client parameters are ignored.
 */
export interface AuthenticatedUser {
  uid: string;
  email?: string;
  email_verified: boolean;
  role: UserRole;
}

// Extend Express Request interface with type-safe verified identity
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Strongly typed interface for Express handlers requiring an authenticated user.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Extracts a trusted role strictly from the verified Firebase ID token claims.
 *
 * Rules:
 * 1. If decoded token contains role === 'admin' -> 'admin'
 * 2. If decoded token contains role === 'teacher' -> 'teacher'
 * 3. Any unexpected, malicious, or missing claim defaults safely to 'student'
 *
 * Never derives authorization from req.body, req.query, req.params, email,
 * localStorage, Firestore profile role, or client-supplied account objects.
 */
export function extractTrustedRole(
  decodedToken?: Record<string, unknown> | null
): UserRole {
  if (!decodedToken || typeof decodedToken !== 'object') {
    return 'student';
  }

  const rawRole = (decodedToken as { role?: unknown }).role;
  if (rawRole === 'admin') {
    return 'admin';
  }
  if (rawRole === 'teacher') {
    return 'teacher';
  }

  // Safety fallback: unknown or missing claim is safely treated as student
  return 'student';
}

/**
 * Dedicated Express authentication middleware that verifies Firebase ID tokens.
 *
 * Requirements:
 * 1. Reads 'Authorization: Bearer <Firebase_ID_TOKEN>'
 * 2. Rejects requests with missing, malformed, invalid, or expired tokens.
 * 3. Verifies token via Firebase Admin Auth verifyIdToken().
 * 4. Attaches ONLY verified identity information (uid, email, email_verified, role).
 * Never trusts role or UID provided in body or query params.
 */
export const firebaseAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
    });
    return;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Malformed Authorization header. Format must be: Bearer <token>',
    });
    return;
  }

  const idToken = parts[1];

  try {
    const adminAuth = getFirebaseAdminAuth();
    const decodedToken = await adminAuth.verifyIdToken(idToken);

    // Extract trusted role strictly from verified token claims
    const role = extractTrustedRole(decodedToken);

    // Attach ONLY verified identity information from server-verified token
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      email_verified: Boolean(decodedToken.email_verified),
      role,
    };

    next();
  } catch (err: unknown) {
    const errorCode = (err as { code?: string })?.code;

    if (errorCode === 'auth/id-token-expired') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Firebase ID token has expired',
      });
      return;
    }

    if (errorCode === 'auth/id-token-revoked') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Firebase ID token has been revoked',
      });
      return;
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid Firebase ID token',
    });
    return;
  }
};

/**
 * Ensures that an authenticated user identity exists on the request.
 * Returns 401 if unauthenticated.
 */
export const requireAuthenticatedUser = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }
  next();
};

/**
 * Ensures that the authenticated user possesses the 'admin' role.
 * Requires verified req.user.role === 'admin'.
 * Returns 401 if unauthenticated, 403 if unauthorized.
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }

  if (req.user.role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: administrator privileges required',
    });
    return;
  }

  next();
};

/**
 * Ensures that the authenticated user possesses either 'teacher' or 'admin' role.
 * Returns 401 if unauthenticated, 403 if unauthorized.
 */
export const requireTeacher = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }

  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: teacher or administrator privileges required',
    });
    return;
  }

  next();
};

/**
 * Ensures that any verified authenticated user is permitted.
 * Since every valid authenticated user defaults to at least 'student',
 * any verified user is accepted.
 * Returns 401 if unauthenticated.
 */
export const requireStudent = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !req.user.uid) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required: verified user token missing',
    });
    return;
  }

  next();
};

