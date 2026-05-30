import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Users, Plus, History, RotateCcw, BarChart3, Trash2, Swords, Medal, ChevronRight, Cloud } from "lucide-react";
import { supabase } from "./lib/supabase";

// Smash Rating App MVP
// - Supabase synced version
// - Black/blue visual design
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
const GIANT_KILLING_BONUS_MULTIPLIER = 0.2;
const RANDOM_MATCH_RATE_MULTIPLIER = 1.1;
const LOSING_STREAK_MIN_COUNT = 2;
const LOSING_STREAK_PENALTY_PER_LOSS = 3;
const MIN_TOTAL_CHANGE_AFTER_LOSING_STREAK = 3;
const TIER_MESSAGE_EXCLUDED_PLAYER_NAMES = ["しゅー"];
const PLAYER_RANK_MESSAGE_EXCLUDED_PLAYER_NAMES = ["しゅー"];

// ランク初到達時に表示するAmazonギフトURL。
// 基本はプレイヤー名 × ランクごとに個別URLを入れてください。
// 下の PLAYER_RANK_GIFT_URLS は、プレイヤー別URLが未設定のときの予備URLです。
const PLAYER_RANK_GIFT_URLS_BY_PLAYER = {
  // 例：
  // "友人A": {
  //   Platinum: "https://www.amazon.co.jp/g/xxxxx",
  //   Sapphire: "https://www.amazon.co.jp/g/yyyyy",
  //   Ruby: "",
  //   Diamond: "",
  //   Master: ""
  // }
};

const PLAYER_RANK_GIFT_URLS = {
  Platinum: "https://www.amazon.co.jp/g/DQSD2QKLWHXBCP?t=SvL",
  Sapphire: "https://www.amazon.co.jp/g/3BPSR23YZSUECZ?t=SvL",
  Ruby: "https://www.amazon.co.jp/g/ZAT9YWEC7SX8CN?t=SvL",
  Diamond: "https://www.amazon.co.jp/g/GFA8JZGW6MUTCN?t=SvL",
  Master: "https://www.amazon.co.jp/g/XDZE2YSWEXDAC6?t=SvL"
};

const PLAYER_RANK_MILESTONES = [
  { rank: "Platinum", threshold: 1600, playerFlag: "reachedRankPlatinum" },
  { rank: "Sapphire", threshold: 1700, playerFlag: "reachedRankSapphire" },
  { rank: "Ruby", threshold: 1800, playerFlag: "reachedRankRuby" },
  { rank: "Diamond", threshold: 1900, playerFlag: "reachedRankDiamond" },
  { rank: "Master", threshold: 2000, playerFlag: "reachedRankMaster" }
];

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
    highestRating: INITIAL_RATING,
    baseRating: INITIAL_RATING
  };
}

function createPlayerRecord(name, createdAt = new Date().toISOString()) {
  return {
    id: uid(),
    name,
    createdAt,
    deletedAt: null,
    reachedTierS: false,
    reachedTierSS: false,
    reachedTierSSS: false,
    reachedRankPlatinum: false,
    reachedRankSapphire: false,
    reachedRankRuby: false,
    reachedRankDiamond: false,
    reachedRankMaster: false
  };
}

function createInitialData() {
  const now = new Date().toISOString();
  const players = [
    createPlayerRecord("しゅー", now),
    createPlayerRecord("友人A", now),
    createPlayerRecord("友人B", now),
    createPlayerRecord("友人C", now)
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
    deletedAt: row.deleted_at || null,
    reachedTierS: Boolean(row.reached_tier_s),
    reachedTierSS: Boolean(row.reached_tier_ss),
    reachedTierSSS: Boolean(row.reached_tier_sss),
    reachedRankPlatinum: Boolean(row.reached_rank_platinum),
    reachedRankSapphire: Boolean(row.reached_rank_sapphire),
    reachedRankRuby: Boolean(row.reached_rank_ruby),
    reachedRankDiamond: Boolean(row.reached_rank_diamond),
    reachedRankMaster: Boolean(row.reached_rank_master)
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
    highestRating: row.highest_rating,
    baseRating: row.base_rating ?? INITIAL_RATING
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
  const storedAvgA = Number(row.avg_a || 0);

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
    avgA: Math.abs(storedAvgA),
    avgB: Number(row.avg_b || 0),
    isRandomMatch: Boolean(row.is_random_match) || storedAvgA < 0,
    createdAt: row.created_at
  };
}

