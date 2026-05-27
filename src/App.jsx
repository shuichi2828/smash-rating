import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Users, Plus, History, RotateCcw, Sword, BarChart3, Trash2, Swords, Medal, ChevronRight, Cloud } from "lucide-react";
import { supabase } from "./lib/supabase";

// Smash Rating App MVP
// - Supabase synced version
// - White/blue visual design
// - Rating unit: Player × Character
// - Modes: 1v1 / 2v2
// - Rules: Single game as main rule, or BO3 as optional rule
// - Elo-based rating: upset wins move a lot, expected wins move a little
// - Losers lose points, but total rating change per match is at least +5

const INITIAL_RATING = 1500;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const MAX_CHARACTERS_PER_PLAYER = 5;
const DAILY_SINGLE_LIMIT = 30;
const DAILY_BO3_LIMIT = 15;
const MIN_TOTAL_CHANGE = 5;
const RATE_INTENSITY_MULTIPLIER = 2.1;
const RATE_GLOBAL_MULTIPLIER = 1.2;
const WIN_BONUS = 10;
const LOSS_FACTOR = 1.0;
const GIANT_KILLING_RATING_DIFF = 200;
const GIANT_KILLING_BONUS = 30;

const characters = [
  "おまかせ", "マリオ", "ドンキーコング", "リンク", "サムス", "ダークサムス", "ヨッシー", "カービィ", "フォックス",
  "ピカチュウ", "ルイージ", "ネス", "キャプテン・ファルコン", "プリン", "ピーチ", "デイジー", "クッパ",
  "アイスクライマー", "シーク", "ゼルダ", "ドクターマリオ", "ピチュー", "ファルコ", "マルス", "ルキナ",
  "こどもリンク", "ガノンドロフ", "ミュウツー", "ロイ", "クロム", "Mr.ゲーム&ウォッチ", "メタナイト",
  "ピット", "ブラックピット", "ゼロスーツサムス", "ワリオ", "スネーク", "アイク", "ポケモントレーナー",
  "ディディーコング", "リュカ", "ソニック", "デデデ", "ピクミン&オリマー", "ルカリオ", "ロボット",
  "トゥーンリンク", "ウルフ", "むらびと", "ロックマン", "Wii Fit トレーナー", "ロゼッタ&チコ",
  "リトル・マック", "ゲッコウガ", "Mii格闘", "Mii剣術", "Mii射撃", "パルテナ", "パックマン",
  "ルフレ", "シュルク", "クッパJr.", "ダックハント", "リュウ", "ケン", "クラウド", "カムイ",
  "ベヨネッタ", "インクリング", "リドリー", "シモン", "リヒター", "キングクルール", "しずえ",
  "ガオガエン", "パックンフラワー", "ジョーカー", "勇者", "バンジョー&カズーイ", "テリー",
  "ベレト/ベレス", "ミェンミェン", "スティーブ", "セフィロス", "ホムラ/ヒカリ", "カズヤ", "ソラ"
];

function uid() {
  return crypto.randomUUID();
}

function isActivePlayer(player) {
  return !player?.deletedAt;
}

function activePlayersOf(data) {
  return data.players.filter(isActivePlayer);
}

function inferRuleFromMatch(match) {
  if (match.rule) return match.rule;
  return match.scoreA === 1 || match.scoreB === 1 ? "single" : "bo3";
}

function getMatchRuleLabel(rule) {
  return rule === "single" ? "1勝制" : "2勝制";
}

function getDailyLimit(rule) {
  return rule === "single" ? DAILY_SINGLE_LIMIT : DAILY_BO3_LIMIT;
}

function getLocalDateKey(value = new Date()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDailyMatchCountForPlayer(data, playerId, rule) {
  const today = getLocalDateKey();
  return data.matches.filter(match => {
    if (inferRuleFromMatch(match) !== rule) return false;
    if (getLocalDateKey(match.createdAt) !== today) return false;
    return match.members.some(member => member.playerId === playerId);
  }).length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ratingKey(playerId, characterName) {
  return `${playerId}::${characterName}`;
}

function createRating(playerId, characterName) {
  const key = ratingKey(playerId, characterName);
  return {
    id: uid(),
    key,
    playerId,
    characterName,
    rating: INITIAL_RATING,
    matches: 0,
    wins: 0,
    losses: 0,
    winStreak: 0,
    highestRating: INITIAL_RATING
  };
}

function createInitialData() {
  const players = [
    { id: uid(), name: "しゅー", createdAt: new Date().toISOString(), deletedAt: null },
    { id: uid(), name: "友人A", createdAt: new Date().toISOString(), deletedAt: null },
    { id: uid(), name: "友人B", createdAt: new Date().toISOString(), deletedAt: null },
    { id: uid(), name: "友人C", createdAt: new Date().toISOString(), deletedAt: null }
  ];

  const defaultCharacters = ["マリオ", "ルイージ", "クラウド", "サムス"];
  const ratings = players.map((player, index) => createRating(player.id, defaultCharacters[index]));

  return { players, ratings, matches: [] };
}

function emptyData() {
  return { players: [], ratings: [], matches: [] };
}

function appPlayerFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null
  };
}

function appRatingFromDb(row) {
  return {
    id: row.id,
    key: ratingKey(row.player_id, row.character_name),
    playerId: row.player_id,
    characterName: row.character_name,
    rating: row.rating,
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    winStreak: row.win_streak || 0,
    highestRating: row.highest_rating
  };
}

function appMemberFromDb(row) {
  return {
    id: row.id,
    team: row.team,
    playerId: row.player_id,
    characterName: row.character_name,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    ratingChange: row.rating_change,
    won: row.won
  };
}

function appMatchFromDb(row, members) {
  const teamA = members
    .filter(member => member.team === "A")
    .map(member => ({ playerId: member.playerId, characterName: member.characterName }));
  const teamB = members
    .filter(member => member.team === "B")
    .map(member => ({ playerId: member.playerId, characterName: member.characterName }));

  return {
    id: row.id,
    mode: row.mode,
    rule: row.match_rule || (row.score_a === 1 || row.score_b === 1 ? "single" : "bo3"),
    teamA,
    teamB,
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerTeam: row.winner_team,
    members,
    avgA: Number(row.avg_a || 0),
    avgB: Number(row.avg_b || 0),
    createdAt: row.created_at
  };
}

function dbPlayerFromApp(player) {
  return {
    id: player.id,
    name: player.name,
    created_at: player.createdAt || new Date().toISOString(),
    deleted_at: player.deletedAt || null
  };
}

function dbRatingFromApp(rating) {
  return {
    id: rating.id,
    player_id: rating.playerId,
    character_name: rating.characterName,
    rating: rating.rating,
    matches: rating.matches,
    wins: rating.wins,
    losses: rating.losses,
    win_streak: rating.winStreak || 0,
    highest_rating: rating.highestRating
  };
}

function dbMatchFromApp(match) {
  return {
    id: match.id,
    mode: match.mode,
    match_rule: inferRuleFromMatch(match),
    score_a: match.scoreA,
    score_b: match.scoreB,
    winner_team: match.winnerTeam,
    avg_a: match.avgA,
    avg_b: match.avgB,
    created_at: match.createdAt || new Date().toISOString()
  };
}

function dbMemberFromApp(member, matchId) {
  return {
    id: member.id,
    match_id: matchId,
    team: member.team,
    player_id: member.playerId,
    character_name: member.characterName,
    rating_before: member.ratingBefore,
    rating_after: member.ratingAfter,
    rating_change: member.ratingChange,
    won: member.won
  };
}

