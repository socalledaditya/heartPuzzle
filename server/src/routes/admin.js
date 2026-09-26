import { Router } from "express";
import archiver from "archiver";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { User } from "../models/User.js";
import { Puzzle } from "../models/Puzzle.js";
import { Attempt } from "../models/Attempt.js";
import { Event } from "../models/Event.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import {
  getGame,
  publicState,
  transition,
  eventState,
  eventSettings,
  syncCurrentEvent,
} from "../utils/game.js";
import { getRanking, leaderboardPayload } from "../utils/ranking.js";
import { makeCertificate, certId, fmtTime } from "../utils/certificate.js";
import {
  broadcastState,
  kickUser,
  onlineCount,
  scheduleLeaderboard,
} from "../socket.js";

const r = Router();
r.use(requireAuth, requireRole("admin"));
const uploadsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../uploads/puzzles",
);

const settingsOf = (g) => ({
  status: g.status,
  durationSec: g.durationSec,
  session: g.session,
  registrationOpen: g.registrationOpen,
  certsEnabled: g.certsEnabled,
  eventName: g.eventName,
  collegeName: g.collegeName,
  eventDate: g.eventDate,
  signatory: g.signatory,
  signatoryTitle: g.signatoryTitle,
});
const eventOf = (g) => ({
  eventName: g.eventName,
  collegeName: g.collegeName,
  eventDate: g.eventDate,
  signatory: g.signatory,
  signatoryTitle: g.signatoryTitle,
});

r.get("/overview", async (req, res) => {
  const g = await getGame();
  const eventId = req.query.eventId;
  if (eventId) {
    const e = await Event.findById(eventId);
    if (!e) throw new HttpError(404, "Event not found");
    const [ranking, registered] = await Promise.all([
      getRanking(e.session),
      User.countDocuments({ role: "user" }),
    ]);
    const solved = ranking.filter((x) => x.solved > 0);
    const type = (participantType) =>
      solved.filter((x) => x.participantType === participantType).slice(0, 10);
    const totalPuzzles = e.puzzles.filter((p) => p.enabled).length;
    return res.json({
      eventId: String(e._id),
      historical: true,
      settings: eventSettings(e),
      state: eventState(e),
      puzzles: e.puzzles,
      online: 0,
      topStudents: type("student"),
      topFaculty: type("faculty"),
      stats: {
        registered,
        participants: ranking.length,
        finished: ranking.filter(
          (x) => x.solved >= totalPuzzles && totalPuzzles > 0,
        ).length,
        totalPuzzles,
      },
    });
  }
  const [lb, puzzles] = await Promise.all([
    leaderboardPayload(),
    Puzzle.find().sort("order"),
  ]);
  res.json({
    eventId: null,
    historical: false,
    settings: settingsOf(g),
    state: publicState(g),
    puzzles,
    online: onlineCount(),
    ...lb,
  });
});

r.get("/events", async (req, res) => {
  const events = await Event.find().sort("-startedAt").limit(100);
  res.json(
    events.map((e) => ({
      id: e._id,
      session: e.session,
      status: e.status,
      eventName: e.eventName,
      eventDate: e.eventDate,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
    })),
  );
});

r.delete("/events/:id", async (req, res) => {
  const e = await Event.findById(req.params.id);
  if (!e) throw new HttpError(404, "Event not found");
  const g = await getGame();
  if (e.session === g.session)
    throw new HttpError(409, "Reset before deleting the current event");
  await Promise.all([
    Attempt.deleteMany({ session: e.session }),
    e.deleteOne(),
  ]);
  res.json({ ok: true });
});

// --- real-time game control -------------------------------------------------
r.post("/game/:action", async (req, res) => {
  const g = await transition(req.params.action);
  await broadcastState();
  scheduleLeaderboard();
  res.json(publicState(g));
});

const settingsSchema = z
  .object({
    durationSec: z
      .number()
      .int()
      .min(30)
      .max(6 * 3600),
    registrationOpen: z.boolean(),
    certsEnabled: z.boolean(),
    eventName: z.string().trim().min(1).max(120),
    collegeName: z.string().trim().max(160),
    eventDate: z.string().trim().max(40),
    signatory: z.string().trim().max(80),
    signatoryTitle: z.string().trim().max(80),
  })
  .partial();

