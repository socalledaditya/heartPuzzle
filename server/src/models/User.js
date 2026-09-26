import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    // Only meaningful for role "user": which registration form they used.
    participantType: { type: String, enum: ['student', 'faculty'] },
    // Required for students, absent for faculty/admin. Sparse index lets many
    // documents omit it without colliding on a shared "null" value.
    rollNo: { type: String, trim: true, uppercase: true },
    passwordHash: { type: String, required: true, select: false },
    banned: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 }, // bump to invalidate every issued token
  },
  { timestamps: true }
);

// Database-level guarantee: there can only ever be ONE admin.
userSchema.index({ role: 1 }, { unique: true, partialFilterExpression: { role: 'admin' } });
// Unique only among documents that actually have a rollNo (students).
userSchema.index({ rollNo: 1 }, { unique: true, sparse: true });

export const User = mongoose.model('User', userSchema);