function dbPlayerFromApp(player) {
  return {
    id: player.id,
    name: player.name,
    created_at: player.createdAt || new Date().toISOString(),
    deleted_at: player.deletedAt || null,
    reached_tier_s: Boolean(player.reachedTierS),
    reached_tier_ss: Boolean(player.reachedTierSS),
    reached_tier_sss: Boolean(player.reachedTierSSS),
    reached_rank_platinum: Boolean(player.reachedRankPlatinum),
    reached_rank_sapphire: Boolean(player.reachedRankSapphire),
    reached_rank_ruby: Boolean(player.reachedRankRuby),
    reached_rank_diamond: Boolean(player.reachedRankDiamond),
    reached_rank_master: Boolean(player.reachedRankMaster)
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
    highest_rating: rating.highestRating,
    base_rating: rating.baseRating ?? INITIAL_RATING
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
    avg_a: match.isRandomMatch ? -Math.abs(Number(match.avgA || 0)) : match.avgA,
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

async function upsertRows(tableName, rows) {
  if (!rows.length) return;
  const { error } = await supabase.from(tableName).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function deleteRowsNotIn(tableName, ids) {
  if (!ids.length) {
    await deleteAllRows(tableName);
    return;
  }

  const keepIds = new Set(ids);
  const { data, error: selectError } = await supabase
    .from(tableName)
    .select("id");

  if (selectError) throw selectError;

  const staleIds = (data || [])
    .map(row => row.id)
    .filter(id => !keepIds.has(id));

  if (!staleIds.length) return;

  const { error } = await supabase
    .from(tableName)
    .delete()
    .in("id", staleIds);

  if (error) throw error;
}

async function syncAllDataToSupabase(data) {
  const playerRows = data.players.map(dbPlayerFromApp);
  const ratingRows = data.ratings.map(dbRatingFromApp);
  const matchRows = data.matches.map(dbMatchFromApp);
  const memberRows = data.matches.flatMap(match => match.members.map(member => dbMemberFromApp(member, match.id)));

  await upsertRows("players", playerRows);
  await upsertRows("character_ratings", ratingRows);
  await upsertRows("matches", matchRows);
  await upsertRows("match_members", memberRows);

  await deleteRowsNotIn("match_members", memberRows.map(row => row.id));
  await deleteRowsNotIn("matches", matchRows.map(row => row.id));
  await deleteRowsNotIn("character_ratings", ratingRows.map(row => row.id));
  await deleteRowsNotIn("players", playerRows.map(row => row.id));
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

const TIER_FILTER_OPTIONS = [
  { value: "all", label: "すべて", threshold: null },
  { value: "SSS", label: "Tier SSS", threshold: 2200 },
  { value: "SS", label: "Tier SS", threshold: 2000 },
  { value: "S", label: "Tier S", threshold: 1800 },
  { value: "A", label: "Tier A", threshold: 1600 },
  { value: "B", label: "Tier B", threshold: 1400 },
  { value: "C", label: "Tier C", threshold: 1200 },
  { value: "D", label: "Tier D", threshold: 1001 },
  { value: "E", label: "Tier E", threshold: -Infinity }
];

const RANDOM_MATCH_TIER_OPTIONS = TIER_FILTER_OPTIONS.filter(option => option.value !== "all");

function getTierThreshold(tier) {
  return TIER_FILTER_OPTIONS.find(option => option.value === tier)?.threshold ?? null;
}

function isRatingAtLeastTier(rating, tier) {
  if (tier === "all") return true;
  const threshold = getTierThreshold(tier);
  return threshold === null ? true : rating >= threshold;
}

function isRatingExactTier(rating, tier) {
  if (tier === "all") return true;
  return getTier(rating) === tier;
}

function getTierMilestones(rating) {
  return [
    { tier: "S", threshold: 1800, playerFlag: "reachedTierS", message: "TierS初到達おめでとう https://www.amazon.co.jp/g/A9QXL8E8A8G6CQ?t=SvL" },
    { tier: "SS", threshold: 2000, playerFlag: "reachedTierSS", message: "TierSS初到達おめでとう https://www.amazon.co.jp/g/9HVUXBE33UT5CPt=SvL" },
    { tier: "SSS", threshold: 2200, playerFlag: "reachedTierSSS", message: "TierSSS初到達おめでとう https://www.amazon.co.jp/g/JS4DLDLGEA8RC9t=SvL" }
  ].filter(milestone => rating >= milestone.threshold);
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

function getPlayerRank(avgRating) {
  if (avgRating >= 2000) return "Master";
  if (avgRating >= 1900) return "Diamond";
  if (avgRating >= 1800) return "Ruby";
  if (avgRating >= 1700) return "Sapphire";
  if (avgRating >= 1600) return "Platinum";
  if (avgRating >= 1550) return "Gold";
  if (avgRating >= 1450) return "Silver";
  if (avgRating >= 1401) return "Bronze";
  return "Iron";
}

function getPlayerRankMilestones(avgRating) {
  return PLAYER_RANK_MILESTONES.filter(milestone => avgRating >= milestone.threshold);
}

function getPlayerRankGiftUrl(playerName, rank) {
  return PLAYER_RANK_GIFT_URLS_BY_PLAYER[playerName]?.[rank] || PLAYER_RANK_GIFT_URLS[rank] || "";
}

function getPlayerRankMilestoneMessage(rank) {
  return `${rank}おめでとう！`;
}

function getPlayerRatingsFromList(ratings, playerId) {
  return ratings.filter(rating => rating.playerId === playerId);
}

function getPlayerAverageRatingFromList(ratings, playerId) {
  const playerRatings = getPlayerRatingsFromList(ratings, playerId);
  if (!playerRatings.length) return INITIAL_RATING;
  return Math.round(playerRatings.reduce((sum, rating) => sum + rating.rating, 0) / playerRatings.length);
}

function hasEnoughSetsForPlayerRank(ratings, playerId) {
  return getPlayerRatingsFromList(ratings, playerId).length >= 3;
}

function getPlayerRankStyle(avgRating) {
  const rank = getPlayerRank(avgRating);
  const styles = {
    Master: "border-red-950 bg-black text-red-500 shadow-red-200",
    Diamond: "border-cyan-300 bg-cyan-50 text-cyan-700 shadow-cyan-100",
    Ruby: "border-rose-300 bg-rose-50 text-rose-500 shadow-rose-100",
    Sapphire: "border-blue-500 bg-blue-50 text-blue-700 shadow-blue-100",
    Platinum: "border-slate-300 bg-gradient-to-r from-slate-100 via-white to-slate-200 text-slate-700 shadow-slate-100",
    Gold: "border-yellow-400 bg-yellow-50 text-yellow-700 shadow-yellow-100",
    Silver: "border-zinc-300 bg-zinc-100 text-zinc-600 shadow-zinc-100",
    Bronze: "border-amber-700 bg-amber-50 text-amber-800 shadow-amber-100",
    Iron: "border-gray-400 bg-gray-100 text-gray-600 shadow-gray-100"
  };
  return styles[rank];
}

function getPlayerRankPanelStyle(avgRating) {
  const rank = getPlayerRank(avgRating);
  const styles = {
    Master: "border-red-950 bg-black text-red-500 shadow-red-200/80",
    Diamond: "border-cyan-300 bg-cyan-50 text-cyan-700 shadow-cyan-100/80",
    Ruby: "border-rose-300 bg-rose-50 text-rose-500 shadow-rose-100/80",
    Sapphire: "border-blue-500 bg-blue-50 text-blue-700 shadow-blue-100/80",
    Platinum: "border-slate-300 bg-gradient-to-r from-slate-100 via-white to-slate-200 text-slate-700 shadow-slate-100/80",
    Gold: "border-yellow-400 bg-yellow-50 text-yellow-700 shadow-yellow-100/80",
    Silver: "border-zinc-300 bg-zinc-100 text-zinc-600 shadow-zinc-100/80",
    Bronze: "border-amber-700 bg-amber-50 text-amber-800 shadow-amber-100/80",
    Iron: "border-gray-400 bg-gray-100 text-gray-600 shadow-gray-100/80"
  };
  return styles[rank];
}

function PlayerRankBadge({ avgRating, small = false, featured = false }) {
  const sizeClass = featured
    ? "px-4 py-1.5 text-sm tracking-wide shadow-md ring-1 ring-white/70"
    : small
      ? "px-2 py-0.5 text-[10px] tracking-wide"
      : "px-3 py-1 text-xs tracking-wide shadow-sm";

  return (
    <span className={`inline-flex items-center justify-center rounded-full border font-black ${getPlayerRankStyle(avgRating)} ${sizeClass}`}>
      {getPlayerRank(avgRating)}
    </span>
  );
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

function getPlayerAverageRating(data, playerId) {
  return getPlayerAverageRatingFromList(data.ratings, playerId);
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

function PlayerIdentity({ data, playerId, rating, name, rankFeatured = false, nameClassName = "", rankPanel = false }) {
  const player = data.players.find(p => p.id === playerId);
  const displayName = name || player?.name || "不明";
  const playerRatings = data.ratings.filter(r => r.playerId === playerId);
  const shouldShowPlayerRank = playerRatings.length >= 3;
  const playerRate = shouldShowPlayerRank
    ? Math.round(playerRatings.reduce((sum, item) => sum + item.rating, 0) / playerRatings.length)
    : null;
  const displayRating = rating ?? getBestRatingForPlayer(data, playerId);

  if (rankPanel && shouldShowPlayerRank) {
    return (
      <div className={`min-w-0 ${nameClassName}`}>
        <div className={`rounded-3xl border-2 px-4 py-3 shadow-md ${getPlayerRankPanelStyle(playerRate)}`}>
          <div className="truncate text-2xl font-black tracking-tight">
            {displayName}
          </div>
          <div className="mt-2">
            <PlayerRankBadge avgRating={playerRate} featured />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${nameClassName}`}>
      <div className="truncate">
        <NameTag name={displayName} rating={displayRating} />
      </div>
      {shouldShowPlayerRank && (
        <div className={rankFeatured ? "mt-1.5" : "mt-1"}>
          <PlayerRankBadge avgRating={playerRate} small={!rankFeatured} featured={rankFeatured} />
        </div>
      )}
    </div>
  );
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


const TIER_CHART_LINES = [
  { label: "E", rating: 1000, stroke: "#6b7280" },
  { label: "C", rating: 1200, stroke: "#d97706" },
  { label: "B", rating: 1400, stroke: "#059669" },
  { label: "A", rating: 1600, stroke: "#2563eb" },
  { label: "S", rating: 1800, stroke: "#db2777" },
  { label: "SS", rating: 2000, stroke: "#dc2626" },
  { label: "SSS", rating: 2200, stroke: "#111827" }
];

function getRatingHistoryForSet(data, rating) {
  const chronologicalMatches = [...data.matches].reverse();
  const related = [];

  for (const match of chronologicalMatches) {
    const member = match.members.find(
      item => item.playerId === rating.playerId && item.characterName === rating.characterName
    );

    if (!member) continue;

    related.push({
      match,
      member,
      ratingBefore: member.ratingBefore,
      ratingAfter: member.ratingAfter,
      ratingChange: member.ratingChange,
      won: member.won,
      createdAt: match.createdAt
    });
  }

  if (!related.length) {
    return {
      matches: [],
      points: [
        { index: 0, rating: rating.rating },
        { index: 1, rating: rating.rating }
      ]
    };
  }

  return {
    matches: related,
    points: [
      { index: 0, rating: related[0].ratingBefore },
      ...related.map((item, index) => ({ index: index + 1, rating: item.ratingAfter }))
    ]
  };
}

function RatingHistoryChart({ data, rating, onClose }) {
  const player = data.players.find(p => p.id === rating.playerId);
  const history = getRatingHistoryForSet(data, rating);
  const points = history.points;
  const width = 760;
  const height = 320;
  const padding = { left: 42, right: 24, top: 24, bottom: 46 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  const allRatings = [
    ...points.map(point => point.rating),
    ...TIER_CHART_LINES.map(line => line.rating)
  ];
  const rawMin = Math.min(...allRatings);
  const rawMax = Math.max(...allRatings);
  const yMin = Math.floor((rawMin - 80) / 100) * 100;
  const yMax = Math.ceil((rawMax + 80) / 100) * 100;
  const maxX = Math.max(1, points[points.length - 1]?.index || 1);

  function xScale(index) {
    return padding.left + (index / maxX) * graphWidth;
  }

  function yScale(value) {
    if (yMax === yMin) return padding.top + graphHeight / 2;
    return padding.top + ((yMax - value) / (yMax - yMin)) * graphHeight;
  }

  const linePoints = points.map(point => `${xScale(point.index)},${yScale(point.rating)}`).join(" ");
  const latest = points[points.length - 1]?.rating ?? rating.rating;
  const first = points[0]?.rating ?? INITIAL_RATING;
  const totalChange = latest - first;

  return (
    <div className="rounded-[1.75rem] border border-blue-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-blue-500">Rating History</div>
          <div className="mt-1 flex flex-wrap items-start gap-2 text-2xl font-black text-slate-950">
            <PlayerIdentity data={data} playerId={rating.playerId} name={player?.name || "不明"} rating={rating.rating} />
            <span className="pt-1">/ {rating.characterName}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">現在 {rating.rating}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">試合 {rating.matches}</span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">勝率 {getWinRateText(rating.wins, rating.matches)}</span>
            <span className={classNames("rounded-full px-3 py-1", totalChange >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
              通算 {formatChange(totalChange)}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-100"
        >
          閉じる
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-3xl border border-blue-100 bg-blue-50/40 p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px]">
          <rect x="0" y="0" width={width} height={height} rx="20" fill="white" />

          {TIER_CHART_LINES.map(line => {
            const y = yScale(line.rating);
            return (
              <g key={line.label}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke={line.stroke}
                  strokeWidth="1.2"
                  strokeDasharray="6 8"
                  opacity="0.5"
                />
                <text x="10" y={y + 4} fontSize="12" fontWeight="900" fill={line.stroke}>
                  {line.label}
                </text>
              </g>
            );
          })}

          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1.2" />
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1.2" />

          <text x={padding.left} y={height - 14} fontSize="12" fontWeight="800" fill="#475569">
            0試合
          </text>
          <text x={width - padding.right - 60} y={height - 14} fontSize="12" fontWeight="800" fill="#475569">
            {maxX}試合
          </text>
          <text x={width / 2 - 28} y={height - 14} fontSize="12" fontWeight="900" fill="#1d4ed8">
            横軸：試合
          </text>
          <polyline
            points={linePoints}
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {points.map(point => (
            <circle
              key={point.index}
              cx={xScale(point.index)}
              cy={yScale(point.rating)}
              r="4"
              fill="#2563eb"
              stroke="white"
              strokeWidth="2"
            />
          ))}
        </svg>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {history.matches.slice(-6).reverse().map((item, index) => {
          const giantKilling = getGiantKillingFromMatch(item.match);
          return (
            <div key={`${item.match.id}-${index}`} className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-black text-slate-800">
                  {new Date(item.createdAt).toLocaleDateString()} / {item.won ? "勝ち" : "負け"}
                </div>
                <ChangeBadge change={item.ratingChange} />
              </div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {item.ratingBefore} → {item.ratingAfter}
                {giantKilling && (
                  <span className="ml-2 rounded-full bg-yellow-100 px-2 py-0.5 font-black text-yellow-800">
                    ジャイアントキリング
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scoreMultiplier(scoreWinner, scoreLoser) {
  if (scoreWinner === 2 && scoreLoser === 0) return 1.1;
  return 1.0;
}

function getGiantKillingBonus(ratingDiff) {
  return Math.floor(ratingDiff * GIANT_KILLING_BONUS_MULTIPLIER);
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
  const bonus = getGiantKillingBonus(ratingDiff);

  return {
    message: "ジャイアントキリング！",
    bonus,
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
  const bonus = getGiantKillingBonus(ratingDiff);

  return {
    message: "ジャイアントキリング！",
    bonus,
    ratingDiff: Math.round(ratingDiff),
    winnerTeam: lowerTeam,
    winnerPlayerId: winner.playerId,
    winnerCharacterName: winner.characterName,
    loserPlayerId: loser.playerId,
    loserCharacterName: loser.characterName
  };
}


function isGachiMatchFromMatch(match) {
  if (match?.isGachiMatch) return true;
  if (match?.mode !== "1v1" || !Array.isArray(match?.members)) return false;

  const a = match.members.find(member => member.team === "A");
  const b = match.members.find(member => member.team === "B");

  return Number(a?.ratingBefore) > 1700 && Number(b?.ratingBefore) > 1700;
}

function isRandomGachiMatch(match) {
  return Boolean(match?.isRandomMatch) && isGachiMatchFromMatch(match);
}

function getRandomMatchLabel(match) {
  if (!match?.isRandomMatch) return "";
  return isRandomGachiMatch(match) ? "ランダムガチマッチ" : "ランダムマッチ";
}

function getRandomMatchBadgeClass(match) {
  if (isRandomGachiMatch(match)) {
    return "border-red-700 bg-black text-red-500 shadow-red-200";
  }

  return "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm";
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

function getCurrentLossStreak(data, playerId, characterName) {
  let streak = 0;

  for (const match of data.matches) {
    const member = match.members.find(
      item => item.playerId === playerId && item.characterName === characterName
    );

    if (!member) continue;
    if (member.won) break;
    streak += 1;
  }

  return streak;
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

function getRuleFactor(rule) {
  return rule === "single" ? 0.5 : 1;
}

function getRandomMatchFactor(isRandomMatch) {
  return isRandomMatch ? RANDOM_MATCH_RATE_MULTIPLIER : 1;
}

function getMaxAbsChangeForMode(mode) {
  return mode === "2v2" ? 50 : 100;
}

function getGachiFactor(isGachiMatch) {
  return isGachiMatch ? 1.2 : 1;
}

function getLowAverageFactor(matchAverage) {
  return matchAverage <= 1500 ? 1.1 : 1;
}

function calculateBaseAbsChange(ratingRecord, won, expected, mult) {
  const k = getK(ratingRecord.matches);
  return Math.abs(k * ((won ? 1 : 0) - expected) * mult);
}

function calculateMemberRatingChange({
  baseAbs,
  won,
  nextStreak,
  ruleFactor,
  gachiFactor,
  lowAverageFactor,
  randomMatchFactor
}) {
  if (won) {
    const streakBonus = getStreakBonusMultiplier(nextStreak);
    return Math.max(
      1,
      roundChange(
        (baseAbs * RATE_INTENSITY_MULTIPLIER + WIN_BONUS) *
          ruleFactor *
          gachiFactor *
          lowAverageFactor *
          streakBonus *
          RATE_GLOBAL_MULTIPLIER *
          randomMatchFactor
      )
    );
  }

  return Math.min(
    -1,
    -roundChange(
      baseAbs *
        RATE_INTENSITY_MULTIPLIER *
        LOSS_FACTOR *
        ruleFactor *
        gachiFactor *
        lowAverageFactor *
        RATE_GLOBAL_MULTIPLIER *
        randomMatchFactor
    )
  );
}

function calculateMatch({ data, mode, rule = "single", teamA, teamB, winnerTeam, scoreA, scoreB, isRandomMatch = false }) {
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
  const ruleFactor = getRuleFactor(rule);
  const randomMatchFactor = getRandomMatchFactor(isRandomMatch);
  const maxAbsChange = getMaxAbsChangeForMode(mode);

  const isGachiMatch =
    mode === "1v1" &&
    fullA[0]?.ratingRecord.rating > 1700 &&
    fullB[0]?.ratingRecord.rating > 1700;

  const gachiFactor = getGachiFactor(isGachiMatch);
  const lowAverageFactor = getLowAverageFactor(matchAverage);

  function apply(member, team, won, expected) {
    const before = member.ratingRecord.rating;
    const currentStreak = member.ratingRecord.winStreak || 0;
    const nextStreak = won ? currentStreak + 1 : 0;
    const currentLossStreak = getCurrentLossStreak(data, member.playerId, member.characterName);
    const nextLossStreak = won ? 0 : currentLossStreak + 1;
    const baseAbs = calculateBaseAbsChange(member.ratingRecord, won, expected, mult);

    let change = calculateMemberRatingChange({
      baseAbs,
      won,
      nextStreak,
      ruleFactor,
      gachiFactor,
      lowAverageFactor,
      randomMatchFactor
    });

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
      lossStreakBefore: currentLossStreak,
      lossStreakAfter: nextLossStreak,
      losingStreakPenalty: 0,
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
        member.ratingChange += giantKilling.bonus;
      }

      if (member.playerId === giantKilling.loserPlayerId && member.characterName === giantKilling.loserCharacterName) {
        member.ratingChange -= giantKilling.bonus;
      }
    }
  }

  let totalChangeAfterBonus = rawMembers.reduce((sum, member) => sum + member.ratingChange, 0);
  const losingStreakMembers = rawMembers.filter(
    member => !member.won && member.lossStreakAfter >= LOSING_STREAK_MIN_COUNT
  );

  for (const member of losingStreakMembers) {
    const availablePenalty = totalChangeAfterBonus - MIN_TOTAL_CHANGE_AFTER_LOSING_STREAK;
    if (availablePenalty <= 0) break;

    const requestedPenalty = (member.lossStreakAfter - 1) * LOSING_STREAK_PENALTY_PER_LOSS;
    const actualPenalty = Math.min(requestedPenalty, availablePenalty);

    if (actualPenalty <= 0) continue;

    member.ratingChange -= actualPenalty;
    member.losingStreakPenalty = actualPenalty;
    totalChangeAfterBonus -= actualPenalty;
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

  const milestoneMessages = [];
  const milestoneKeys = new Set();
  const updatedRatings = Array.from(newRatings.values());
  const nextPlayers = data.players.map(player => ({
    ...player,
    reachedTierS: Boolean(player.reachedTierS),
    reachedTierSS: Boolean(player.reachedTierSS),
    reachedTierSSS: Boolean(player.reachedTierSSS),
    reachedRankPlatinum: Boolean(player.reachedRankPlatinum),
    reachedRankSapphire: Boolean(player.reachedRankSapphire),
    reachedRankRuby: Boolean(player.reachedRankRuby),
    reachedRankDiamond: Boolean(player.reachedRankDiamond),
    reachedRankMaster: Boolean(player.reachedRankMaster)
  }));

  for (const member of calculation.members) {
    if (!member.won || member.ratingAfter <= member.ratingBefore) continue;

    const playerIndex = nextPlayers.findIndex(player => player.id === member.playerId);
    if (playerIndex === -1) continue;

    const player = nextPlayers[playerIndex];
    const milestones = getTierMilestones(member.ratingAfter);
    const shouldHideTierMessage = TIER_MESSAGE_EXCLUDED_PLAYER_NAMES.includes(player.name);

    for (const milestone of milestones) {
      if (player[milestone.playerFlag]) continue;
      const uniqueKey = `${player.id}-${milestone.tier}`;
      if (milestoneKeys.has(uniqueKey)) continue;

      player[milestone.playerFlag] = true;
      milestoneKeys.add(uniqueKey);

      if (!shouldHideTierMessage) {
        milestoneMessages.push({
          id: uid(),
          playerId: player.id,
          playerName: player.name,
          characterName: member.characterName,
          tier: milestone.tier,
          message: milestone.message,
          ratingAfter: member.ratingAfter
        });
      }
    }
  }


  const changedPlayerIds = [...new Set(calculation.members.map(member => member.playerId))];

  for (const playerId of changedPlayerIds) {
    const playerIndex = nextPlayers.findIndex(player => player.id === playerId);
    if (playerIndex === -1) continue;

    const player = nextPlayers[playerIndex];
    if (PLAYER_RANK_MESSAGE_EXCLUDED_PLAYER_NAMES.includes(player.name)) continue;
    if (!hasEnoughSetsForPlayerRank(updatedRatings, playerId)) continue;

    const beforeAvg = getPlayerAverageRatingFromList(data.ratings, playerId);
    const afterAvg = getPlayerAverageRatingFromList(updatedRatings, playerId);
    if (afterAvg <= beforeAvg) continue;

    const rankMilestones = getPlayerRankMilestones(afterAvg);

    for (const milestone of rankMilestones) {
      if (player[milestone.playerFlag]) continue;
      const uniqueKey = `${player.id}-rank-${milestone.rank}`;
      if (milestoneKeys.has(uniqueKey)) continue;

      player[milestone.playerFlag] = true;
      milestoneKeys.add(uniqueKey);
      milestoneMessages.push({
        id: uid(),
        kind: "playerRank",
        playerId: player.id,
        playerName: player.name,
        rank: milestone.rank,
        message: getPlayerRankMilestoneMessage(milestone.rank),
        giftUrl: getPlayerRankGiftUrl(player.name, milestone.rank),
        ratingAfter: afterAvg
      });
    }
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
    isRandomMatch: Boolean(form.isRandomMatch),
    members: calculation.members,
    milestoneMessages,
    avgA: calculation.avgA,
    avgB: calculation.avgB,
    createdAt: new Date().toISOString()
  };

  return { ...data, players: nextPlayers, ratings: updatedRatings, matches: [match, ...data.matches] };
}

function resetRatingStats(rating) {
  const baseRating = rating.baseRating ?? INITIAL_RATING;

  return {
    ...rating,
    rating: baseRating,
    matches: 0,
    wins: 0,
    losses: 0,
    winStreak: 0,
    highestRating: Math.max(rating.highestRating ?? baseRating, baseRating),
    baseRating
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
      winnerTeam: oldMatch.winnerTeam,
      isRandomMatch: Boolean(oldMatch.isRandomMatch)
    };

    const next = applyMatch(rebuilt, form);
    const recalculatedMatch = {
      ...next.matches[0],
      id: oldMatch.id,
      rule: inferRuleFromMatch(oldMatch),
      isRandomMatch: Boolean(oldMatch.isRandomMatch),
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

function AppLogo() {
  return (
    <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-[1.4rem] border border-blue-400/60 bg-gradient-to-br from-slate-950 via-blue-950 to-blue-600 shadow-xl shadow-blue-950/60 ring-1 ring-white/10">
      <div className="absolute left-2 top-2 h-5 w-5 rounded-full bg-blue-300/70 blur-sm" />
      <div className="absolute bottom-2 right-2 h-7 w-7 rounded-full bg-blue-700/60 blur-md" />
      <Swords className="relative h-8 w-8 text-white drop-shadow-lg" />
      <span className="absolute -bottom-2 rounded-full border border-blue-300/70 bg-slate-950 px-2 py-0.5 text-[10px] font-black tracking-widest text-blue-200 shadow-md">
        VS
      </span>
    </div>
  );
}

function PlayerName({ data, players, id }) {
  const player = data?.players?.find(p => p.id === id) || players?.find(p => p.id === id);

  if (data) {
    return <PlayerIdentity data={data} playerId={id} name={player?.name || "不明"} />;
  }

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
      <PlayerIdentity data={data} playerId={rating.playerId} name={player?.name || "不明"} rating={rating.rating} />
      <div className="mt-1 truncate text-sm font-semibold text-blue-700">{rating.characterName}</div>
    </div>
  );
}

function AppShellCard({ children, className = "" }) {
  return (
    <section className={`rounded-3xl border border-blue-200/80 bg-white/95 p-5 shadow-xl shadow-blue-950/20 backdrop-blur ${className}`}>
      {children}
    </section>
  );
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
      // 履歴削除後は、残った試合のratingBefore / ratingAfter / ratingChangeも再計算されるため、
      // ratingだけでなくmatches / match_membersまでまとめて保存し直す。
      await syncAllDataToSupabase(next);
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
    const player = createPlayerRecord(name);
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
    return activePlayersOf(data)
      .map(player => {
        const sets = data.ratings
          .filter(r => r.playerId === player.id)
          .sort((a, b) => b.rating - a.rating);

        if (sets.length < 3) return null;

        const avg = Math.round(sets.reduce((sum, r) => sum + r.rating, 0) / sets.length);
        const matches = sets.reduce((sum, r) => sum + r.matches, 0);
        const wins = sets.reduce((sum, r) => sum + r.wins, 0);

        return {
          player,
          avg,
          sets,
          characterCount: sets.length,
          matches,
          wins,
          playerRank: getPlayerRank(avg)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.avg - a.avg);
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-black via-slate-950 to-blue-950 p-6">
        <div className="rounded-3xl border border-blue-500/40 bg-slate-950/90 p-8 text-center shadow-2xl shadow-blue-950/60">
          <Cloud className="mx-auto h-10 w-10 text-blue-300" />
          <h1 className="mt-4 text-2xl font-black text-white">Supabaseから読み込み中...</h1>
          <p className="mt-2 text-sm font-bold text-blue-200">少し待ってください。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-slate-950 to-blue-950 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header className="overflow-hidden rounded-[2rem] border border-blue-500/30 bg-slate-950/90 shadow-2xl shadow-blue-950/40">
          <div className="relative p-6 md:p-8">
            <div className="absolute right-0 top-0 h-48 w-48 rounded-bl-full bg-blue-500/20 blur-sm" />
            <div className="absolute left-10 top-0 h-24 w-24 rounded-full bg-blue-400/10 blur-2xl" />
            <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-4">
                <AppLogo />
                <div>
                  <div className="mb-1 inline-flex rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1 text-xs font-black tracking-widest text-blue-200">
                    IGS BATTLE BOARD
                  </div>
                  <h1 className="text-3xl font-black tracking-tight text-white md:text-5xl">IGS Smash Rating</h1>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-3xl border border-blue-400/30 bg-black/35 p-3 text-center backdrop-blur">
                <MiniStat label="Players" value={activePlayersOf(data).length} />
                <MiniStat label="Sets" value={data.ratings.length} />
                <MiniStat label="Matches" value={data.matches.length} />
              </div>
            </div>
          </div>
        </header>

        {(saving || errorMessage) && (
          <div className={`rounded-3xl border p-4 text-sm font-bold shadow-lg ${errorMessage ? "border-red-400/40 bg-red-950/80 text-red-200 shadow-red-950/30" : "border-blue-400/40 bg-blue-950/80 text-blue-100 shadow-blue-950/30"}`}>
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
                  ? "border-blue-400 bg-blue-600 text-white shadow-lg shadow-blue-900/50"
                  : "border-blue-500/20 bg-slate-950/80 text-blue-100 hover:border-blue-400 hover:bg-blue-950 hover:text-white"
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
    <div className="rounded-2xl border border-blue-400/20 bg-slate-950/80 px-4 py-3 shadow-sm">
      <div className="text-xs font-black uppercase tracking-wider text-blue-300">{label}</div>
      <div className="text-2xl font-black text-white">{value}</div>
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
  const [matchStarted, setMatchStarted] = useState(false);
  const [completedMatchId, setCompletedMatchId] = useState("");
  const [randomPanelOpen, setRandomPanelOpen] = useState(false);
  const [randomMatchTierSelection, setRandomMatchTierSelection] = useState([]);
  const [randomMatchSelectedKeys, setRandomMatchSelectedKeys] = useState([]);
  const [isRandomMatch, setIsRandomMatch] = useState(false);
  const [randomMatchEffect, setRandomMatchEffect] = useState(false);

  const activeA = mode === "1v1" ? teamA.slice(0, 1) : teamA;
  const activeB = mode === "1v1" ? teamB.slice(0, 1) : teamB;
  const [scoreA, scoreB] = score.split("-").map(Number);
  const realScoreA = winnerTeam === "A" ? scoreA : scoreB;
  const realScoreB = winnerTeam === "A" ? scoreB : scoreA;

  const form = { mode, rule, teamA: activeA, teamB: activeB, winnerTeam, scoreA: realScoreA, scoreB: realScoreB, isRandomMatch };
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
    (matchStarted || inputLocked) &&
    mode === "1v1" &&
    ratingDiffPreview >= GIANT_KILLING_RATING_DIFF &&
    winnerTeam === lowerTeamPreview;
  const isRandomGachiPreview = isRandomMatch && isGachiPreview;
  const setupLocked = inputLocked || matchStarted;
  const resultInputOpen = matchStarted || inputLocked;

  const randomMatchEligibleSets = registeredSets.filter(rating =>
    randomMatchTierSelection.includes(getTier(rating.rating))
  );
  const randomMatchSelectableKeys = new Set(randomMatchEligibleSets.map(rating => rating.key));
  const randomMatchSelectedSets = randomMatchEligibleSets.filter(rating =>
    randomMatchSelectedKeys.includes(rating.key)
  );

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

  useEffect(() => {
    setRandomMatchSelectedKeys(current => current.filter(key => randomMatchSelectableKeys.has(key)));
  }, [randomMatchTierSelection.join("|"), registeredSets.length]);

  function updateMember(team, index, patch) {
    if (setupLocked) return;
    const setter = team === "A" ? setTeamA : setTeamB;
    const current = team === "A" ? teamA : teamB;
    setter(current.map((m, i) => i === index ? { ...m, ...patch } : m));
    if (isRandomMatch) setIsRandomMatch(false);
  }

  function toggleRandomMatchTier(tier) {
    setRandomMatchTierSelection(current =>
      current.includes(tier) ? current.filter(item => item !== tier) : [...current, tier]
    );
  }

  function toggleRandomMatchSet(key) {
    setRandomMatchSelectedKeys(current =>
      current.includes(key) ? current.filter(item => item !== key) : [...current, key]
    );
  }

  function selectAllRandomMatchSets() {
    setRandomMatchSelectedKeys(randomMatchEligibleSets.map(rating => rating.key));
  }

  function cancelRandomMatch() {
    setIsRandomMatch(false);
    setRandomMatchEffect(false);
    setRandomMatchSelectedKeys([]);
  }

  function createRandomMatch() {
    const possiblePairs = [];

    for (let i = 0; i < randomMatchSelectedSets.length; i += 1) {
      for (let j = i + 1; j < randomMatchSelectedSets.length; j += 1) {
        const a = randomMatchSelectedSets[i];
        const b = randomMatchSelectedSets[j];
        if (a.playerId === b.playerId) continue;
        possiblePairs.push([a, b]);
      }
    }

    if (!possiblePairs.length) {
      return alert("同じプレイヤー同士を避けるため、別プレイヤーのセットを2つ以上選択してください。");
    }

    const [first, second] = possiblePairs[Math.floor(Math.random() * possiblePairs.length)];

    setMode("1v1");
    setRule("single");
    setScore("1-0");
    setWinnerTeam("A");
    setTeamA(current => [
      { playerId: first.playerId, characterName: first.characterName },
      current[1] || { playerId: "", characterName: "" }
    ]);
    setTeamB(current => [
      { playerId: second.playerId, characterName: second.characterName },
      current[1] || { playerId: "", characterName: "" }
    ]);
    setInputLocked(false);
    setMatchStarted(false);
    setCompletedMatchId("");
    setRandomPanelOpen(false);
    setIsRandomMatch(true);
    setRandomMatchEffect(true);
    window.setTimeout(() => setRandomMatchEffect(false), 1600);
  }

  function validateMatchSetup() {
    if (isRandomMatch && mode !== "1v1") {
      alert("ランダムマッチは1on1のみです。");
      return false;
    }

    if (!hasEnoughSets) {
      alert(
        `${mode === "2v2"
          ? "2on2には登録済みキャラを持つプレイヤーが4人必要です"
          : "1on1には登録済みキャラを持つプレイヤーが2人必要です"
        }。現在は${uniqueSelectablePlayerCount}人です。`
      );
      return false;
    }

    const ids = [...activeA, ...activeB].map(m => m.playerId);
    const setKeys = [...activeA, ...activeB].map(m => ratingKey(m.playerId, m.characterName));

    if (ids.some(id => !id)) {
      alert("プレイヤー・キャラセットを選んでください。");
      return false;
    }
    if (new Set(ids).size !== ids.length) {
      alert("同じ試合内で同じプレイヤーは重複できません。");
      return false;
    }
    if (new Set(setKeys).size !== setKeys.length) {
      alert("同じプレイヤー・キャラセットは重複できません。");
      return false;
    }
    if ([...activeA, ...activeB].some(member => !getRatingForMember(data, member))) {
      alert("未登録のプレイヤー・キャラが選ばれています。選手とキャラを選び直してください。");
      return false;
    }

    const limitExceeded = dailyLimitRows.find(row => row.count >= row.limit);
    if (limitExceeded) {
      alert(`${limitExceeded.name}さんは今日の${getMatchRuleLabel(rule)}の上限（${limitExceeded.limit}回）に達しています。`);
      return false;
    }

    return true;
  }

  function startMatch() {
    if (setupLocked || saving) return;
    if (!validateMatchSetup()) return;
    setMatchStarted(true);
    setRandomPanelOpen(false);
  }

  function backToSetup() {
    if (inputLocked || saving) return;
    setMatchStarted(false);
  }

  async function submit() {
    if (isSubmitting || inputLocked || saving) return;
    if (!matchStarted) return alert("先に試合開始を押してください。");
    if (!validateMatchSetup()) return;

    setIsSubmitting(true);

    try {
      const next = applyMatch(data, form);
      const newMatch = next.matches[0];
      setCompletedMatchId(newMatch.id);
      setInputLocked(true);
      setMatchStarted(false);
      await commit(next);
    } catch (error) {
      console.error(error);
      alert(error.message || "試合結果の反映に失敗しました。選手とキャラを選び直してください。");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startNextMatch() {
    setInputLocked(false);
    setMatchStarted(false);
    setCompletedMatchId("");
    setIsRandomMatch(false);
  }

  const completedMatchFromData = completedMatchId
    ? data.matches.find(match => match.id === completedMatchId)
    : null;
  const shownResult = completedMatchFromData || (inputLocked ? data.matches[0] : null);
  const shownResultMembers = Array.isArray(shownResult?.members) ? shownResult.members : [];

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
                <button key={value} onClick={() => { setRule(value); if (isRandomMatch) setIsRandomMatch(false); }} disabled={setupLocked} className={classNames("min-h-11 rounded-xl px-4 py-2 text-sm font-black transition disabled:opacity-50", rule === value ? "bg-blue-600 text-white shadow" : "text-blue-700 hover:bg-white")}>{label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-blue-100 bg-blue-50 p-1.5">
              {[["1v1", "1on1"], ["2v2", "2on2"]].map(([value, label]) => (
                <button key={value} onClick={() => { setMode(value); if (isRandomMatch) setIsRandomMatch(false); }} disabled={setupLocked} className={classNames("min-h-11 rounded-xl px-4 py-2 text-sm font-black transition disabled:opacity-50", mode === value ? "bg-blue-600 text-white shadow" : "text-blue-700 hover:bg-white")}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/50 p-4">
          <button
            type="button"
            onClick={() => setRandomPanelOpen(current => !current)}
            disabled={setupLocked}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-left transition hover:bg-indigo-50 disabled:opacity-50"
          >
            <div>
              <div className="text-sm font-black text-indigo-700">ランダムマッチ作成</div>
              <p className="mt-1 text-xs font-bold text-slate-600">通常入力を邪魔しないように折りたたみ式にしています。Tierを選択して1on1を自動作成できます。</p>
            </div>
            <ChevronRight className={classNames("h-5 w-5 shrink-0 text-indigo-600 transition", randomPanelOpen ? "rotate-90" : "")} />
          </button>

          <AnimatePresence initial={false}>
            {(randomPanelOpen || isRandomMatch) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-black text-indigo-700">対象セットを選択</div>
                      <p className="mt-1 text-xs font-bold text-slate-600">ランダムマッチは1on1のみです。レート変動は少し大きくなります。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={selectAllRandomMatchSets} disabled={!randomMatchEligibleSets.length || setupLocked} className="min-h-11 rounded-2xl bg-indigo-600 px-3 py-2 text-xs font-black text-white transition hover:bg-indigo-700 disabled:bg-slate-300">全て選択</button>
                      <button type="button" onClick={() => setRandomMatchSelectedKeys([])} disabled={setupLocked} className="min-h-11 rounded-2xl border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-40">選択解除</button>
                      <button type="button" onClick={cancelRandomMatch} disabled={setupLocked} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">キャンセル</button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {RANDOM_MATCH_TIER_OPTIONS.map(option => (
                      <label key={option.value} className={classNames("flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black transition", randomMatchTierSelection.includes(option.value) ? "border-indigo-500 bg-indigo-600 text-white" : "border-indigo-100 bg-white text-indigo-700 hover:bg-indigo-50")}>
                        <input type="checkbox" checked={randomMatchTierSelection.includes(option.value)} onChange={() => toggleRandomMatchTier(option.value)} disabled={setupLocked} className="accent-indigo-600" />
                        {option.label}
                      </label>
                    ))}
                  </div>

                  <div className="max-h-56 space-y-2 overflow-auto rounded-3xl border border-indigo-100 bg-white p-3">
                    {randomMatchEligibleSets.map(rating => {
                      const player = data.players.find(p => p.id === rating.playerId);
                      return (
                        <label key={rating.key} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-3 py-2 transition hover:bg-blue-50">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" checked={randomMatchSelectedKeys.includes(rating.key)} onChange={() => toggleRandomMatchSet(rating.key)} disabled={setupLocked} className="accent-indigo-600" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-start gap-2 text-sm font-black text-slate-800">
                                <PlayerIdentity data={data} playerId={rating.playerId} name={player?.name || "不明"} rating={rating.rating} />
                                <span className="pt-1">/ {rating.characterName}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <TierBadge rating={rating.rating} />
                            <span className={`text-sm font-black ${getTierTextColor(rating.rating)}`}>{rating.rating}</span>
                          </div>
                        </label>
                      );
                    })}
                    {!randomMatchTierSelection.length && <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50 p-4 text-center text-sm font-bold text-indigo-600">先にTierを選択してください。</div>}
                    {randomMatchTierSelection.length > 0 && !randomMatchEligibleSets.length && <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50 p-4 text-center text-sm font-bold text-indigo-600">対象セットがありません。</div>}
                  </div>

                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="text-xs font-bold text-slate-600">選択中：{randomMatchSelectedSets.length}セット</div>
                    <button type="button" onClick={createRandomMatch} disabled={setupLocked || randomMatchSelectedSets.length < 2} className="min-h-11 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-indigo-950 disabled:bg-slate-300">ランダムに1on1を組む</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {randomMatchEffect && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                className={classNames(
                  "mt-3 rounded-3xl border p-4 text-center text-xl font-black shadow-sm",
                  isRandomGachiPreview
                    ? "border-red-700 bg-black text-red-500 shadow-red-200"
                    : "border-indigo-300 bg-indigo-50 text-indigo-800"
                )}
              >
                 {isRandomGachiPreview ? "ランダムガチマッチ" : "ランダムマッチ"}
              </motion.div>
            )}
          </AnimatePresence>

          {isRandomMatch && (
            <div className={classNames(
              "mt-3 rounded-2xl border px-3 py-2 text-sm font-black",
              isRandomGachiPreview
                ? "border-red-700 bg-black text-red-500 shadow-sm shadow-red-200"
                : "border-indigo-200 bg-indigo-50 text-indigo-800"
            )}>
              この試合は{isRandomGachiPreview ? "ランダムガチマッチ" : "ランダムマッチ"}です。
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <TeamCard title="Team A" team="A" members={activeA} updateMember={updateMember} data={data} registeredSets={registeredSets} disabled={setupLocked} active={resultInputOpen && winnerTeam === "A"} />
          <div className="flex items-center justify-center">
            <div
              className={classNames(
                "rounded-full border px-4 py-2 text-xl font-black shadow-sm transition",
                isRandomGachiPreview
                  ? "border-red-700 bg-black text-red-500 shadow-red-200"
                  : isRandomMatch
                  ? "border-indigo-300 bg-indigo-600 text-white shadow-indigo-200"
                  : isGiantKillingPreview
                    ? "border-yellow-300 bg-yellow-400 text-slate-950 shadow-yellow-200"
                    : isGachiPreview
                    ? "border-red-300 bg-red-600 text-white shadow-red-200"
                    : "border-blue-200 bg-white text-blue-600"
              )}
            >
              {isRandomGachiPreview ? "ランダムガチマッチ VS" : isRandomMatch ? "ランダムマッチ VS" : isGiantKillingPreview ? "ジャイアントキリング対象 VS" : isGachiPreview ? "ガチマッチ VS" : "VS"}
            </div>
          </div>
          <TeamCard title="Team B" team="B" members={activeB} updateMember={updateMember} data={data} registeredSets={registeredSets} disabled={setupLocked} active={resultInputOpen && winnerTeam === "B"} />
        </div>

        {!resultInputOpen ? (
          <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black text-blue-600">準備完了</div>
                <p className="mt-1 text-sm font-bold text-slate-600">対戦相手とルールを確認してから、試合開始を押してください。開始後に勝者とスコアを入力できます。</p>
              </div>
              <button
                type="button"
                onClick={startMatch}
                disabled={!hasEnoughSets || saving}
                className="min-h-11 rounded-2xl bg-slate-950 px-6 py-3 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-950 disabled:bg-slate-300 disabled:shadow-none"
              >
                試合開始
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/70 p-4 md:grid-cols-4">
            <div className="md:col-span-4 rounded-2xl border border-blue-100 bg-white px-4 py-3">
              <div className="text-sm font-black text-blue-600">{inputLocked ? "結果確定済み" : "試合結果入力"}</div>
              <p className="mt-1 text-xs font-bold text-slate-600">{inputLocked ? "次の試合を入力するには、右側のボタンを押してください。" : "試合が終わったら、勝者とスコアを選んで結果を確定してください。"}</p>
            </div>
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
                type="button"
                onClick={backToSetup}
                disabled={inputLocked || saving}
                className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white p-3 font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                開始前に戻る
              </button>
            </div>
            <div className="flex items-end">
              <button
                onClick={submit}
                disabled={!hasEnoughSets || isSubmitting || inputLocked || saving}
                className="min-h-11 w-full rounded-2xl bg-blue-600 p-3 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none"
              >
                {isSubmitting || saving ? "処理中..." : inputLocked ? "確定済み" : "試合結果を確定"}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-blue-100 bg-white p-4">
          <div className="text-sm font-black text-blue-600">本日の上限：{getMatchRuleLabel(rule)}は1人{dailyLimit}回まで</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {dailyLimitRows.map(row => (
              <div key={row.playerId} className={classNames("flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-sm font-bold", row.count >= row.limit ? "border-red-200 bg-red-50 text-red-600" : "border-blue-100 bg-blue-50 text-slate-600")}>
                <PlayerIdentity data={data} playerId={row.playerId} name={row.name} />
                <span className="shrink-0">{row.count}/{row.limit}</span>
              </div>
            ))}
          </div>
        </div>
      </AppShellCard>

      <AppShellCard>
        <div className="flex items-center gap-2 text-blue-600">
          <Medal className="h-5 w-5" />
          <h3 className="text-xl font-black text-slate-950">今回のレート変動</h3>
        </div>
        {!shownResult ? (
          <div className="mt-4 rounded-3xl border border-dashed border-blue-200 bg-blue-50/70 p-5 text-sm font-medium text-slate-500">
            {matchStarted ? "試合結果を確定すると、ここに増減が表示されます。" : "試合開始後、結果を確定するとここに増減が表示されます。"}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm font-bold text-blue-700">{getRandomMatchLabel(shownResult) ? `${getRandomMatchLabel(shownResult)} / ` : ""}{getMatchRuleLabel(inferRuleFromMatch(shownResult))} / {shownResult.mode} / Team {shownResult.winnerTeam} 勝利 / {shownResult.scoreA}-{shownResult.scoreB}</div>
            {shownResult.isRandomMatch && (
              <div className={`rounded-3xl border p-4 text-sm font-black ${getRandomMatchBadgeClass(shownResult)}`}>
                 {getRandomMatchLabel(shownResult)}
              </div>
            )}
            {getGiantKillingFromMatch(shownResult) && (
              <div className="rounded-3xl border border-yellow-300 bg-yellow-50 p-4 text-sm font-black text-yellow-800 shadow-sm">
                ⚔️ ジャイアントキリング！ レート差{getGiantKillingFromMatch(shownResult).ratingDiff}。補正値{getGiantKillingFromMatch(shownResult).bonus}を勝者にプラス、敗者にマイナスしました。
              </div>
            )}
            {shownResult.milestoneMessages?.length > 0 && (
              <div className="space-y-2">
                {shownResult.milestoneMessages.map(item => (
                  <div key={item.id} className="rounded-3xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-black text-yellow-800 shadow-sm">
                    <div className="flex flex-wrap items-start gap-2">
                      <span>🎉</span>
                      <PlayerIdentity data={data} playerId={item.playerId} name={item.playerName} rating={item.ratingAfter} />
                      {item.kind === "playerRank" ? (
                        <span className="pt-1">
                          : {item.message}
                          {item.giftUrl && (
                            <a
                              href={item.giftUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 rounded-full bg-yellow-200 px-2 py-0.5 text-yellow-900 underline underline-offset-2 transition hover:bg-yellow-300"
                            >
                              AmazonギフトURL
                            </a>
                          )}
                          （Player Rate {item.ratingAfter}）
                        </span>
                      ) : (
                        <span className="pt-1">/ {item.characterName}: {item.message}！（{item.ratingAfter}）</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {shownResultMembers.map(member => (
              <div key={member.id} className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-start gap-2 font-black text-slate-900">
                      <PlayerName data={data} id={member.playerId} />
                      <span className="pt-1">/ {member.characterName}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs font-bold text-slate-500">{member.ratingBefore} → {member.ratingAfter} <TierBadge rating={member.ratingAfter} /></div>
                    {member.losingStreakPenalty > 0 && (
                      <div className="mt-1 text-xs font-black text-red-500">連敗補正 -{member.losingStreakPenalty}</div>
                    )}
                  </div>
                  <ChangeBadge change={member.ratingChange} />
                </div>
              </div>
            ))}
            {shownResultMembers.length === 0 && (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-black text-red-600">
                レート変動データを取得できませんでした。Supabaseから再読み込みしてください。
              </div>
            )}
            <div className="flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm font-bold">
              <span className="text-slate-600">合計増減</span>
              <ChangeBadge change={shownResultMembers.reduce((sum, member) => sum + member.ratingChange, 0)} />
            </div>
            <button onClick={startNextMatch} className="min-h-11 w-full rounded-2xl bg-slate-950 p-3 font-black text-white transition hover:bg-blue-950">次の試合を入力する</button>
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
  const [selectedRatingKey, setSelectedRatingKey] = useState("");
  const [tierAtLeastFilter, setTierAtLeastFilter] = useState("all");
  const [tierExactFilter, setTierExactFilter] = useState("all");
  const filteredRanking = useMemo(() => {
    return ranking.filter(rating =>
      isRatingAtLeastTier(rating.rating, tierAtLeastFilter) &&
      isRatingExactTier(rating.rating, tierExactFilter)
    );
  }, [ranking, tierAtLeastFilter, tierExactFilter]);
  const selectedRating = useMemo(() => {
    return filteredRanking.find(r => r.key === selectedRatingKey) || null;
  }, [filteredRanking, selectedRatingKey]);

  return (
    <div className="space-y-5">
      <AppShellCard>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-blue-600"><Trophy className="h-5 w-5" /><p className="text-sm font-black uppercase tracking-wider">Ranking Board</p></div>
            <h2 className="mt-1 text-3xl font-black text-slate-950">キャラ別ランキング</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              プレイヤー名・キャラ名をクリックすると、レート推移グラフを表示します。
            </p>
          </div>
        </div>

        {selectedRating && (
          <div className="mt-5">
            <RatingHistoryChart
              data={data}
              rating={selectedRating}
              onClose={() => setSelectedRatingKey("")}
            />
          </div>
        )}

        <div className="mt-5 rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-black text-slate-600">Tier以上で表示</span>
              <select value={tierAtLeastFilter} onChange={e => setTierAtLeastFilter(e.target.value)} className="w-full rounded-2xl border border-blue-100 bg-white p-3 font-bold text-slate-800 outline-none focus:border-blue-400">
                {TIER_FILTER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.value === "all" ? "すべて" : `${option.label}以上`}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-black text-slate-600">Tierごとに絞る</span>
              <select value={tierExactFilter} onChange={e => setTierExactFilter(e.target.value)} className="w-full rounded-2xl border border-blue-100 bg-white p-3 font-bold text-slate-800 outline-none focus:border-blue-400">
                {TIER_FILTER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.value === "all" ? "すべて" : option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 text-xs font-bold text-slate-500">表示中：{filteredRanking.length}セット / 全{ranking.length}セット</div>
        </div>

        <div className="mt-5 rounded-[1.75rem] border border-blue-100 bg-gradient-to-b from-blue-50 to-white p-4">
          <div className="space-y-3">
            {filteredRanking.map((r, i) => {
              const pct = Math.max(6, Math.min(100, (r.rating / maxRating) * 100));
              const isSelected = selectedRatingKey === r.key;
              return (
                <div key={r.key} className={classNames("rounded-3xl border bg-white p-4 shadow-sm", isSelected ? "border-blue-400 ring-2 ring-blue-100" : "border-blue-100")}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-sm font-black text-white">#{i + 1}</div>
                      <button
                        type="button"
                        onClick={() => setSelectedRatingKey(current => current === r.key ? "" : r.key)}
                        className="min-w-0 rounded-2xl p-1 text-left transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
                        title="成績グラフを表示"
                      >
                        <SetLabel data={data} rating={r} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <TierBadge rating={r.rating} large />
                      <div className={`text-2xl font-black ${getTierTextColor(r.rating)}`}>{r.rating}</div>
                      <div className="hidden rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600 md:inline-flex">
                        クリックで詳細
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 h-4 overflow-hidden rounded-full border border-blue-100 bg-slate-100">
                    <div className={`h-full rounded-full ${getTierBarColor(r.rating)}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {!filteredRanking.length && <div className="rounded-3xl border border-dashed border-blue-200 bg-white p-8 text-center font-bold text-slate-400">条件に合う登録セットがありません。</div>}
          </div>
        </div>
      </AppShellCard>

      <AppShellCard>
        <div className="flex items-center gap-2 text-blue-600"><Users className="h-5 w-5" /><h2 className="text-2xl font-black text-slate-950">プレイヤー総合ランキング</h2></div>
        <p className="mt-1 text-sm font-medium text-slate-500">3キャラ以上登録しているプレイヤーのみ表示。登録キャラすべての平均レートで順位を付けます。</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {totalRanking.map((item, i) => {
            const pct = Math.max(6, Math.min(100, (item.avg / maxRating) * 100));
            return (
              <div key={item.player.id} className="rounded-3xl border border-blue-200 bg-white p-4 shadow-md shadow-blue-100/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-blue-500">#{i + 1}</div>
                    <PlayerIdentity data={data} playerId={item.player.id} name={item.player.name} rating={item.avg} rankFeatured rankPanel nameClassName="text-xl" />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{item.characterCount}キャラ平均</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">勝率 {getWinRateText(item.wins, item.matches)}</span>
                    </div>
                    <div className="mt-2 text-xs font-semibold text-slate-400">{item.sets.map(r => `${r.characterName}:${r.rating}`).join(" / ")}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-2xl font-black ${getTierTextColor(item.avg)}`}>{item.avg}</div>
                    <div className="mt-1 text-[11px] font-black uppercase tracking-wider text-slate-400">Player Rate</div>
                  </div>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${getTierBarColor(item.avg)}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {!totalRanking.length && (
            <div className="rounded-3xl border border-dashed border-blue-200 bg-white p-8 text-center font-bold text-slate-400 md:col-span-2">
              3キャラ以上登録しているプレイヤーがまだいません。
            </div>
          )}
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
          <button onClick={addPlayer} disabled={saving} className="min-h-11 rounded-2xl bg-blue-600 px-5 font-black text-white shadow-lg shadow-blue-200 disabled:bg-slate-300">追加</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {activePlayers.map(player => (
            <div key={player.id} className="flex items-center justify-between rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
              <div>
                <PlayerIdentity data={data} playerId={player.id} name={player.name} rating={getBestRatingForPlayer(data, player.id)} />
                <div className="text-xs font-bold text-slate-400">登録済み</div>
              </div>
              <button onClick={() => deletePlayer(player.id)} disabled={saving} className="min-h-11 min-w-11 rounded-2xl p-2 text-red-500 transition hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>

        {deletedPlayers.length > 0 && (
          <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-black text-amber-700">削除済みプレイヤー</div>
            <div className="mt-3 space-y-2">
              {deletedPlayers.map(player => (
                <div key={player.id} className="flex items-center justify-between rounded-2xl bg-white p-3">
                  <PlayerIdentity data={data} playerId={player.id} name={player.name} />
                  <div className="flex gap-2">
                    <button onClick={() => restorePlayer(player.id)} disabled={saving} className="min-h-11 rounded-xl bg-amber-400 px-3 py-2 text-sm font-black text-slate-950 disabled:opacity-40">復元</button>
                    <button onClick={() => hardDeletePlayer(player.id)} disabled={saving} className="min-h-11 rounded-xl bg-red-600 px-3 py-2 text-sm font-black text-white disabled:opacity-40">完全削除</button>
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
          <button onClick={addCharacterSet} disabled={saving || !activePlayers.length} className="min-h-11 rounded-2xl bg-slate-950 px-5 font-black text-white disabled:bg-slate-300">セット追加</button>
        </div>

        <div className="mt-5 max-h-[520px] space-y-3 overflow-auto pr-1">
          {registeredSets.map(r => (
            <div key={r.key} className="flex items-center justify-between gap-3 rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <div className="flex min-w-0 items-start gap-2 font-black text-slate-950"><PlayerIdentity data={data} playerId={r.playerId} name={data.players.find(p => p.id === r.playerId)?.name || "不明"} rating={r.rating} /> <span className="pt-1">/ {r.characterName}</span></div>
                <div className="mt-1 text-xs font-bold text-slate-400">Rate {r.rating} / {r.wins}-{r.losses} / {r.matches} matches</div>
              </div>
              <div className="flex items-center gap-2">
                <TierBadge rating={r.rating} />
                <button onClick={() => deleteCharacterSet(r.key)} disabled={saving} className="min-h-11 min-w-11 rounded-2xl p-2 text-red-500 transition hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
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
        <button onClick={handleUndoLatest} disabled={!data.matches.length || saving} className="flex items-center justify-center gap-2 min-h-11 rounded-2xl bg-amber-400 px-4 py-3 font-black text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"><RotateCcw className="h-4 w-4" />直前の試合を取り消す</button>
      </div>

      <div className="mt-5 space-y-3">
        {data.matches.map(match => {
          const giantKilling = getGiantKillingFromMatch(match);

          return (
            <div key={match.id} className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-black text-slate-950">{getRandomMatchLabel(match) ? `${getRandomMatchLabel(match)} / ` : ""}{getMatchRuleLabel(inferRuleFromMatch(match))} / {match.mode} / Team {match.winnerTeam} 勝利 / {match.scoreA}-{match.scoreB}</div>
                  <div className="mt-1 text-sm font-bold text-slate-400">{new Date(match.createdAt).toLocaleString()}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {match.isRandomMatch && (
                      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${getRandomMatchBadgeClass(match)}`}>
                        {getRandomMatchLabel(match)}
                      </div>
                    )}
                    {giantKilling && (
                      <div className="inline-flex rounded-full border border-yellow-300 bg-yellow-50 px-3 py-1 text-xs font-black text-yellow-800">
                        ⚔️ ジャイアントキリング！ レート差{giantKilling.ratingDiff} / 補正{giantKilling.bonus}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDeleteMatch(match.id)} disabled={saving} className="flex items-center justify-center gap-2 min-h-11 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:opacity-40">
                  <Trash2 className="h-4 w-4" />この試合を取り消す
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {match.members.map(m => (
                  <div key={m.id} className="flex justify-between rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                    <div className="flex flex-wrap items-start gap-2 font-bold text-slate-700">
                      <PlayerName data={data} id={m.playerId} />
                      <span className="pt-1">/ {m.characterName}</span>
                    </div>
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

function Stats({ data, ranking, totalRanking = [], refreshData, saving }) {
  const totalMatches = data.matches.length;
  const totalPlayers = activePlayersOf(data).length;
  const activeCharacters = data.ratings.length;
  const top = ranking[0];
  const [openSpecGroup, setOpenSpecGroup] = useState("rating");

  const specGroups = [
    {
      id: "data",
      title: "保存・データ",
      items: [
        "保存先：Supabase",
        "レート単位：プレイヤー × キャラ",
        "削除したプレイヤーは復元可能",
        "キャラ登録：1人5体まで"
      ]
    },
    {
      id: "match",
      title: "試合形式・制限",
      items: [
        "形式：1on1 / 2on2",
        "ルール：1勝制がメイン。2勝制も選択可能",
        "1勝制：レート変動は2勝制の半分",
        "1日上限：1勝制30回、2勝制15回",
        "2on2：チーム平均レートで計算"
      ]
    },
    {
      id: "rating",
      title: "レート計算",
      items: [
        "勝利：レートプラス",
        "敗北：必ずマイナス",
        "2-0勝利：2勝制のみ変動1.1倍",
        "3連勝以上：勝者だけ連勝ボーナス。上限は1.5倍",
        "ガチマッチ：1on1で両者1700超えなら変動1.2倍",
        "変動上限：個人戦±100、チーム戦±50。ただしジャイアントキリング補正は上限突破",
        "ジャイアントキリング：1on1でレート差200以上の低レート側勝利時、レート変動が激しくなる。"
      ]
    },
    {
      id: "ranking",
      title: "ランキング・Tier",
      items: [
        "ランキング：Tier以上表示・Tierごとの絞り込みに対応",
        "ランダムマッチ：Tier選択→セット複数選択→1on1を自動作成。両者1700超えならランダムガチマッチ表示になります",
        "ランキング：プレイヤー名・キャラ名クリックでレート推移グラフ表示",
        "プレイヤー総合：3キャラ以上登録しているプレイヤーのみ表示。",
        "ランク：Master 2000+ / Diamond 1900+ / Ruby 1800+ / Sapphire 1700+ / Platinum 1600+ / Gold 1550+ / Silver 1450+ / Bronze 1400+ / Iron 1400以下",
        "ティア：SSS 2200+ / SS 2000+ / S 1800+ / A 1600+ / B 1400+ / C 1200+ / D 1001-1199 / E 1000以下"
      ]
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard label="プレイヤー数" value={totalPlayers} />
      <StatCard label="試合数" value={totalMatches} />
      <StatCard label="登録キャラレート" value={activeCharacters} />
      <StatCard label="最高レート" value={top ? top.rating : INITIAL_RATING} />

      <AppShellCard className="md:col-span-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">概要</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">よく見る数値を上に置き、細かい仕様はカテゴリごとに折りたたみました。</p>
          </div>
          <button onClick={refreshData} disabled={saving} className="min-h-11 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-40">Supabaseから再読み込み</button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
            <div className="text-xs font-black uppercase tracking-wider text-blue-500">Top Character</div>
            <div className="mt-2 text-xl font-black text-slate-950">{top ? top.characterName : "未登録"}</div>
            <div className="mt-1 text-sm font-bold text-slate-600">{top ? `${top.rating} / ${getTier(top.rating)}` : "データなし"}</div>
          </div>
          <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
            <div className="text-xs font-black uppercase tracking-wider text-blue-500">Player Ranking</div>
            <div className="mt-2 text-xl font-black text-slate-950">{totalRanking.length}人</div>
            <div className="mt-1 text-sm font-bold text-slate-600">3キャラ以上登録済みの総合ランキング対象</div>
          </div>
          <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-4">
            <div className="text-xs font-black uppercase tracking-wider text-blue-500">Average Matches</div>
            <div className="mt-2 text-xl font-black text-slate-950">{activeCharacters ? (data.ratings.reduce((sum, rating) => sum + rating.matches, 0) / activeCharacters).toFixed(1) : "0.0"}</div>
            <div className="mt-1 text-sm font-bold text-slate-600">登録キャラ1体あたりの平均試合数</div>
          </div>
        </div>
      </AppShellCard>

      <AppShellCard className="md:col-span-4">
        <h2 className="text-2xl font-black text-slate-950">現在の仕様</h2>
        <div className="mt-4 space-y-3">
          {specGroups.map(group => {
            const open = openSpecGroup === group.id;
            return (
              <div key={group.id} className="rounded-3xl border border-blue-100 bg-blue-50/60 p-3">
                <button
                  type="button"
                  onClick={() => setOpenSpecGroup(current => current === group.id ? "" : group.id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 text-left font-black text-slate-800 transition hover:bg-blue-50"
                >
                  {group.title}
                  <ChevronRight className={classNames("h-5 w-5 shrink-0 text-blue-500 transition", open ? "rotate-90" : "")} />
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 grid gap-3 text-sm font-bold text-slate-700 md:grid-cols-2">
                        {group.items.map(item => <Spec key={item} text={item} />)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </AppShellCard>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-3xl border border-blue-200/80 bg-white/95 p-5 shadow-xl shadow-blue-950/20 backdrop-blur">
      <div className="text-sm font-black uppercase tracking-wider text-blue-600">{label}</div>
      <div className="mt-2 text-4xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function Spec({ text }) {
  return <div className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-3"><ChevronRight className="h-4 w-4 shrink-0 text-blue-500" />{text}</div>;
}