r.put("/settings", async (req, res) => {
  const g = await getGame();
  Object.assign(g, settingsSchema.parse(req.body));
  await g.save();
  await syncCurrentEvent(g);
  await broadcastState();
  res.json(settingsOf(g));
});

// --- players ----------------------------------------------------------------
r.get("/users", async (req, res) => {
  const g = await getGame();
  const eventId = req.query.eventId;
  const selected = eventId ? await Event.findById(eventId) : null;
  if (eventId && !selected) throw new HttpError(404, "Event not found");
  const session = selected?.session ?? g.session;
  const search = String(req.query.search || "").trim();
  const q = { role: "user" };
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    q.$or = [{ name: rx }, { email: rx }, { rollNo: rx }];
  }
  const [users, ranking] = await Promise.all([
    User.find(q).sort("-createdAt").limit(500),
    getRanking(session),
  ]);
  const byId = new Map(ranking.map((x) => [String(x.userId), x]));
  res.json(
    users.map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      rollNo: u.rollNo,
      participantType: u.participantType,
      banned: u.banned,
      solved: byId.get(String(u._id))?.solved || 0,
      totalMs: byId.get(String(u._id))?.totalMs || 0,
      rank: byId.get(String(u._id))?.rank || null,
    })),
  );
});

r.post("/users/:id/ban", async (req, res) => {
  const { banned } = z.object({ banned: z.boolean() }).parse(req.body);
  const u = await User.findOne({ _id: req.params.id, role: "user" });
  if (!u) throw new HttpError(404, "User not found");
  u.banned = banned;
  u.tokenVersion += 1; // kills all their tokens instantly
  await u.save();
  if (banned) kickUser(u._id);
  res.json({ ok: true });
});

r.delete("/users/:id", async (req, res) => {
  const u = await User.findOne({ _id: req.params.id, role: "user" });
  if (!u) throw new HttpError(404, "User not found");
  kickUser(u._id);
  await Promise.all([Attempt.deleteMany({ user: u._id }), u.deleteOne()]);
  res.json({ ok: true });
});

// --- puzzles ------------------------------------------------------------------
const puzzleSchema = z
  .object({
    title: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    grid: z.number().int().min(2).max(6).optional(),
    order: z.number().int().min(1).max(9999).optional(),
    imageData: z.string().max(7_000_000).optional(),
  })
  .strict();

async function savePuzzleImage(dataUrl) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl || "",
    );
  if (!match) throw new HttpError(400, "Upload a PNG, JPEG, or WebP image");
  const body = Buffer.from(match[2], "base64");
  if (!body.length || body.length > 5 * 1024 * 1024)
    throw new HttpError(400, "Image must be no larger than 5 MB");
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
    match[1]
  ];
  await fs.mkdir(uploadsDir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(uploadsDir, name), body, { flag: "wx" });
  return `/uploads/puzzles/${name}`;
}

r.post("/puzzles", async (req, res) => {
  const d = puzzleSchema.parse(req.body);
  if (!d.title || !d.imageData)
    throw new HttpError(400, "Puzzle title and image are required");
  const g = await getGame();
  if (g.status !== "idle")
    throw new HttpError(409, "Add puzzles before starting a game");
  const image = await savePuzzleImage(d.imageData);
  const last = await Puzzle.findOne().sort("-order").select("order");
  const p = await Puzzle.create({
    key: `custom-${crypto.randomUUID()}`,
    title: d.title,
    image,
    grid: d.grid ?? 3,
    enabled: d.enabled ?? true,
    order: d.order ?? (last?.order || 0) + 1,
  });
  res.status(201).json(p);
});