async function fetchAllDataFromSupabase() {
  const [playersRes, ratingsRes, matchesRes, membersRes] = await Promise.all([
    supabase.from("players").select("*").order("created_at", { ascending: true }),
    supabase.from("character_ratings").select("*").order("rating", { ascending: false }),
    supabase.from("matches").select("*").order("created_at", { ascending: false }),
    supabase.from("match_members").select("*")
  ]);

  const firstError = playersRes.error || ratingsRes.error || matchesRes.error || membersRes.error;
  if (firstError) throw firstError;

  const players = (playersRes.data || []).map(appPlayerFromDb);
  const ratings = (ratingsRes.data || []).map(appRatingFromDb);
  const allMembers = (membersRes.data || []).map(appMemberFromDb);

  const membersByMatch = new Map();
  for (const member of allMembers) {
    const dbRow = membersRes.data.find(row => row.id === member.id);
    const matchId = dbRow?.match_id;
    if (!matchId) continue;
    const list = membersByMatch.get(matchId) || [];
    list.push(member);
    membersByMatch.set(matchId, list);
  }

  const matches = (matchesRes.data || []).map(match => appMatchFromDb(match, membersByMatch.get(match.id) || []));

  return { players, ratings, matches };
}

async function deleteAllRows(tableName) {
  const { error } = await supabase.from(tableName).delete().neq("id", NIL_UUID);
  if (error) throw error;
}

async function insertRows(tableName, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(tableName).insert(rows);
  if (error) throw error;
}

async function syncAllDataToSupabase(data) {
  await deleteAllRows("match_members");
  await deleteAllRows("matches");
  await deleteAllRows("character_ratings");
  await deleteAllRows("players");

  await insertRows("players", data.players.map(dbPlayerFromApp));
  await insertRows("character_ratings", data.ratings.map(dbRatingFromApp));
  await insertRows("matches", data.matches.map(dbMatchFromApp));

  const memberRows = data.matches.flatMap(match => match.members.map(member => dbMemberFromApp(member, match.id)));
  await insertRows("match_members", memberRows);
}

async function deleteSingleMatchFromSupabase(matchId) {
  const { error: membersError } = await supabase
    .from("match_members")
    .delete()
    .eq("match_id", matchId);

  if (membersError) throw membersError;

  const { error: matchError } = await supabase
    .from("matches")
    .delete()
    .eq("id", matchId);

  if (matchError) throw matchError;
}

async function upsertRatingsToSupabase(ratings) {
  if (!ratings.length) return;

  const { error } = await supabase
    .from("character_ratings")
    .upsert(ratings.map(dbRatingFromApp), { onConflict: "id" });

  if (error) throw error;
}


function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getK(matches) {
  if (matches <= 10) return 48;
  if (matches <= 30) return 32;
  return 20;
}

function getTier(rating) {
  if (rating >= 2200) return "SSS";
  if (rating >= 2000) return "SS";
  if (rating >= 1800) return "S";
  if (rating >= 1600) return "A";
  if (rating >= 1400) return "B";
  if (rating >= 1200) return "C";
  if (rating <= 1000) return "E";
  return "D";
}

function getTierStyle(rating) {
  const tier = getTier(rating);
  const styles = {
    SSS: "text-red-600 bg-black border-red-500",
    SS: "text-red-600 bg-red-50 border-red-200",
    S: "text-pink-600 bg-pink-50 border-pink-200",
    A: "text-blue-600 bg-blue-50 border-blue-200",
    B: "text-emerald-600 bg-emerald-50 border-emerald-200",
    C: "text-amber-600 bg-amber-50 border-amber-200",
    D: "text-slate-500 bg-slate-50 border-slate-200",
    E: "text-gray-600 bg-gray-100 border-gray-300"
  };
  return styles[tier];
}

function getTierTextColor(rating) {
  const tier = getTier(rating);
  const styles = {
    SSS: "text-red-700 drop-shadow-[0_1px_1px_rgba(0,0,0,0.95)]",
    SS: "text-red-600",
    S: "text-pink-600",
    A: "text-blue-600",
    B: "text-emerald-600",
    C: "text-amber-600",
    D: "text-slate-500",
    E: "text-gray-500"
  };
  return styles[tier];
}

function getTierBarColor(rating) {
  const tier = getTier(rating);
  const styles = {
    SSS: "bg-gradient-to-r from-black via-red-700 to-black",
    SS: "bg-red-500",
    S: "bg-pink-500",
    A: "bg-blue-500",
    B: "bg-emerald-500",
    C: "bg-amber-500",
    D: "bg-slate-400",
    E: "bg-gray-400"
  };
  return styles[tier];
}

function getWinRateText(wins, matches) {
  if (!matches) return "0.0%";
  return `${((wins / matches) * 100).toFixed(1)}%`;
}

function getStreakBonusMultiplier(streak) {
  if (streak < 3) return 1;
  return Math.min(1.5, 1 + streak * 0.05);
}

function getBestRatingForPlayer(data, playerId) {
  const ratings = data.ratings.filter(r => r.playerId === playerId);
  if (!ratings.length) return INITIAL_RATING;
  return Math.max(...ratings.map(r => r.rating));
}

function NameTag({ name, rating }) {
  const tier = getTier(rating);

  if (tier === "SSS") {
    return (
      <span className="inline-flex items-center rounded-xl border border-black bg-gradient-to-r from-black via-zinc-900 to-black px-3 py-1.5 shadow-md shadow-red-200">
        <span className="font-black tracking-wider italic text-red-600 drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">
          {name}
        </span>
      </span>
    );
  }

  if (tier === "SS") {
    return (
      <span className="inline-flex items-center rounded-xl border border-red-300 bg-gradient-to-r from-red-50 via-white to-rose-50 px-3 py-1.5 shadow-sm">
        <span className="font-black tracking-wider italic text-red-700 drop-shadow-sm">
          {name}
        </span>
      </span>
    );
  }

  if (tier === "S") {
    return (
      <span className="inline-flex items-center rounded-xl border border-pink-300 bg-gradient-to-r from-pink-50 via-white to-fuchsia-50 px-3 py-1.5 shadow-sm">
        <span className="font-black tracking-wider italic text-pink-700 drop-shadow-sm">
          {name}
        </span>
      </span>
    );
  }

  return <span className="font-black text-slate-950">{name}</span>;
}

function TierBadge({ rating, large = false }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full border font-black ${getTierStyle(rating)} ${large ? "px-3 py-1 text-sm" : "px-2.5 py-1 text-xs"}`}>
      {getTier(rating)}
    </span>
  );
}

function formatChange(change) {
  return `${change >= 0 ? "+" : ""}${change}`;
}

function ChangeBadge({ change }) {
  return (
    <span className={`${change >= 0 ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-red-600 bg-red-50 border-red-200"} inline-flex min-w-16 items-center justify-center rounded-full border px-3 py-1 text-sm font-black`}>
      {formatChange(change)}
    </span>
  );
}

function scoreMultiplier(scoreWinner, scoreLoser) {
  if (scoreWinner === 2 && scoreLoser === 0) return 1.1;
  return 1.0;
}

function getGiantKillingResult({ mode, fullA, fullB, winnerTeam }) {
  if (mode !== "1v1" || fullA.length !== 1 || fullB.length !== 1) return null;

  const a = fullA[0];
  const b = fullB[0];
  const ratingA = a.ratingRecord.rating;
  const ratingB = b.ratingRecord.rating;
  const ratingDiff = Math.abs(ratingA - ratingB);

  if (ratingDiff < GIANT_KILLING_RATING_DIFF || ratingA === ratingB) return null;

  const lowerTeam = ratingA < ratingB ? "A" : "B";
  if (winnerTeam !== lowerTeam) return null;

  const winner = lowerTeam === "A" ? a : b;
  const loser = lowerTeam === "A" ? b : a;

  return {
    message: "ジャイアントキリング！",
    bonus: GIANT_KILLING_BONUS,
    ratingDiff: Math.round(ratingDiff),
    winnerTeam: lowerTeam,
    winnerPlayerId: winner.playerId,
    winnerCharacterName: winner.characterName,
    loserPlayerId: loser.playerId,
    loserCharacterName: loser.characterName
  };
}

