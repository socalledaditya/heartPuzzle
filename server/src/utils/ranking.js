import { Attempt } from "../models/Attempt.js";
import { Puzzle } from "../models/Puzzle.js";
import { User } from "../models/User.js";
import { getGame } from "./game.js";

// Rank = most puzzles solved, then lowest total time (game-clock at last solve).
export async function getRanking(session) {
  const rows = await Attempt.aggregate([
    { $match: { session } },
    {
      $group: {
        _id: "$user",
        solved: { $sum: { $cond: ["$solved", 1, 0] } },
        totalMs: { $max: { $cond: ["$solved", "$solvedClock", 0] } },
        swaps: { $sum: "$swapCount" },
      },
    },
    { $sort: { solved: -1, totalMs: 1, _id: 1 } },
    {
      $lookup: {
        from: User.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "u",
      },
    },
    { $unwind: "$u" },
    { $match: { "u.banned": false } },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        name: "$u.name",
        email: "$u.email",
        rollNo: "$u.rollNo",
        participantType: "$u.participantType",
        solved: 1,
        totalMs: 1,
        swaps: 1,
      },
    },
  ]);
  // A student's place must never be affected by faculty results (and vice versa).
  const positions = { student: 0, faculty: 0 };
  return rows.map((r) => ({
    ...r,
    rank: r.solved > 0 ? ++positions[r.participantType] : null,
  }));
}
export async function leaderboardPayload() {
  const g = await getGame();
  const [ranking, totalPuzzles, registered] = await Promise.all([
    getRanking(g.session),
    Puzzle.countDocuments({ enabled: true }),
    User.countDocuments({ role: "user" }),
  ]);
  // Re-rank within each participant type so "Student #1" and "Faculty #1"
  // are each the best of their own category, not the combined field.
  const byType = (type) =>
    ranking
      .filter((r) => r.participantType === type && r.solved > 0)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    topStudents: byType("student").slice(0, 10),
    topFaculty: byType("faculty").slice(0, 10),
    stats: {
      registered,
      participants: ranking.length,
      finished: ranking.filter(
        (r) => r.solved >= totalPuzzles && totalPuzzles > 0,
      ).length,
      totalPuzzles,
    },
  };
}