r.put("/puzzles/:id", async (req, res) => {
  const d = puzzleSchema.parse(req.body);
  const { imageData, ...patch } = d;
  const existing = await Puzzle.findById(req.params.id);
  if (!existing) throw new HttpError(404, "Puzzle not found");
  if (imageData) patch.image = await savePuzzleImage(imageData);
  if (!Object.keys(patch).length)
    throw new HttpError(400, "No puzzle changes supplied");
  const p = await Puzzle.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (imageData && existing.image.startsWith("/uploads/puzzles/"))
    await fs
      .unlink(path.join(uploadsDir, path.basename(existing.image)))
      .catch(() => {});
  const g = await getGame();
  if (g.status !== "idle") {
    const changes = {};
    for (const field of ["title", "image", "enabled", "grid", "order"])
      if (field in patch) changes[`puzzles.$.${field}`] = p[field];
    if (Object.keys(changes).length)
      await Event.updateOne(
        { session: g.session, "puzzles.key": p.key },
        { $set: changes },
      );
  }
  res.json(p);
});

r.delete("/puzzles/:id", async (req, res) => {
  const g = await getGame();
  if (g.status !== "idle")
    throw new HttpError(409, "Reset before deleting a puzzle");
  const p = await Puzzle.findByIdAndDelete(req.params.id);
  if (!p) throw new HttpError(404, "Puzzle not found");
  if (p.image.startsWith("/uploads/puzzles/"))
    await fs
      .unlink(path.join(uploadsDir, path.basename(p.image)))
      .catch(() => {});
  res.json({ ok: true });
});

// --- results & certificates ---------------------------------------------------
r.get("/export.csv", async (req, res) => {
  const g = await getGame();
  const e = req.query.eventId ? await Event.findById(req.query.eventId) : null;
  if (req.query.eventId && !e) throw new HttpError(404, "Event not found");
  const rows = await getRanking(e?.session ?? g.session);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["Rank,Name,Type,Roll No,Email,Puzzles Solved,Total Time"].concat(
    rows.map((x) =>
      [
        x.rank ?? "",
        x.name,
        x.participantType,
        x.rollNo || "",
        x.email,
        x.solved,
        x.solved ? fmtTime(x.totalMs) : "",
      ]
        .map(esc)
        .join(","),
    ),
  );
  res.type("text/csv").attachment("results.csv").send(csv.join("\n"));
});

r.get("/certificates.zip", async (req, res) => {
  const g = await getGame();
  const e = req.query.eventId ? await Event.findById(req.query.eventId) : null;
  if (req.query.eventId && !e) throw new HttpError(404, "Event not found");
  const session = e?.session ?? g.session;
  const event = e ? eventOf(e) : eventOf(g);
  const [ranking, totalPuzzles] = await Promise.all([
    getRanking(session),
    e
      ? Promise.resolve(e.puzzles.filter((p) => p.enabled).length)
      : Puzzle.countDocuments({ enabled: true }),
  ]);
  if (!ranking.length) throw new HttpError(404, "No participants yet");
  res.attachment("certificates.zip");
  const zip = archiver("zip", { zlib: { level: 6 } });
  zip.on("error", (e) => {
    console.error(e);
    res.destroy(e);
  });
  zip.pipe(res);
  for (const p of ranking) {
    const pdf = await makeCertificate({
      name: p.name,
      rollNo: p.rollNo,
      participantType: p.participantType,
      rank: p.rank && p.rank <= 3 ? p.rank : 0,
      solved: p.solved,
      totalPuzzles,
      totalMs: p.totalMs,
      certId: certId(session, p.userId),
      event,
    });
    const prefix = p.rank && p.rank <= 3 ? `TOP${p.rank}` : "PARTICIPANT";
    zip.append(pdf, {
      name: `${prefix}_${p.rollNo || "FACULTY"}_${p.name.replace(/[^\w]+/g, "_")}.pdf`,
    });
  }
  await zip.finalize();
});

r.get("/certificates/sample.pdf", async (req, res) => {
  const g = await getGame();
  const rank = Math.min(3, Math.max(0, Number(req.query.rank) || 0));
  const isFaculty = req.query.type === "faculty";
  const pdf = await makeCertificate({
    name: isFaculty ? "Dr. Sample Faculty Name" : "Sample Student Name",
    rollNo: isFaculty ? undefined : "BSC-CARD-001",
    participantType: isFaculty ? "faculty" : "student",
    rank,
    solved: 5,
    totalPuzzles: 5,
    totalMs: 372000,
    certId: "SAMPLE",
    event: eventOf(g),
  });
  res.type("application/pdf").send(pdf);
});

export default r;