function getGiantKillingFromMatch(match) {
  if (match.giantKilling) return match.giantKilling;
  if (match.mode !== "1v1" || !match.members?.length) return null;

  const a = match.members.find(member => member.team === "A");
  const b = match.members.find(member => member.team === "B");
  if (!a || !b) return null;

  const ratingDiff = Math.abs(a.ratingBefore - b.ratingBefore);
  if (ratingDiff < GIANT_KILLING_RATING_DIFF || a.ratingBefore === b.ratingBefore) return null;

  const lowerTeam = a.ratingBefore < b.ratingBefore ? "A" : "B";
  if (match.winnerTeam !== lowerTeam) return null;

  const winner = lowerTeam === "A" ? a : b;
  const loser = lowerTeam === "A" ? b : a;

  return {
    message: "ジャイアントキリング！",
    bonus: GIANT_KILLING_BONUS,
    ratingDiff: Math.round(ratingDiff),
    winnerTeam: lowerTeam,
    winnerPlayerId: winner.playerId,
    winnerCharacterName: winner.characterName,
    loserPlayerId: loser.playerId,
    loserCharacterName: loser.characterName
  };
}


function getOrCreateRating(ratings, playerId, characterName) {
  const key = ratingKey(playerId, characterName);
  const existing = ratings.find(r => r.key === key);
  if (existing) return existing;
  return createRating(playerId, characterName);
}

function getRatingForMember(data, member) {
  if (!member?.playerId || !member?.characterName) return null;
  return data.ratings.find(r => r.key === ratingKey(member.playerId, member.characterName)) || null;
}

function getUniqueDefaultMembers(registeredSets) {
  const seen = new Set();
  return registeredSets
    .filter(rating => {
      if (!rating.playerId || seen.has(rating.playerId)) return false;
      seen.add(rating.playerId);
      return true;
    })
    .map(rating => ({ playerId: rating.playerId, characterName: rating.characterName }));
}

function normalizeMember(member, fallbackMember, registeredSets) {
  const exact = registeredSets.find(
    rating => rating.key === ratingKey(member?.playerId, member?.characterName)
  );

  if (exact) {
    return { playerId: exact.playerId, characterName: exact.characterName };
  }

  if (member?.playerId) {
    const firstForPlayer = registeredSets.find(rating => rating.playerId === member.playerId);
    if (firstForPlayer) {
      return { playerId: firstForPlayer.playerId, characterName: firstForPlayer.characterName };
    }
  }

  return fallbackMember || { playerId: "", characterName: "" };
}

function roundChange(value) {
  return Math.round(value);
}

function calculateMatch({ data, mode, rule = "single", teamA, teamB, winnerTeam, scoreA, scoreB }) {
  const ratingsMap = new Map(data.ratings.map(r => [r.key, { ...r }]));

  const fullA = teamA.map(m => {
    const r = getRatingForMember(data, m);
    if (!r) {
      throw new Error("Team Aに未登録のプレイヤー・キャラがあります。選手とキャラを選び直してください。");
    }
    ratingsMap.set(r.key, { ...r });
    return { ...m, ratingRecord: { ...r } };
  });

  const fullB = teamB.map(m => {
    const r = getRatingForMember(data, m);
    if (!r) {
      throw new Error("Team Bに未登録のプレイヤー・キャラがあります。選手とキャラを選び直してください。");
    }
    ratingsMap.set(r.key, { ...r });
    return { ...m, ratingRecord: { ...r } };
  });

  const avgA = fullA.reduce((sum, m) => sum + m.ratingRecord.rating, 0) / fullA.length;
  const avgB = fullB.reduce((sum, m) => sum + m.ratingRecord.rating, 0) / fullB.length;
  const matchAverage = [...fullA, ...fullB].reduce((sum, m) => sum + m.ratingRecord.rating, 0) / (fullA.length + fullB.length);
  const expA = expectedScore(avgA, avgB);
  const expB = expectedScore(avgB, avgA);

  const aWon = winnerTeam === "A";
  const mult = scoreMultiplier(aWon ? scoreA : scoreB, aWon ? scoreB : scoreA);
  const rawMembers = [];
  const ruleFactor = rule === "single" ? 0.5 : 1;
  const maxAbsChange = mode === "2v2" ? 50 : 100;

  const isGachiMatch =
    mode === "1v1" &&
    fullA[0]?.ratingRecord.rating > 1700 &&
    fullB[0]?.ratingRecord.rating > 1700;

  const gachiFactor = isGachiMatch ? 1.2 : 1;
  const lowAverageFactor = matchAverage <= 1500 ? 1.1 : 1;

  function apply(member, team, won, expected) {
    const before = member.ratingRecord.rating;
    const currentStreak = member.ratingRecord.winStreak || 0;
    const nextStreak = won ? currentStreak + 1 : 0;
    const k = getK(member.ratingRecord.matches);
    const baseAbs = Math.abs(k * ((won ? 1 : 0) - expected) * mult);

    let change;

    if (won) {
      const streakBonus = getStreakBonusMultiplier(nextStreak);
      change = roundChange(
        (baseAbs * RATE_INTENSITY_MULTIPLIER + WIN_BONUS) *
          ruleFactor *
          gachiFactor *
          lowAverageFactor *
          streakBonus *
          RATE_GLOBAL_MULTIPLIER
      );
      change = Math.max(1, change);
    } else {
      change = -roundChange(
        baseAbs *
          RATE_INTENSITY_MULTIPLIER *
          LOSS_FACTOR *
          ruleFactor *
          gachiFactor *
          lowAverageFactor *
          RATE_GLOBAL_MULTIPLIER
      );
      change = Math.min(-1, change);
    }

    change = clamp(change, -maxAbsChange, maxAbsChange);

    rawMembers.push({
      id: uid(),
      team,
      playerId: member.playerId,
      characterName: member.characterName,
      ratingBefore: before,
      ratingChange: change,
      winStreakBefore: currentStreak,
      winStreakAfter: nextStreak,
      won
    });
  }

  fullA.forEach(m => apply(m, "A", aWon, expA));
  fullB.forEach(m => apply(m, "B", !aWon, expB));

  let totalChange = rawMembers.reduce((sum, member) => sum + member.ratingChange, 0);

  if (totalChange < MIN_TOTAL_CHANGE) {
    let needed = MIN_TOTAL_CHANGE - totalChange;
    const winners = rawMembers.filter(member => member.won);
    const losers = rawMembers.filter(member => !member.won);
    let guard = 0;

    while (needed > 0 && guard < 10000) {
      let changed = false;

      for (const winner of winners) {
        if (needed <= 0) break;
        if (winner.ratingChange < maxAbsChange) {
          winner.ratingChange += 1;
          needed -= 1;
          changed = true;
        }
      }

      for (const loser of losers) {
        if (needed <= 0) break;
        if (loser.ratingChange < -1) {
          loser.ratingChange += 1;
          needed -= 1;
          changed = true;
        }
      }

      if (!changed) break;
      guard += 1;
    }
  }

  const giantKilling = getGiantKillingResult({ mode, fullA, fullB, winnerTeam });

  if (giantKilling) {
    for (const member of rawMembers) {
      if (member.playerId === giantKilling.winnerPlayerId && member.characterName === giantKilling.winnerCharacterName) {
        member.ratingChange += GIANT_KILLING_BONUS;
      }

      if (member.playerId === giantKilling.loserPlayerId && member.characterName === giantKilling.loserCharacterName) {
        member.ratingChange -= GIANT_KILLING_BONUS;
      }
    }
  }

  const members = rawMembers.map(member => ({
    ...member,
    ratingAfter: member.ratingBefore + member.ratingChange
  }));

  return { avgA, avgB, expectedA: expA, expectedB: expB, isGachiMatch, lowAverageBonus: lowAverageFactor > 1, giantKilling, members };
}

