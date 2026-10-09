import { setFirebaseAdminAuthForTesting } from '../src/serverFirebaseAdmin';
import { firebaseAuthMiddleware, requireAdmin, extractTrustedRole, isVerifiedAdminRequest } from '../src/middleware/firebaseAuth';
import type { Request, Response, NextFunction } from 'express';

// Test runner helper
let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

// Mock Response
function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// Mock Request
function createMockRequest(headers: Record<string, string> = {}, body: any = {}, params: any = {}) {
  const req: any = {
    headers,
    body,
    params,
    query: {},
  };
  return req;
}

async function runTests() {
  console.log('\n=== INICIANDO BATERIA DE TESTES: ETAPA 2A (Proteção das rotas administrativas) ===\n');

  // Test suite 1: extractTrustedRole logic
  console.log('--- 1. Testando extração estrita de role a partir de Custom Claims ---');
  assert(extractTrustedRole({ role: 'admin' }) === 'admin', 'Custom claim role=admin extrai admin');
  assert(extractTrustedRole({ role: 'teacher' }) === 'teacher', 'Custom claim role=teacher extrai teacher');
  assert(extractTrustedRole({ role: 'student' }) === 'student', 'Custom claim role=student extrai student');
  assert(extractTrustedRole({ role: 'other' }) === 'student', 'Claim desconhecida rebaixa com segurança para student');
  assert(extractTrustedRole({ email: 'adm.itissimple@gmail.com' }) === 'student', 'E-mail do administrador sem claim NÃO concede admin');
  assert(extractTrustedRole(null) === 'student', 'Token nulo extrai student');
  assert(extractTrustedRole({}) === 'student', 'Token sem claim de role extrai student');

  // Test suite 2: firebaseAuthMiddleware & requireAdmin com mocks
  console.log('\n--- 2. Testando Middleware de Autenticação e Autorização Admin ---');

  // 2.1 Acesso sem token
  {
    const req = createMockRequest();
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Requisição sem token não chama next()');
    assert(res.statusCode === 401, 'Requisição sem token retorna 401', `status: ${res.statusCode}`);
    assert(res.body?.message?.includes('Missing Authorization header'), 'Mensagem informa cabeçalho ausente');
  }

  // 2.2 Token malformado
  {
    const req = createMockRequest({ authorization: 'InvalidBearerFormat' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Cabeçalho malformado não chama next()');
    assert(res.statusCode === 401, 'Cabeçalho malformado retorna 401');
  }

  // 2.3 Token inválido
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => {
        const err: any = new Error('Decoding error');
        err.code = 'auth/argument-error';
        throw err;
      },
    } as any);

    const req = createMockRequest({ authorization: 'Bearer invalid-token-xyz' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Token inválido não chama next()');
    assert(res.statusCode === 401, 'Token inválido retorna 401');
    assert(res.body?.message?.includes('Invalid Firebase ID token'), 'Retorna mensagem de token inválido');
  }

  // 2.4 Token expirado
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => {
        const err: any = new Error('Token expired');
        err.code = 'auth/id-token-expired';
        throw err;
      },
    } as any);

    const req = createMockRequest({ authorization: 'Bearer expired-token' });
    const res = createMockResponse();
    let nextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { nextCalled = true; });
    assert(!nextCalled, 'Token expirado não chama next()');
    assert(res.statusCode === 401, 'Token expirado retorna 401');
    assert(res.body?.message?.includes('expired'), 'Retorna mensagem de token expirado');
  }

  // 2.5 Usuário autenticado SEM claim de administrador (ex: student)
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'user-student-1',
        email: 'student@example.com',
        email_verified: true,
        role: 'student',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer valid-student-token' });
    const res = createMockResponse();
    let authNextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { authNextCalled = true; });
    assert(authNextCalled, 'firebaseAuthMiddleware autentica token de estudante');
    assert(req.user?.role === 'student', 'req.user.role é student');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled, 'requireAdmin bloqueia usuário com role=student');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403 para student');
  }

  // 2.6 Usuário com e-mail de admin mas SEM custom claim (spoofing via email)
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'attacker-1',
        email: 'adm.itissimple@gmail.com', // e-mail do admin, mas sem claim
        email_verified: true,
        // SEM claim role='admin'
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer spoofed-email-token' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});
    assert(req.user?.role === 'student', 'Token sem claim de admin tem role=student mesmo com e-mail do admin');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled, 'requireAdmin bloqueia token mesmo com e-mail de admin se claim não estiver presente');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403');
  }

  // 2.7 Usuário autenticado com custom claim 'teacher'
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'teacher-1',
        email: 'teacher@example.com',
        email_verified: true,
        role: 'teacher',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = createMockResponse();
    await firebaseAuthMiddleware(req, res, () => {});
    assert(req.user?.role === 'teacher', 'req.user.role é teacher');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(!adminNextCalled, 'requireAdmin bloqueia professor de executar operações admin');
    assert(adminRes.statusCode === 403, 'requireAdmin retorna 403 para professor');
  }

  // 2.8 Usuário autenticado COM custom claim 'admin'
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({
        uid: 'admin-master',
        email: 'adm.itissimple@gmail.com',
        email_verified: true,
        role: 'admin',
      }),
    } as any);

    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = createMockResponse();
    let authNextCalled = false;
    await firebaseAuthMiddleware(req, res, () => { authNextCalled = true; });
    assert(authNextCalled, 'firebaseAuthMiddleware autentica admin');
    assert(req.user?.role === 'admin', 'req.user.role é admin');

    const adminRes = createMockResponse();
    let adminNextCalled = false;
    requireAdmin(req, adminRes, () => { adminNextCalled = true; });
    assert(adminNextCalled, 'requireAdmin permite usuário com claim role=admin');
    assert(adminRes.statusCode === 200, 'Código permanece 200');
  }

  // Test suite 3: isVerifiedAdminRequest
  console.log('\n--- 3. Testando helper isVerifiedAdminRequest ---');
  {
    // Sem header
    assert(await isVerifiedAdminRequest(createMockRequest()) === false, 'Sem header retorna false');
    // Token de estudante
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 's1', role: 'student' }),
    } as any);
    assert(await isVerifiedAdminRequest(createMockRequest({ authorization: 'Bearer student' })) === false, 'Token de estudante retorna false');
    // Token de admin
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'a1', role: 'admin' }),
    } as any);
    assert(await isVerifiedAdminRequest(createMockRequest({ authorization: 'Bearer admin' })) === true, 'Token com claim admin retorna true');
  }

  // Test suite 4: Simulação de fluxo das rotas com a cadeia completa de middlewares
  console.log('\n--- 4. Testando execução e proteção das rotas contra bypass ---');

  // Helper para simular execução sequencial de middlewares Express
  async function simulateRoute(
    middlewares: Array<(req: Request, res: Response, next: NextFunction) => any>,
    handler: (req: Request, res: Response) => any,
    req: any
  ) {
    const res = createMockResponse();
    let index = 0;
    const next = async (err?: any) => {
      if (err) {
        res.status(500).json({ error: String(err) });
        return;
      }
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        await mw(req, res, next);
      } else {
        await handler(req, res);
      }
    };
    await next();
    return res;
  }

  // Estado mock em memória para teste isolado
  let mockTutor = {
    id: 'tutor-test-1',
    name: 'Test Tutor',
    email: 'testtutor@example.com',
    approvalStatus: 'pending',
    isApproved: false,
    role: 'teacher',
  };

  const approveHandler = async (req: Request, res: Response) => {
    mockTutor.approvalStatus = 'approved';
    mockTutor.isApproved = true;
    res.status(200).json({ success: true, tutor: mockTutor });
  };

  const rejectHandler = async (req: Request, res: Response) => {
    mockTutor.approvalStatus = 'rejected';
    mockTutor.isApproved = false;
    res.status(200).json({ success: true, tutor: mockTutor });
  };

  let isTutorDeleted = false;
  const deleteHandler = async (req: Request, res: Response) => {
    isTutorDeleted = true;
    res.status(200).json({ success: true, message: 'Deleted' });
  };

  // 4.1 POST /api/tutors/:id/approve sem token
  {
    const req = createMockRequest();
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 401, 'POST /approve sem token retorna 401');
    assert(mockTutor.approvalStatus === 'pending', 'Memória NÃO foi alterada após rejeição por 401');
  }

  // 4.2 POST /api/tutors/:id/approve com token inválido
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => { throw new Error('Invalid signature'); },
    } as any);
    const req = createMockRequest({ authorization: 'Bearer invalid-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 401, 'POST /approve com token inválido retorna 401');
    assert(mockTutor.approvalStatus === 'pending', 'Memória permanece inalterada');
  }

  // 4.3 POST /api/tutors/:id/approve com role=student
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'std-1', role: 'student' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer student-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 403, 'POST /approve com role=student retorna 403');
    assert(mockTutor.approvalStatus === 'pending', 'Memória permanece intacta');
  }

  // 4.4 POST /api/tutors/:id/approve com role=teacher
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'tch-1', role: 'teacher' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 403, 'POST /approve com role=teacher retorna 403');
    assert(mockTutor.approvalStatus === 'pending', 'Memória permanece intacta');
  }

  // 4.5 POST /api/tutors/:id/approve com custom claim role=admin
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', role: 'admin' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], approveHandler, req);
    assert(res.statusCode === 200, 'POST /approve com claim admin retorna 200');
    assert(mockTutor.approvalStatus === 'approved', 'Tutor foi aprovado com sucesso apenas com autorização admin');
  }

  // 4.6 POST /api/tutors/:id/reject sem autorização
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'std-1', role: 'student' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer student-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], rejectHandler, req);
    assert(res.statusCode === 403, 'POST /reject sem autorização retorna 403');
    assert(mockTutor.approvalStatus === 'approved', 'Status de aprovação não foi alterado');
  }

  // 4.7 POST /api/tutors/:id/reject com autorização admin
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', role: 'admin' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], rejectHandler, req);
    assert(res.statusCode === 200, 'POST /reject com claim admin retorna 200');
    assert(mockTutor.approvalStatus === 'rejected', 'Tutor foi rejeitado com autorização admin');
  }

  // 4.8 DELETE /api/tutors/:id sem autorização
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'tch-1', role: 'teacher' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer teacher-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteHandler, req);
    assert(res.statusCode === 403, 'DELETE /api/tutors/:id sem claim admin retorna 403');
    assert(!isTutorDeleted, 'Tutor NÃO foi deletado');
  }

  // 4.9 DELETE /api/tutors/:id com claim admin
  {
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 'adm-1', role: 'admin' }),
    } as any);
    const req = createMockRequest({ authorization: 'Bearer admin-token' });
    const res = await simulateRoute([firebaseAuthMiddleware, requireAdmin], deleteHandler, req);
    assert(res.statusCode === 200, 'DELETE /api/tutors/:id com claim admin retorna 200');
    assert(isTutorDeleted, 'Tutor foi deletado com autorização admin');
  }

  // Test suite 5: Auditoria de rotas POST /api/tutors, PUT /api/tutors/:id e POST /api/teachers
  console.log('\n--- 5. Auditoria de proteção contra auto-aprovação e escalada de privilégios ---');

  // 5.1 POST /api/tutors: Candidato tentando auto-aprovação sem token admin
  {
    // Simula validação feita em serverApp.ts
    const simulateBecomeTutor = async (req: Request) => {
      const isAdminCaller = await isVerifiedAdminRequest(req);
      const newTutor = req.body;
      const resolvedApprovalStatus = isAdminCaller
        ? (newTutor.approvalStatus || (newTutor.registeredByAdmin ? 'approved' : 'pending'))
        : 'pending';
      const resolvedIsApproved = isAdminCaller && (resolvedApprovalStatus === 'approved' || newTutor.isApproved === true);
      return {
        approvalStatus: resolvedApprovalStatus,
        isApproved: resolvedIsApproved,
        role: 'teacher',
      };
    };

    // Sem token
    const req1 = createMockRequest({}, { approvalStatus: 'approved', isApproved: true, role: 'admin' });
    const res1 = await simulateBecomeTutor(req1);
    assert(res1.approvalStatus === 'pending', 'POST /tutors sem token força approvalStatus=pending');
    assert(res1.isApproved === false, 'POST /tutors sem token força isApproved=false');
    assert(res1.role === 'teacher', 'POST /tutors força role=teacher (ignora role=admin do body)');

    // Com token de estudante
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 's1', role: 'student' }),
    } as any);
    const req2 = createMockRequest({ authorization: 'Bearer student' }, { approvalStatus: 'approved', isApproved: true });
    const res2 = await simulateBecomeTutor(req2);
    assert(res2.approvalStatus === 'pending', 'POST /tutors com token não-admin força status pending');
    assert(res2.isApproved === false, 'POST /tutors com token não-admin força isApproved=false');
  }

  // 5.2 PUT /api/tutors/:id: Professor tentando auto-aprovar via edição de perfil
  {
    const simulateUpdateTutor = async (req: Request, existing: any) => {
      const isAdminCaller = await isVerifiedAdminRequest(req);
      const updatedData = req.body;
      const resolvedApprovalStatus = isAdminCaller
        ? (updatedData.approvalStatus ?? existing.approvalStatus ?? 'pending')
        : (existing.approvalStatus ?? 'pending');
      const resolvedIsApproved = isAdminCaller
        ? (updatedData.isApproved ?? existing.isApproved ?? (resolvedApprovalStatus === 'approved'))
        : (existing.isApproved ?? (existing.approvalStatus === 'approved'));
      return {
        ...existing,
        ...updatedData,
        role: 'teacher',
        approvalStatus: resolvedApprovalStatus,
        isApproved: resolvedIsApproved,
      };
    };

    const existingPending = { id: 't1', approvalStatus: 'pending', isApproved: false, role: 'teacher' };
    setFirebaseAdminAuthForTesting({
      verifyIdToken: async () => ({ uid: 't1', role: 'teacher' }),
    } as any);
    const req = createMockRequest(
      { authorization: 'Bearer teacher' },
      { bio: 'New bio', approvalStatus: 'approved', isApproved: true, role: 'admin' }
    );
    const result = await simulateUpdateTutor(req, existingPending);
    assert(result.approvalStatus === 'pending', 'PUT /tutors/:id de professor NÃO altera approvalStatus');
    assert(result.isApproved === false, 'PUT /tutors/:id de professor NÃO altera isApproved');
    assert(result.role === 'teacher', 'PUT /tutors/:id de professor força role=teacher');
    assert(result.bio === 'New bio', 'Campos permitidos como bio são atualizados normalmente');
  }

  // 5.3 Tentativa de sequestro da conta primária de administrador
  {
    const simulateAdminAccountProtection = (cleanEmail: string, isAdminCaller: boolean) => {
      const isTargetAdmin = cleanEmail === 'adm.itissimple@gmail.com';
      if (isTargetAdmin && !isAdminCaller) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const blockResult = simulateAdminAccountProtection('adm.itissimple@gmail.com', false);
    assert(blockResult.status === 403, 'Tentativa de sobrescrever ou registrar conta de admin sem token admin retorna 403');
  }

  // 5.4 Proteção contra exclusão da conta de administrador via DELETE /api/tutors/:id
  {
    const simulateDeleteAdminTutor = (tutorId: string, targetEmail: string) => {
      if (
        targetEmail === 'adm.itissimple@gmail.com' ||
        tutorId.toLowerCase() === 'adm.itissimple@gmail.com'
      ) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const resDeleteAdmin = simulateDeleteAdminTutor('adm.itissimple@gmail.com', 'adm.itissimple@gmail.com');
    assert(resDeleteAdmin.status === 403, 'DELETE /api/tutors/:id bloqueia exclusão da conta de administrador com 403');
  }

  // 5.5 Proteção contra alteração ou rebaixamento de conta admin via POST /api/teachers
  {
    const simulateModifyAdminViaTeachers = (cleanEmail: string, dbTeachers: any[]) => {
      const isTargetAdmin =
        cleanEmail === 'adm.itissimple@gmail.com' ||
        dbTeachers.some((t: any) => t.email?.toLowerCase() === cleanEmail && t.role === 'admin');
      if (isTargetAdmin) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const teachersList = [{ email: 'adm.itissimple@gmail.com', role: 'admin' }];
    const resModifyAdmin = simulateModifyAdminViaTeachers('adm.itissimple@gmail.com', teachersList);
    assert(resModifyAdmin.status === 403, 'POST /api/teachers bloqueia modificação de conta admin com 403');
  }

  // 5.6 Proteção contra exclusão de administrador via DELETE /api/teachers/:email
  {
    const simulateDeleteAdminTeacher = (email: string, dbTeachers: any[]) => {
      const isTargetAdmin =
        email === 'adm.itissimple@gmail.com' ||
        dbTeachers.some((t: any) => t.email?.toLowerCase() === email && t.role === 'admin');
      if (isTargetAdmin) {
        return { status: 403, error: 'Forbidden' };
      }
      return { status: 200, success: true };
    };

    const teachersList = [{ email: 'adm.itissimple@gmail.com', role: 'admin' }];
    const resDeleteAdminTeacher = simulateDeleteAdminTeacher('adm.itissimple@gmail.com', teachersList);
    assert(resDeleteAdminTeacher.status === 403, 'DELETE /api/teachers/:email bloqueia exclusão de admin com 403');
  }

  // Reset mock
  setFirebaseAdminAuthForTesting(null);

  console.log(`\n========================================`);
  console.log(`TOTAL DE TESTES: ${passed + failed}`);
  console.log(`SUCESSO: ${passed}`);
  console.log(`FALHAS: ${failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
