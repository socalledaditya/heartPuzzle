import mongoose from 'mongoose';

// Immutable-enough record of a played round. Attempts remain keyed by session;
// this document keeps the event details and puzzle set that belong to it.
const eventSchema = new mongoose.Schema({
  session: { type: Number, required: true, unique: true, index: true },
  status: { type: String, enum: ['running', 'paused', 'ended'], required: true },
  durationSec: Number,
  elapsedMs: { type: Number, default: 0 },
  eventName: String,
  collegeName: String,
  eventDate: String,
  signatory: String,
  signatoryTitle: String,
  puzzles: [{ key: String, title: String, image: String, aspect: Number, grid: Number, order: Number, enabled: Boolean }],
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
}, { timestamps: true });

export const Event = mongoose.model('Event', eventSchema);
