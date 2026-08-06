import { Router } from 'express';
import {
  authEnabled,
  clearFailures,
  endSession,
  isAuthenticated,
  loginBlockedMs,
  passwordMatches,
  registerFailure,
  startSession,
} from '../services/auth.js';

export const authRouter = Router();

/** GET /api/auth/status — si hay login y si la sesión está abierta. */
authRouter.get('/status', (req, res) => {
  res.json({ enabled: authEnabled(), authenticated: isAuthenticated(req) });
});

/** POST /api/auth/login — { password } → cookie de sesión. */
authRouter.post('/login', (req, res) => {
  if (!authEnabled()) {
    res.json({ ok: true, note: 'Esta instalación no tiene login configurado.' });
    return;
  }

  const blocked = loginBlockedMs(req);
  if (blocked > 0) {
    res.status(429).json({
      error: `Demasiados intentos fallidos. Prueba de nuevo en ${Math.ceil(blocked / 1000)} s.`,
    });
    return;
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!passwordMatches(password)) {
    registerFailure(req);
    res.status(401).json({ error: 'Contraseña incorrecta.' });
    return;
  }

  clearFailures(req);
  startSession(req, res);
  res.json({ ok: true });
});

/** POST /api/auth/logout — cierra la sesión y caduca los tokens emitidos. */
authRouter.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});
