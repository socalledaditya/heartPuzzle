import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { config } from '../config.js';
import { getGame } from '../utils/game.js';
import { signAccess, signRefresh, verifyRefresh, setRefreshCookie, clearRefreshCookie } from '../utils/tokens.js';
import { HttpError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();
// Generous on purpose: a whole classroom shares one college Wi-Fi IP.
r.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false }));

const email = z.string().trim().toLowerCase().email();
const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, rollNo: u.rollNo, participantType: u.participantType, role: u.role });

function startSession(res, user) {
  setRefreshCookie(res, signRefresh(user));
  return { accessToken: signAccess(user), user: publicUser(user) };
}

// Student and faculty use different shapes of the same form: only a student
// needs (and may supply) a roll/enrolment number.
const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email,
    password: z.string().min(8).max(100),
    participantType: z.enum(['student', 'faculty']),
    rollNo: z.string().trim().max(30).optional().default(''),
  })
  .superRefine((d, ctx) => {
    if (d.participantType === 'student' && d.rollNo.trim().length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rollNo'], message: 'Roll / enrolment number is required for students' });
    }
  });

r.post('/register', async (req, res) => {
  const d = registerSchema.parse(req.body);
  const g = await getGame();
  if (!g.registrationOpen) throw new HttpError(403, 'Registration is closed');
  if (config.allowedDomains.length && !config.allowedDomains.includes(d.email.split('@')[1]))
    throw new HttpError(400, `Please use your college email (${config.allowedDomains.map((x) => '@' + x).join(', ')})`);

  if (await User.findOne({ email: d.email })) throw new HttpError(409, 'This email is already registered. Please log in.');

  const rollNo = d.participantType === 'student' ? d.rollNo.trim().toUpperCase() : undefined;
  if (rollNo && (await User.findOne({ rollNo }))) throw new HttpError(409, 'This roll number is already registered');

  const user = await User.create({
    name: d.name,
    email: d.email,
    participantType: d.participantType,
    rollNo,
    passwordHash: await bcrypt.hash(d.password, 10),
  });
  res.status(201).json(startSession(res, user));
});

r.post('/login', async (req, res) => {
  const { email: mail, password } = z.object({ email, password: z.string().min(1) }).parse(req.body);
  const user = await User.findOne({ email: mail }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, 'Invalid email or password');
  if (user.banned) throw new HttpError(403, 'Your account has been disabled by the organisers');
  res.json(startSession(res, user));
});

r.post('/refresh', async (req, res) => {
  try {
    const p = verifyRefresh(req.cookies?.rt);
    const user = await User.findById(p.sub);
    if (!user || user.tokenVersion !== p.tv || user.banned) throw new Error('invalid');
    return res.json(startSession(res, user));
  } catch {
    clearRefreshCookie(res);
    throw new HttpError(401, 'Session expired');
  }
});

r.post('/logout', (req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export default r;