function applyMatch(data, form) {
  const calculation = calculateMatch({ data, ...form });
  const newRatings = new Map(data.ratings.map(r => [r.key, { ...r }]));

  for (const member of calculation.members) {
    const key = ratingKey(member.playerId, member.characterName);
    const current = newRatings.get(key);
    if (!current) {
      throw new Error("登録済みレートが見つかりません。選手とキャラを選び直してください。");
    }
    const updated = {
      ...current,
      rating: member.ratingAfter,
      matches: current.matches + 1,
      wins: current.wins + (member.won ? 1 : 0),
      losses: current.losses + (member.won ? 0 : 1),
      winStreak: member.winStreakAfter,
      highestRating: Math.max(current.highestRating, member.ratingAfter)
    };
    newRatings.set(key, updated);
  }

  const match = {
    id: uid(),
    mode: form.mode,
    rule: form.rule || "single",
    teamA: form.teamA,
    teamB: form.teamB,
    scoreA: form.scoreA,
    scoreB: form.scoreB,
    winnerTeam: form.winnerTeam,
    isGachiMatch: calculation.isGachiMatch,
    lowAverageBonus: calculation.lowAverageBonus,
    giantKilling: calculation.giantKilling,
    members: calculation.members,
    avgA: calculation.avgA,
    avgB: calculation.avgB,
    createdAt: new Date().toISOString()
  };

  return { ...data, ratings: Array.from(newRatings.values()), matches: [match, ...data.matches] };
}

function resetRatingStats(rating) {
  return {
    ...rating,
    rating: INITIAL_RATING,
    matches: 0,
    wins: 0,
    losses: 0,
    winStreak: 0,
    highestRating: INITIAL_RATING
  };
}

function rebuildDataWithMatches(data, matchesNewestFirst) {
  const rebuilt = {
    ...data,
    ratings: data.ratings.map(resetRatingStats),
    matches: []
  };

  const chronological = [...matchesNewestFirst].reverse();

  for (const oldMatch of chronological) {
    const form = {
      mode: oldMatch.mode,
      rule: inferRuleFromMatch(oldMatch),
      teamA: oldMatch.teamA,
      teamB: oldMatch.teamB,
      scoreA: oldMatch.scoreA,
      scoreB: oldMatch.scoreB,
      winnerTeam: oldMatch.winnerTeam
    };

    const next = applyMatch(rebuilt, form);
    const recalculatedMatch = {
      ...next.matches[0],
      id: oldMatch.id,
      rule: inferRuleFromMatch(oldMatch),
      createdAt: oldMatch.createdAt
    };

    rebuilt.ratings = next.ratings;
    rebuilt.matches = [recalculatedMatch, ...rebuilt.matches];
  }

  return rebuilt;
}

function deleteMatch(data, matchId) {
  const target = data.matches.find(match => match.id === matchId);
  if (!target) return data;
  const remainingMatches = data.matches.filter(match => match.id !== matchId);
  return rebuildDataWithMatches(data, remainingMatches);
}

function undoLatestMatch(data) {
  const latest = data.matches[0];
  if (!latest) return data;
  return deleteMatch(data, latest.id);
}

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

function PlayerName({ players, id }) {
  const player = players.find(p => p.id === id);
  return <span>{player?.name || "不明"}</span>;
}

function SetLabel({ data, rating }) {
  const player = data.players.find(p => p.id === rating.playerId);
  const streak = rating.winStreak || 0;

  return (
    <div className="min-w-0">
      {streak > 0 && (
        <div className="mb-1 inline-flex rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-black text-orange-600">
          🔥 {streak}連勝中
        </div>
      )}
      <div className="truncate text-base">
        <NameTag name={player?.name || "不明"} rating={rating.rating} />
      </div>
      <div className="truncate text-sm font-semibold text-blue-700">{rating.characterName}</div>
    </div>
  );
}

function AppShellCard({ children, className = "" }) {
  return <section className={`rounded-3xl border border-blue-100 bg-white p-5 shadow-sm shadow-blue-100/70 ${className}`}>{children}</section>;
}

export default function App() {
  const [data, setData] = useState(emptyData());
  const [tab, setTab] = useState("match");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [setPlayerId, setSetPlayerId] = useState("");
  const [setCharacterName, setSetCharacterName] = useState("マリオ");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function refreshData() {
    setLoading(true);
    setErrorMessage("");
    try {
      let next = await fetchAllDataFromSupabase();
      if (next.players.length === 0) {
        next = createInitialData();
        await syncAllDataToSupabase(next);
      }
      setData(next);
      setSetPlayerId(current => current || activePlayersOf(next)[0]?.id || "");
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "Supabaseからデータを読み込めませんでした。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshData();
  }, []);

  async function commit(next) {
    setSaving(true);
    setErrorMessage("");
    setData(next);
    try {
      await syncAllDataToSupabase(next);
    } catch (error) {
      console.error(error);
      setErrorMessage(error.message || "Supabaseへの保存に失敗しました。");
      await refreshData();
    } finally {
      setSaving(false);
    }
  }

  async function deleteMatchOnly(matchId) {
    setSaving(true);
    setErrorMessage("");

    const before = data;
    const next = deleteMatch(data, matchId);

    setData(next);

    try {
      await deleteSingleMatchFromSupabase(matchId);
      await upsertRatingsToSupabase(next.ratings);
    } catch (error) {
      console.error(error);
      setData(before);
      setErrorMessage(error.message || "試合の取り消しに失敗しました。");
      await refreshData();
    } finally {
      setSaving(false);
    }
  }


  async function addPlayer() {
    const name = newPlayerName.trim();
    if (!name) return;
    if (data.players.some(p => p.name === name && isActivePlayer(p))) return alert("同じ名前のプレイヤーがいます。別名にしてください。");
    const player = { id: uid(), name, createdAt: new Date().toISOString(), deletedAt: null };
    const next = { ...data, players: [...data.players, player] };
    await commit(next);
    setSetPlayerId(player.id);
    setNewPlayerName("");
  }

  async function deletePlayer(id) {
    if (!confirm("このプレイヤーを非表示にしますか？あとから復元できます。")) return;
    const next = {
      ...data,
      players: data.players.map(player => player.id === id ? { ...player, deletedAt: new Date().toISOString() } : player)
    };
    await commit(next);
    if (setPlayerId === id) setSetPlayerId(activePlayersOf(next)[0]?.id || "");
  }

  async function restorePlayer(id) {
    const next = {
      ...data,
      players: data.players.map(player => player.id === id ? { ...player, deletedAt: null } : player)
    };
    await commit(next);
    setSetPlayerId(id);
  }

  async function hardDeletePlayer(id) {
    const player = data.players.find(p => p.id === id);
    const label = player?.name || "このプレイヤー";
    if (!confirm(`${label}さんを完全削除しますか？復元できなくなり、このプレイヤーが参加した試合履歴も削除されます。`)) return;

    const base = {
      ...data,
      players: data.players.filter(player => player.id !== id),
      ratings: data.ratings.filter(rating => rating.playerId !== id)
    };
    const remainingMatches = data.matches.filter(match => !match.members.some(member => member.playerId === id));
    const next = rebuildDataWithMatches(base, remainingMatches);
    await commit(next);
    if (setPlayerId === id) setSetPlayerId(activePlayersOf(next)[0]?.id || "");
  }

  async function addCharacterSet() {
    if (!setPlayerId || !setCharacterName) return;
    const player = data.players.find(p => p.id === setPlayerId);
    if (!player || !isActivePlayer(player)) return alert("削除済みのプレイヤーにはキャラを追加できません。先に復元してください。");
    const playerCharacterCount = data.ratings.filter(r => r.playerId === setPlayerId).length;
    if (playerCharacterCount >= MAX_CHARACTERS_PER_PLAYER) return alert(`1人あたり登録できるキャラは${MAX_CHARACTERS_PER_PLAYER}体までです。`);
    const key = ratingKey(setPlayerId, setCharacterName);
    if (data.ratings.some(r => r.key === key)) return alert("このプレイヤーとキャラのセットはすでに登録されています。");
    const next = { ...data, ratings: [...data.ratings, createRating(setPlayerId, setCharacterName)] };
    await commit(next);
  }

  async function deleteCharacterSet(key) {
    const target = data.ratings.find(r => r.key === key);
    if (!target) return;
    if (target.matches > 0) return alert("対戦履歴があるセットは削除できません。過去の試合との整合性を守るためです。");
    if (!confirm("このプレイヤー・キャラセットを削除しますか？")) return;
    const next = { ...data, ratings: data.ratings.filter(r => r.key !== key) };
    await commit(next);
  }

  const ranking = useMemo(() => {
    return [...data.ratings]
      .filter(r => activePlayersOf(data).some(p => p.id === r.playerId))
      .sort((a, b) => b.rating - a.rating);
  }, [data]);

  const totalRanking = useMemo(() => {
    return activePlayersOf(data).map(player => {
      const rs = data.ratings.filter(r => r.playerId === player.id).sort((a, b) => b.rating - a.rating);
      const top3 = rs.slice(0, 3);
      const avg = top3.length ? Math.round(top3.reduce((s, r) => s + r.rating, 0) / top3.length) : INITIAL_RATING;
      const matches = rs.reduce((s, r) => s + r.matches, 0);
      const wins = rs.reduce((s, r) => s + r.wins, 0);
      return { player, avg, top3, matches, wins };
    }).sort((a, b) => b.avg - a.avg);
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-blue-50 to-sky-100 p-6">
        <div className="rounded-3xl border border-blue-100 bg-white p-8 text-center shadow-sm shadow-blue-100">
          <Cloud className="mx-auto h-10 w-10 text-blue-600" />
          <h1 className="mt-4 text-2xl font-black text-slate-950">Supabaseから読み込み中...</h1>
          <p className="mt-2 text-sm font-bold text-slate-500">少し待ってください。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-sky-100 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header className="overflow-hidden rounded-[2rem] border border-blue-100 bg-white shadow-sm shadow-blue-100/80">
          <div className="relative p-6 md:p-8">
            <div className="absolute right-0 top-0 h-40 w-40 rounded-bl-full bg-blue-100/80" />
            <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-3xl bg-blue-600 p-4 text-white shadow-lg shadow-blue-200">
                  <Sword className="h-8 w-8" />
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-5xl">IGS Smash Rating</h1>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-3xl border border-blue-100 bg-blue-50/70 p-3 text-center">
                <MiniStat label="Players" value={activePlayersOf(data).length} />
                <MiniStat label="Sets" value={data.ratings.length} />
                <MiniStat label="Matches" value={data.matches.length} />
              </div>
            </div>
          </div>
        </header>

        {(saving || errorMessage) && (
          <div className={`rounded-3xl border p-4 text-sm font-bold ${errorMessage ? "border-red-200 bg-red-50 text-red-600" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
            {errorMessage || "Supabaseに保存中..."}
          </div>
        )}

        <nav className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ["match", "試合入力", Plus],
            ["ranking", "ランキング", Trophy],
            ["players", "プレイヤー", Users],
            ["history", "履歴", History],
            ["stats", "概要", BarChart3]
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={classNames(
                "rounded-2xl border px-4 py-3 font-bold transition",
                "flex items-center justify-center gap-2",
                tab === key
                  ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-200"
                  : "border-blue-100 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          <motion.main
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
          >
            {tab === "match" && <MatchInput data={data} commit={commit} saving={saving} />}
            {tab === "ranking" && <Ranking data={data} ranking={ranking} totalRanking={totalRanking} />}
            {tab === "players" && (
              <Players
                data={data}
                newPlayerName={newPlayerName}
                setNewPlayerName={setNewPlayerName}
                addPlayer={addPlayer}
                deletePlayer={deletePlayer}
                setPlayerId={setPlayerId}
                setSetPlayerId={setSetPlayerId}
                setCharacterName={setCharacterName}
                setSetCharacterName={setSetCharacterName}
                addCharacterSet={addCharacterSet}
                deleteCharacterSet={deleteCharacterSet}
                restorePlayer={restorePlayer}
                hardDeletePlayer={hardDeletePlayer}
                saving={saving}
              />
            )}
            {tab === "history" && <HistoryView data={data} deleteMatchOnly={deleteMatchOnly} saving={saving} />}
            {tab === "stats" && <Stats data={data} ranking={ranking} totalRanking={totalRanking} refreshData={refreshData} saving={saving} />}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-black uppercase tracking-wider text-blue-500">{label}</div>
      <div className="text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function MatchInput({ data, commit, saving }) {
  const registeredSets = data.ratings.filter(r => activePlayersOf(data).some(p => p.id === r.playerId));
  const defaultMembers = getUniqueDefaultMembers(registeredSets);
  const fallbackSet = defaultMembers[0] || { playerId: "", characterName: "" };
  const secondSet = defaultMembers[1] || fallbackSet;
  const thirdSet = defaultMembers[2] || secondSet;
  const fourthSet = defaultMembers[3] || thirdSet;

  const [mode, setMode] = useState("1v1");
  const [rule, setRule] = useState("single");
  const [teamA, setTeamA] = useState([
    { playerId: fallbackSet.playerId, characterName: fallbackSet.characterName },
    { playerId: secondSet.playerId, characterName: secondSet.characterName }
  ]);
  const [teamB, setTeamB] = useState([
    { playerId: thirdSet.playerId, characterName: thirdSet.characterName },
    { playerId: fourthSet.playerId, characterName: fourthSet.characterName }
  ]);
  const [score, setScore] = useState("1-0");
  const [winnerTeam, setWinnerTeam] = useState("A");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputLocked, setInputLocked] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const activeA = mode === "1v1" ? teamA.slice(0, 1) : teamA;
  const activeB = mode === "1v1" ? teamB.slice(0, 1) : teamB;
  const [scoreA, scoreB] = score.split("-").map(Number);
  const realScoreA = winnerTeam === "A" ? scoreA : scoreB;
  const realScoreB = winnerTeam === "A" ? scoreB : scoreA;

  const form = { mode, rule, teamA: activeA, teamB: activeB, winnerTeam, scoreA: realScoreA, scoreB: realScoreB };
  const requiredSets = mode === "1v1" ? 2 : 4;
  const uniqueSelectablePlayerCount = new Set(registeredSets.map(r => r.playerId)).size;
  const hasEnoughSets = uniqueSelectablePlayerCount >= requiredSets;
  const selectedPlayerIds = [...activeA, ...activeB].map(member => member.playerId).filter(Boolean);
  const dailyLimit = getDailyLimit(rule);
  const dailyLimitRows = selectedPlayerIds.map(playerId => {
    const player = data.players.find(p => p.id === playerId);
    const count = getDailyMatchCountForPlayer(data, playerId, rule);
    return { playerId, name: player?.name || "不明", count, limit: dailyLimit };
  });

  const selectedRatingA = data.ratings.find(
    r => r.key === ratingKey(activeA[0]?.playerId, activeA[0]?.characterName)
  );
  const selectedRatingB = data.ratings.find(
    r => r.key === ratingKey(activeB[0]?.playerId, activeB[0]?.characterName)
  );
  const isGachiPreview =
    mode === "1v1" &&
    selectedRatingA?.rating > 1700 &&
    selectedRatingB?.rating > 1700;

  const ratingDiffPreview = selectedRatingA && selectedRatingB
    ? Math.abs(selectedRatingA.rating - selectedRatingB.rating)
    : 0;
  const lowerTeamPreview = selectedRatingA && selectedRatingB
    ? selectedRatingA.rating < selectedRatingB.rating ? "A" : selectedRatingB.rating < selectedRatingA.rating ? "B" : null
    : null;
  const isGiantKillingPreview =
    mode === "1v1" &&
    ratingDiffPreview >= GIANT_KILLING_RATING_DIFF &&
    winnerTeam === lowerTeamPreview;

  useEffect(() => {
    setScore(rule === "single" ? "1-0" : "2-1");
  }, [rule]);

  useEffect(() => {
    if (!registeredSets.length) return;

    const defaults = getUniqueDefaultMembers(registeredSets);
    const fallbackA1 = defaults[0] || { playerId: "", characterName: "" };
    const fallbackA2 = defaults[1] || fallbackA1;
    const fallbackB1 = defaults[2] || fallbackA2;
    const fallbackB2 = defaults[3] || fallbackB1;

    setTeamA(current => [
      normalizeMember(current[0], fallbackA1, registeredSets),
      normalizeMember(current[1], fallbackA2, registeredSets)
    ]);

    setTeamB(current => [
      normalizeMember(current[0], fallbackB1, registeredSets),
      normalizeMember(current[1], fallbackB2, registeredSets)
    ]);
  }, [registeredSets.length, mode]);

  function updateMember(team, index, patch) {
    const setter = team === "A" ? setTeamA : setTeamB;
    const current = team === "A" ? teamA : teamB;
    setter(current.map((m, i) => i === index ? { ...m, ...patch } : m));
  }

  async function submit() {
    if (isSubmitting || inputLocked || saving) return;
    if (!hasEnoughSets) {
      return alert(
        `${mode === "2v2"
          ? "2on2には登録済みキャラを持つプレイヤーが4人必要です"
          : "1on1には登録済みキャラを持つプレイヤーが2人必要です"
        }。現在は${uniqueSelectablePlayerCount}人です。`
      );
    }

    const ids = [...activeA, ...activeB].map(m => m.playerId);
    const setKeys = [...activeA, ...activeB].map(m => ratingKey(m.playerId, m.characterName));

    if (ids.some(id => !id)) return alert("プレイヤー・キャラセットを選んでください。");
    if (new Set(ids).size !== ids.length) return alert("同じ試合内で同じプレイヤーは重複できません。");
    if (new Set(setKeys).size !== setKeys.length) return alert("同じプレイヤー・キャラセットは重複できません。");
    if ([...activeA, ...activeB].some(member => !getRatingForMember(data, member))) {
      return alert("未登録のプレイヤー・キャラが選ばれています。選手とキャラを選び直してください。");
    }

    const limitExceeded = dailyLimitRows.find(row => row.count >= row.limit);
    if (limitExceeded) return alert(`${limitExceeded.name}さんは今日の${getMatchRuleLabel(rule)}の上限（${limitExceeded.limit}回）に達しています。`);

    setIsSubmitting(true);

    try {
      const next = applyMatch(data, form);
      const newMatch = next.matches[0];
      await commit(next);
      setLastResult(newMatch);
      setInputLocked(true);
    } catch (error) {
      console.error(error);
      alert(error.message || "試合結果の反映に失敗しました。選手とキャラを選び直してください。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startNextMatch() {
    setInputLocked(false);
    setLastResult(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <AppShellCard className="lg:col-span-2 space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-600">
              <Swords className="h-5 w-5" />
              <p className="text-sm font-black uppercase tracking-wider">Battle Setup</p>
            </div>
            <h2 className="mt-1 text-3xl font-black text-slate-950">試合入力</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">1勝制がメインです。2勝制を選ぶとレート変動は1勝制の2倍になります。</p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-1.5">
              {[["single", "1勝制"], ["bo3", "2勝制"]].map(([value, label]) => (
                <button key={value} onClick={() => setRule(value)} disabled={inputLocked} className={classNames("rounded-xl px-4 py-2 text-sm font-black transition disabled:opacity-50", rule === value ? "bg-blue-600 text-white shadow" : "text-blue-700 hover:bg-white")}>{label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-1.5">
              {[["1v1", "1on1"], ["2v2", "2on2"]].map(([value, label]) => (
                <button key={value} onClick={() => setMode(value)} disabled={inputLocked} className={classNames("rounded-xl px-4 py-2 text-sm font-black transition disabled:opacity-50", mode === value ? "bg-blue-600 text-white shadow" : "text-blue-700 hover:bg-white")}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <TeamCard title="Team A" team="A" members={activeA} updateMember={updateMember} data={data} registeredSets={registeredSets} disabled={inputLocked} active={winnerTeam === "A"} />
          <div className="flex items-center justify-center">
            <div
              className={classNames(
                "rounded-full border px-4 py-2 text-xl font-black shadow-sm transition",
                isGiantKillingPreview
                  ? "border-yellow-300 bg-yellow-400 text-slate-950 shadow-yellow-200"
                  : isGachiPreview
                    ? "border-red-300 bg-red-600 text-white shadow-red-200"
                    : "border-blue-200 bg-white text-blue-600"
              )}
            >
              {isGiantKillingPreview ? "ジャイアントキリング対象 VS" : isGachiPreview ? "ガチマッチ VS" : "VS"}
            </div>
          </div>
          <TeamCard title="Team B" team="B" members={activeB} updateMember={updateMember} data={data} registeredSets={registeredSets} disabled={inputLocked} active={winnerTeam === "B"} />
        </div>

        <div className="grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/70 p-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-sm font-bold text-slate-600">勝者</span>
            <select value={winnerTeam} onChange={e => setWinnerTeam(e.target.value)} disabled={inputLocked} className="w-full rounded-2xl border border-blue-100 bg-white p-3 font-bold text-slate-800 outline-none focus:border-blue-400 disabled:opacity-50">
              <option value="A">Team A</option>
              <option value="B">Team B</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-bold text-slate-600">スコア</span>
            <select value={score} onChange={e => setScore(e.target.value)} disabled={inputLocked} className="w-full rounded-2xl border border-blue-100 bg-white p-3 font-bold text-slate-800 outline-none focus:border-blue-400 disabled:opacity-50">
              {rule === "single" ? (
                <option value="1-0">1 - 0</option>
              ) : (
                <>
                  <option value="2-1">2 - 1</option>
                  <option value="2-0">2 - 0</option>
                </>
              )}
            </select>
          </label>
          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={!hasEnoughSets || isSubmitting || inputLocked || saving}
              className="w-full rounded-2xl bg-blue-600 p-3 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none"
            >
              {isSubmitting || saving ? "処理中..." : inputLocked ? "確定済み" : "試合終了・結果確定"}
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-blue-100 bg-white p-4">
          <div className="text-sm font-black text-blue-600">本日の上限：{getMatchRuleLabel(rule)}は1人{dailyLimit}回まで</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {dailyLimitRows.map(row => (
              <div key={row.playerId} className={classNames("rounded-2xl border px-3 py-2 text-sm font-bold", row.count >= row.limit ? "border-red-200 bg-red-50 text-red-600" : "border-blue-100 bg-blue-50 text-slate-600")}>{row.name}: {row.count}/{row.limit}</div>
            ))}
          </div>
        </div>
      </AppShellCard>

      <AppShellCard>
        <div className="flex items-center gap-2 text-blue-600">
          <Medal className="h-5 w-5" />
          <h3 className="text-xl font-black text-slate-950">今回のレート変動</h3>
        </div>
        {!lastResult ? (
          <div className="mt-4 rounded-3xl border border-dashed border-blue-200 bg-blue-50/70 p-5 text-sm font-medium text-slate-500">試合結果を確定すると、ここに増減が表示されます。</div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm font-bold text-blue-700">{getMatchRuleLabel(inferRuleFromMatch(lastResult))} / {lastResult.mode} / Team {lastResult.winnerTeam} 勝利 / {lastResult.scoreA}-{lastResult.scoreB}</div>
            {getGiantKillingFromMatch(lastResult) && (
              <div className="rounded-3xl border border-yellow-300 bg-yellow-50 p-4 text-sm font-black text-yellow-800 shadow-sm">
                ⚔️ ジャイアントキリング！ レート差{getGiantKillingFromMatch(lastResult).ratingDiff}。勝者に+{GIANT_KILLING_BONUS}、敗者に-{GIANT_KILLING_BONUS}を追加しました。
              </div>
            )}
            {lastResult.milestoneMessages?.length > 0 && (
              <div className="space-y-2">
                {lastResult.milestoneMessages.map(item => (
                  <div key={item.id} className="rounded-3xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-black text-yellow-800 shadow-sm">
                    🎉 {item.playerName} / {item.characterName}: {item.message}！（{item.ratingAfter}）
                  </div>
                ))}
              </div>
            )}
            {lastResult.members.map(member => (
              <div key={member.id} className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-slate-900"><PlayerName players={data.players} id={member.playerId} /> / {member.characterName}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs font-bold text-slate-500">{member.ratingBefore} → {member.ratingAfter} <TierBadge rating={member.ratingAfter} /></div>
                  </div>
                  <ChangeBadge change={member.ratingChange} />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm font-bold">
              <span className="text-slate-600">合計増減</span>
              <ChangeBadge change={lastResult.members.reduce((sum, member) => sum + member.ratingChange, 0)} />
            </div>
            <button onClick={startNextMatch} className="w-full rounded-2xl bg-slate-950 p-3 font-black text-white transition hover:bg-blue-950">次の試合を入力する</button>
          </div>
        )}
      </AppShellCard>
    </div>
  );
}

function TeamCard({ title, team, members, updateMember, data, registeredSets, disabled = false, active = false }) {
  const selectablePlayers = activePlayersOf(data).filter(player => registeredSets.some(r => r.playerId === player.id));

  return (
    <div className={classNames(
      "rounded-[1.75rem] border-2 bg-white p-4 shadow-sm transition",
      active ? "border-blue-500 shadow-blue-100" : "border-blue-100"
    )}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-black text-slate-950">{title}</h3>
        {active && <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">WINNER</span>}
      </div>
      <div className="space-y-3">
        {members.map((member, index) => {
          const memberRatings = registeredSets.filter(r => r.playerId === member.playerId);
          const selectedCharacterName = memberRatings.some(r => r.characterName === member.characterName)
            ? member.characterName
            : (memberRatings[0]?.characterName || "");
          const currentRating = registeredSets.find(
            r => r.key === ratingKey(member.playerId, selectedCharacterName)
          );

          return (
            <div key={`${team}-${index}`} className="rounded-3xl border border-blue-100 bg-blue-50/60 p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-wider text-blue-500">Player {index + 1}</div>

              <div className="grid gap-2 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">選手</span>
                  <select
                    value={member.playerId}
                    onChange={e => {
                      const nextPlayerId = e.target.value;
                      const firstRating = registeredSets.find(r => r.playerId === nextPlayerId);
                      updateMember(team, index, {
                        playerId: nextPlayerId,
                        characterName: firstRating?.characterName || ""
                      });
                    }}
                    disabled={disabled}
                    className="w-full rounded-2xl border border-blue-100 bg-white p-3 font-bold text-slate-800 outline-none focus:border-blue-400 disabled:opacity-50"
                  >
                    {selectablePlayers.map(player => (
                      <option key={player.id} value={player.id}>{player.name}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold text-slate-500">キャラ</span>
                  <select
                    value={selectedCharacterName}
                    onChange={e => updateMember(team, index, { characterName: e.target.value })}
                    disabled={disabled || !member.playerId}
                    className="w-full rounded-2xl border border-blue-100 bg-white p-3 font-bold text-slate-800 outline-none focus:border-blue-400 disabled:opacity-50"
                  >
                    {memberRatings.map(r => (
                      <option key={r.key} value={r.characterName}>{r.characterName}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-2xl border border-blue-100 bg-white px-3 py-2">
                <span className="text-xs font-black text-slate-500">現在レート</span>
                {currentRating ? (
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-black ${getTierTextColor(currentRating.rating)}`}>{currentRating.rating}</span>
                    <TierBadge rating={currentRating.rating} />
                  </div>
                ) : (
                  <span className="text-sm font-bold text-slate-400">未登録</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Ranking({ data, ranking, totalRanking }) {
  const maxRating = Math.max(2500, ...ranking.map(r => r.rating), ...totalRanking.map(r => r.avg));

  return (
    <div className="space-y-5">
      <AppShellCard>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-600"><Trophy className="h-5 w-5" /><p className="text-sm font-black uppercase tracking-wider">Ranking Board</p></div>
            <h2 className="mt-1 text-3xl font-black text-slate-950">キャラ別ランキング</h2>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">Tier color enabled</div>
        </div>

        <div className="mt-5 rounded-[1.75rem] border border-blue-100 bg-gradient-to-b from-blue-50 to-white p-4">
          <div className="space-y-3">
            {ranking.map((r, i) => {
              const pct = Math.max(6, Math.min(100, (r.rating / maxRating) * 100));
              return (
                <div key={r.key} className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-sm font-black text-white">#{i + 1}</div>
                      <SetLabel data={data} rating={r} />
                    </div>
                    <div className="flex items-center gap-3">
                      <TierBadge rating={r.rating} large />
                      <div className={`text-2xl font-black ${getTierTextColor(r.rating)}`}>{r.rating}</div>
                      <div className="text-xs font-bold text-slate-400">{r.wins}-{r.losses}</div>
                      <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                        勝率 {getWinRateText(r.wins, r.matches)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 h-4 overflow-hidden rounded-full border border-blue-100 bg-slate-100">
                    <div className={`h-full rounded-full ${getTierBarColor(r.rating)}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {!ranking.length && <div className="rounded-3xl border border-dashed border-blue-200 bg-white p-8 text-center font-bold text-slate-400">まだ登録セットがありません。</div>}
          </div>
        </div>
      </AppShellCard>

      <AppShellCard>
        <div className="flex items-center gap-2 text-blue-600"><Users className="h-5 w-5" /><h2 className="text-2xl font-black text-slate-950">プレイヤー総合ランキング</h2></div>
        <p className="mt-1 text-sm font-medium text-slate-500">各プレイヤーの上位3キャラ平均。こちらもグラフ形式にしました。</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {totalRanking.map((item, i) => {
            const pct = Math.max(6, Math.min(100, (item.avg / maxRating) * 100));
            return (
              <div key={item.player.id} className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-blue-500">#{i + 1}</div>
                    <div className="text-xl"><NameTag name={item.player.name} rating={item.avg} /></div>
                    <div className="mt-2 text-xs font-semibold text-slate-400">{item.top3.map(r => `${r.characterName}:${r.rating}`).join(" / ") || "試合なし"}</div>
                    <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
                      勝率 {getWinRateText(item.wins, item.matches)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-black ${getTierTextColor(item.avg)}`}>{item.avg}</div>
                    <TierBadge rating={item.avg} />
                  </div>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${getTierBarColor(item.avg)}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </AppShellCard>
    </div>
  );
}

function Players({ data, newPlayerName, setNewPlayerName, addPlayer, deletePlayer, setPlayerId, setSetPlayerId, setCharacterName, setSetCharacterName, addCharacterSet, deleteCharacterSet, restorePlayer, hardDeletePlayer, saving }) {
  const activePlayers = activePlayersOf(data);
  const deletedPlayers = data.players.filter(player => !isActivePlayer(player));
  const registeredSets = data.ratings
    .filter(r => activePlayers.some(p => p.id === r.playerId))
    .sort((a, b) => {
      const pa = data.players.find(p => p.id === a.playerId)?.name || "";
      const pb = data.players.find(p => p.id === b.playerId)?.name || "";
      return pa.localeCompare(pb, "ja") || a.characterName.localeCompare(b.characterName, "ja");
    });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <AppShellCard>
        <h2 className="text-2xl font-black text-slate-950">プレイヤー管理</h2>
        <div className="mt-4 flex gap-2">
          <input value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} placeholder="プレイヤー名" className="flex-1 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 font-bold outline-none focus:border-blue-400" />
          <button onClick={addPlayer} disabled={saving} className="rounded-2xl bg-blue-600 px-5 font-black text-white shadow-lg shadow-blue-200 disabled:bg-slate-300">追加</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {activePlayers.map(player => (
            <div key={player.id} className="flex items-center justify-between rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
              <div>
                <div><NameTag name={player.name} rating={getBestRatingForPlayer(data, player.id)} /></div>
                <div className="text-xs font-bold text-slate-400">登録済み</div>
              </div>
              <button onClick={() => deletePlayer(player.id)} disabled={saving} className="rounded-2xl p-2 text-red-500 transition hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>

        {deletedPlayers.length > 0 && (
          <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-black text-amber-700">削除済みプレイヤー</div>
            <div className="mt-3 space-y-2">
              {deletedPlayers.map(player => (
                <div key={player.id} className="flex items-center justify-between rounded-2xl bg-white p-3">
                  <div className="font-bold text-slate-700">{player.name}</div>
                  <div className="flex gap-2">
                    <button onClick={() => restorePlayer(player.id)} disabled={saving} className="rounded-xl bg-amber-400 px-3 py-2 text-sm font-black text-slate-950 disabled:opacity-40">復元</button>
                    <button onClick={() => hardDeletePlayer(player.id)} disabled={saving} className="rounded-xl bg-red-600 px-3 py-2 text-sm font-black text-white disabled:opacity-40">完全削除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AppShellCard>

      <AppShellCard>
        <h2 className="text-2xl font-black text-slate-950">人 × キャラセット登録</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">ここで登録したセットを、試合入力でそのまま選べます。1人{MAX_CHARACTERS_PER_PLAYER}体までです。</p>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <select value={setPlayerId} onChange={e => setSetPlayerId(e.target.value)} className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 font-bold outline-none focus:border-blue-400">
            {activePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={setCharacterName} onChange={e => setSetCharacterName(e.target.value)} className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 font-bold outline-none focus:border-blue-400">
            {characters.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={addCharacterSet} disabled={saving || !activePlayers.length} className="rounded-2xl bg-slate-950 px-5 font-black text-white disabled:bg-slate-300">セット追加</button>
        </div>

        <div className="mt-5 max-h-[520px] space-y-3 overflow-auto pr-1">
          {registeredSets.map(r => (
            <div key={r.key} className="flex items-center justify-between gap-3 rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
              <div>
                <div className="font-black text-slate-950"><NameTag name={data.players.find(p => p.id === r.playerId)?.name || "不明"} rating={r.rating} /> / {r.characterName}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">Rate {r.rating} / {r.wins}-{r.losses} / {r.matches} matches</div>
              </div>
              <div className="flex items-center gap-2">
                <TierBadge rating={r.rating} />
                <button onClick={() => deleteCharacterSet(r.key)} disabled={saving} className="rounded-2xl p-2 text-red-500 transition hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
          {!registeredSets.length && <p className="font-bold text-slate-400">まだセットがありません。</p>}
        </div>
      </AppShellCard>
    </div>
  );
}

function HistoryView({ data, deleteMatchOnly, saving }) {
  async function handleDeleteMatch(matchId) {
    if (!confirm("この試合を取り消しますか？レートとランキングも再計算されます。")) return;
    await deleteMatchOnly(matchId);
  }

  async function handleUndoLatest() {
    const latest = data.matches[0];
    if (!latest) return;
    if (!confirm("直前の試合を取り消しますか？レートとランキングも再計算されます。")) return;
    await deleteMatchOnly(latest.id);
  }

  return (
    <AppShellCard>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">対戦履歴</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">過去の試合を個別に取り消せます。取り消し後はレートとランキングを再計算します。</p>
        </div>
        <button onClick={handleUndoLatest} disabled={!data.matches.length || saving} className="flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 font-black text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"><RotateCcw className="h-4 w-4" />直前の試合を取り消す</button>
      </div>

      <div className="mt-5 space-y-3">
        {data.matches.map(match => {
          const giantKilling = getGiantKillingFromMatch(match);

          return (
            <div key={match.id} className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-black text-slate-950">{getMatchRuleLabel(inferRuleFromMatch(match))} / {match.mode} / Team {match.winnerTeam} 勝利 / {match.scoreA}-{match.scoreB}</div>
                  <div className="mt-1 text-sm font-bold text-slate-400">{new Date(match.createdAt).toLocaleString()}</div>
                  {giantKilling && (
                    <div className="mt-2 inline-flex rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1 text-xs font-black text-yellow-800">
                      ⚔️ ジャイアントキリング！ レート差{giantKilling.ratingDiff}
                    </div>
                  )}
                </div>
                <button onClick={() => handleDeleteMatch(match.id)} disabled={saving} className="flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:opacity-40">
                  <Trash2 className="h-4 w-4" />この試合を取り消す
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {match.members.map(m => (
                  <div key={m.id} className="flex justify-between rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                    <div className="font-bold text-slate-700"><PlayerName players={data.players} id={m.playerId} /> / {m.characterName}</div>
                    <ChangeBadge change={m.ratingChange} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!data.matches.length && <p className="font-bold text-slate-400">まだ履歴がありません。</p>}
      </div>
    </AppShellCard>
  );
}

function Stats({ data, ranking, refreshData, saving }) {
  const totalMatches = data.matches.length;
  const totalPlayers = activePlayersOf(data).length;
  const activeCharacters = data.ratings.length;
  const top = ranking[0];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard label="プレイヤー数" value={totalPlayers} />
      <StatCard label="試合数" value={totalMatches} />
      <StatCard label="登録キャラレート" value={activeCharacters} />
      <StatCard label="最高レート" value={top ? top.rating : INITIAL_RATING} />
      <AppShellCard className="md:col-span-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-black text-slate-950">現在の仕様</h2>
          <button onClick={refreshData} disabled={saving} className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-40">Supabaseから再読み込み</button>
        </div>
        <div className="mt-4 grid gap-3 text-sm font-bold text-slate-700 md:grid-cols-2">
          <Spec text="保存先：Supabase" />
          <Spec text="レート単位：プレイヤー × キャラ" />
          <Spec text="形式：1on1 / 2on2" />
          <Spec text="ルール：1勝制がメイン。2勝制も選択可能" />
          <Spec text="1勝制：レート変動は2勝制の半分" />
          <Spec text="1日上限：1勝制30回、2勝制15回" />
          <Spec text="キャラ登録：1人5体まで" />
          <Spec text="削除したプレイヤーは復元可能" />
          <Spec text="2on2：チーム平均レートで計算" />
          <Spec text="勝利：レートプラス" />
          <Spec text="敗北：必ずマイナス" />
          <Spec text="2-0勝利：2勝制のみ変動1.1倍" />
          <Spec text="3連勝以上：勝者だけ連勝ボーナス。上限は1.5倍" />
          <Spec text="ガチマッチ：1on1で両者1700超えなら変動1.2倍" />
          <Spec text="平均1500以下の対戦：変動1.1倍" />
          <Spec text="変動上限：個人戦±100、チーム戦±50" />
          <Spec text="プレイヤー総合：上位3キャラ平均" />
          <Spec text="ティア：SSS 2200+ / SS 2000+ / S 1800+ / A 1600+ / B 1400+ / C 1200+ / D 1001-1199 / E 1000以下" />
        </div>
      </AppShellCard>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm shadow-blue-100/70">
      <div className="text-sm font-black uppercase tracking-wider text-blue-500">{label}</div>
      <div className="mt-2 text-4xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function Spec({ text }) {
  return <div className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-3"><ChevronRight className="h-4 w-4 shrink-0 text-blue-500" />{text}</div>;
}
