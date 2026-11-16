import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signInWithCustomToken, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, onDisconnect, onValue, ref, set, update, get, runTransaction, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCs65B8IwKAqLxbTuDGPjV_-uX9bVUJeTM",
  authDomain: "kill-tracker-e3083.firebaseapp.com",
  projectId: "kill-tracker-e3083",
  databaseURL: "https://kill-tracker-e3083-default-rtdb.firebaseio.com",
  appId: "1:888950181547:web:2349883ef1a2d82e0631ee"
};

export const DISCORD_CLIENT_ID = "1570639449400942692";

const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getDatabase(app, FIREBASE_CONFIG.databaseURL);
export { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithCustomToken, signInAnonymously, signOut, onDisconnect, onValue, ref, set, update, get, runTransaction, remove };

export function getCanonicalRedirectUri() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/index.html";
  }
  return url.toString();
}

export function startDiscordOAuth() {
  const redirectUri = encodeURIComponent(getCanonicalRedirectUri());
  window.location.assign(`https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=token&scope=identify`);
}

export function extractDiscordTokenFromUrl() {
  const hashStr = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
  if (!hashStr) return null;
  const params = new URLSearchParams(hashStr);
  return params.get("access_token");
}

export function calculateChallengePoints({ eliminations, timeLimitMinutes, noTimeLimit, requireMatchEnd, maxDeaths, characterRequirement }) {
  const elims = Math.max(1, Math.floor(Number(eliminations) || 1));
  const mins = Math.max(1, Math.floor(Number(timeLimitMinutes) || 30));

  let base = 0;
  if (requireMatchEnd) {
    base = Math.ceil(elims * 2.5);
  } else if (noTimeLimit) {
    base = elims;
  } else {
    base = Math.ceil((elims * 60) / mins);
  }

  let bonusMultiplier = 1.0;

  if (maxDeaths !== null && maxDeaths !== undefined && maxDeaths !== "" && Number.isFinite(Number(maxDeaths))) {
    const d = Math.max(0, Math.floor(Number(maxDeaths)));
    if (d === 0) bonusMultiplier += 0.50;
    else if (d === 1) bonusMultiplier += 0.35;
    else if (d === 2) bonusMultiplier += 0.25;
    else if (d <= 5) bonusMultiplier += 0.15;
    else bonusMultiplier += 0.05;
  }

  if (String(characterRequirement || "").trim().length > 0) {
    bonusMultiplier += 0.25;
  }

  let total = Math.max(1, Math.round(base * bonusMultiplier));

  if (requireMatchEnd) {
    const fifteenMinEquivalent = Math.round(Math.ceil((elims * 60) / 15) * bonusMultiplier);
    if (total >= fifteenMinEquivalent) {
      total = Math.max(1, fifteenMinEquivalent - 1);
    }
  }

  return total;
}

export async function getAllUsers() {
  const snap = await get(ref(db, "users"));
  if (!snap.exists()) return {};
  const raw = snap.val();
  const normalized = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val && typeof val === "object") {
      normalized[key] = { recordKey: key, uid: val.uid || key, ...val };
    }
  }
  return normalized;
}

export async function getUserRecord(uid) {
  if (!uid) return null;
  const clean = String(uid).trim();
  const users = await getAllUsers();
  if (users[clean]) return users[clean];
  return Object.values(users).find(u =>
    u.uid === clean ||
    u.authUid === clean ||
    String(u.discordId || "").trim() === clean ||
    `discord_${String(u.discordId || "").trim()}` === clean
  ) || null;
}

export async function getUserRecordByDiscordId(discordId) {
  if (!discordId) return null;
  const cleanId = String(discordId).trim().replace(/^discord_/i, "");
  const users = await getAllUsers();
  return Object.values(users).find(u => String(u.discordId || "").trim() === cleanId) || null;
}

export async function getGameCatalog() {
  const snap = await get(ref(db, "leaderboards"));
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.entries(data).map(([id, board]) => ({
    id,
    name: board.name || id
  }));
}

export function normalizeRowsFromBoard(board) {
  if (!board) return [];
  if (Array.isArray(board.rows) && board.rows.length) {
    return board.rows;
  }
  if (board.players && typeof board.players === "object") {
    const entries = Object.values(board.players);
    entries.sort((a, b) => {
      const pa = Number(a.placement) || 0;
      const pb = Number(b.placement) || 0;
      if (pa && pb) return pa - pb;
      if (pa) return -1;
      if (pb) return 1;
      return (Number(b.eliminations) || 0) - (Number(a.eliminations) || 0);
    });
    return entries.map((p, idx) => [
      p.image || "",
      Number(p.eliminations) || 0,
      p.leaderboardName || p.name || "",
      p.gameUsername || "",
      p.character || p.mvp || "",
      Boolean(p.active),
      Number(p.placement) || (idx + 1)
    ]);
  }
  return [];
}

function computeOverallEliminationsFromBoards(gameAccounts, boards) {
  if (!gameAccounts || typeof gameAccounts !== "object" || !boards) return 0;
  let total = 0;
  for (const [gameTitle, username] of Object.entries(gameAccounts)) {
    if (!username) continue;
    const cleanUser = String(username).trim().toLowerCase();
    const board = Object.values(boards).find(
      b => String(b.name || "").trim().toLowerCase() === String(gameTitle).trim().toLowerCase()
    );
    if (!board) continue;
    const rows = normalizeRowsFromBoard(board);
    for (const row of rows) {
      if (String(row[3] || "").trim().toLowerCase() === cleanUser) {
        total += Number(row[1]) || 0;
      }
    }
  }
  return total;
}

export async function computeOverallEliminations(gameAccounts) {
  if (!gameAccounts || typeof gameAccounts !== "object") return 0;
  const snap = await get(ref(db, "leaderboards"));
  if (!snap.exists()) return 0;
  return computeOverallEliminationsFromBoards(gameAccounts, snap.val());
}

export async function resolveLeaderboardIdentity(gameAccounts, preferredGameTitle = "", fallbackName = "Player", fallbackImage = "") {
  if (!gameAccounts || typeof gameAccounts !== "object") return { name: fallbackName, image: fallbackImage };
  const snap = await get(ref(db, "leaderboards"));
  if (!snap.exists()) return { name: fallbackName, image: fallbackImage };
  const boards = snap.val();
  const titles = Object.keys(gameAccounts);
  if (preferredGameTitle && gameAccounts[preferredGameTitle]) {
    titles.splice(titles.indexOf(preferredGameTitle), 1);
    titles.unshift(preferredGameTitle);
  }
  for (const gameTitle of titles) {
    const username = String(gameAccounts[gameTitle] || "").trim().toLowerCase();
    if (!username) continue;
    const board = Object.values(boards).find(
      b => String(b.name || "").trim().toLowerCase() === String(gameTitle).trim().toLowerCase()
    );
    if (!board) continue;
    const rows = normalizeRowsFromBoard(board);
    const match = rows.find(r => String(r[3] || "").trim().toLowerCase() === username);
    if (match) {
      return {
        name: String(match[2] || fallbackName).trim(),
        image: String(match[0] || fallbackImage).trim()
      };
    }
  }
  return { name: fallbackName, image: fallbackImage };
}

function getTelemetryForUser(userRecord, telemetryByGame, boards) {
  const accounts = userRecord?.gameAccounts || {};
  let best = null;

  for (const [gameTitle, rawUsername] of Object.entries(accounts)) {
    const cleanUser = String(rawUsername || "").trim().toLowerCase();
    if (!cleanUser) continue;

    const boardEntry = Object.entries(boards || {}).find(
      ([, b]) => String(b.name || "").trim().toLowerCase() === gameTitle.trim().toLowerCase()
    );
    const boardId = boardEntry ? boardEntry[0] : null;
    const safeKey = cleanUser.replace(/[.#$\[\]\/]/g, "_");

    const gameTelemetry = boardId && telemetryByGame?.[boardId] ? telemetryByGame[boardId] : null;
    const entry = gameTelemetry?.[safeKey] || Object.values(gameTelemetry || {}).find(
      t => String(t?.gameUsername || "").trim().toLowerCase() === cleanUser
    );

    if (entry && (!best || Number(entry.updatedAt || 0) > Number(best.updatedAt || 0))) {
      best = entry;
    }
  }
  return best;
}

/**
 * Evaluates all active/open challenges against current leaderboard eliminations,
 * Overwolf gameTelemetry (deaths, character, matchActive), and expiration deadlines.
 * Marks participants & challenges as "completed" or "failed" and awards points.
 */
export async function evaluateActiveChallenges() {
  const [challengesSnap, usersSnap, boardsSnap, telemetrySnap] = await Promise.all([
    get(ref(db, "challenges")),
    get(ref(db, "users")),
    get(ref(db, "leaderboards")),
    get(ref(db, "gameTelemetry"))
  ]);

  if (!challengesSnap.exists()) return;
  const challenges = challengesSnap.val() || {};
  const users = usersSnap.exists() ? usersSnap.val() : {};
  const boards = boardsSnap.exists() ? boardsSnap.val() : {};
  const telemetryByGame = telemetrySnap.exists() ? telemetrySnap.val() : {};
  const now = Date.now();

  for (const [challengeId, challenge] of Object.entries(challenges)) {
    if (!challenge || ["completed", "failed", "denied", "abandoned", "expired"].includes(challenge.status)) {
      continue;
    }

    const participants = challenge.participants || {};
    const updates = {};
    let changed = false;

    // Expire unaccepted open/pending challenges past invitation window
    const hasAnyActiveOrDone = Object.values(participants).some(p =>
      ["active", "completed", "failed"].includes(p?.status)
    );
    if (!hasAnyActiveOrDone && Number(challenge.invitationExpiresAt) && now > Number(challenge.invitationExpiresAt)) {
      updates.status = "expired";
      updates.updatedAt = now;
      await update(ref(db, `challenges/${challengeId}`), updates);
      continue;
    }

    const goalElims = Math.max(1, Number(challenge.eliminations) || 1);
    const maxDeaths = challenge.maxDeaths !== null && challenge.maxDeaths !== undefined && challenge.maxDeaths !== ""
      ? Number(challenge.maxDeaths)
      : null;
    const reqChar = String(challenge.characterRequirement || "").trim().toLowerCase();

    for (const [pKey, pData] of Object.entries(participants)) {
      if (!pData || pData.status !== "active") continue;

      const userRec = users[pKey] || Object.values(users).find(
        u => u && (u.uid === pKey || u.recordKey === pKey || `discord_${u.discordId}` === pKey)
      );
      if (!userRec) continue;

      const currentTotalElims = computeOverallEliminationsFromBoards(userRec.gameAccounts, boards);
      const startElims = Number(pData.startingEliminations ?? currentTotalElims);
      const progress = Math.max(0, currentTotalElims - startElims);

      const telem = getTelemetryForUser(userRec, telemetryByGame, boards);
      const acceptedAt = Number(pData.acceptedAt || challenge.startedAt || challenge.createdAt || 0);
      const telemIsFresh = telem && Number(telem.updatedAt || 0) >= acceptedAt - 2000;

      const currentDeaths = telemIsFresh ? (Number(telem.deaths) || 0) : (Number(pData.deaths) || 0);
      const startDeaths = Number(pData.startingDeaths ?? (telemIsFresh ? currentDeaths : 0));
      const deathsSinceStart = Math.max(0, currentDeaths - startDeaths);

      if (pData.startingDeaths === undefined && telemIsFresh) {
        updates[`participants/${pKey}/startingDeaths`] = startDeaths;
        changed = true;
      }

      if (progress !== Number(pData.progress || 0) || currentTotalElims !== Number(pData.lastTotal || 0)) {
        updates[`participants/${pKey}/progress`] = progress;
        updates[`participants/${pKey}/lastTotal`] = currentTotalElims;
        updates[`participants/${pKey}/updatedAt`] = now;
        changed = true;
      }

      if (deathsSinceStart !== Number(pData.deaths || 0)) {
        updates[`participants/${pKey}/deaths`] = deathsSinceStart;
        updates[`participants/${pKey}/updatedAt`] = now;
        changed = true;
      }

      let failedReason = null;

      // 1. Check Character Requirement
      if (reqChar && telemIsFresh && telem.character) {
        const playedChar = String(telem.character).trim().toLowerCase();
        if (playedChar && playedChar !== reqChar) {
          failedReason = `Played ${telem.character} instead of ${challenge.characterRequirement}`;
        }
      }

      // 2. Check Max Deaths
      if (!failedReason && maxDeaths !== null && Number.isFinite(maxDeaths) && deathsSinceStart > maxDeaths) {
        failedReason = `Exceeded max deaths (${deathsSinceStart}/${maxDeaths})`;
      }

      // 3. Check Time Limit Deadline
      if (!failedReason && Number(pData.deadline) && now > Number(pData.deadline) && progress < goalElims) {
        failedReason = "Time limit expired";
      }

      // 4. Check Match End Requirement
      if (!failedReason && challenge.requireMatchEnd && telem && Number(telem.matchEndedAt || 0) > acceptedAt && telem.matchActive === false && progress < goalElims) {
        failedReason = "Match ended before reaching goal";
      }

      if (failedReason) {
        updates[`participants/${pKey}/status`] = "failed";
        updates[`participants/${pKey}/failReason`] = failedReason;
        updates[`participants/${pKey}/updatedAt`] = now;
        changed = true;
      } else if (progress >= goalElims) {
        updates[`participants/${pKey}/status`] = "completed";
        updates[`participants/${pKey}/completedAt`] = now;
        updates[`participants/${pKey}/updatedAt`] = now;
        changed = true;

        // Award points if not yet awarded to this participant
        if (!pData.pointsAwarded) {
          updates[`participants/${pKey}/pointsAwarded`] = true;
          const targetUserKey = userRec.recordKey || pKey;
          const reward = Number(challenge.rewardPoints) || 0;
          const wagerBonus = challenge.mode === "1v1" && challenge.wagerEscrowed ? (Number(challenge.wagerPoints) || 0) * 2 : 0;
          const totalAward = reward + wagerBonus;
          if (totalAward > 0) {
            await runTransaction(ref(db, `users/${targetUserKey}/challengePoints`), pts => (Number(pts) || 0) + totalAward);
          }
        }
      }
    }

    // Re-evaluate overall challenge status
    const mergedParticipants = { ...participants };
    for (const [k, v] of Object.entries(updates)) {
      const m = k.match(/^participants\/([^/]+)\/(.+)$/);
      if (m) {
        mergedParticipants[m[1]] = { ...(mergedParticipants[m[1]] || {}), [m[2]]: v };
      }
    }

    const pValues = Object.values(mergedParticipants);
    const anyCompleted = pValues.some(p => p.status === "completed");
    const anyPendingOrActive = pValues.some(p => ["pending", "active", "waiting"].includes(p.status));

    if (challenge.mode === "1v1" && anyCompleted) {
      const winnerEntry = Object.entries(mergedParticipants).find(([, p]) => p.status === "completed");
      updates.status = "completed";
      updates.winnerId = winnerEntry ? winnerEntry[0] : "";
      updates.completedAt = now;
      for (const [otherKey, otherP] of Object.entries(mergedParticipants)) {
        if (otherP.status === "active") {
          updates[`participants/${otherKey}/status`] = "failed";
          updates[`participants/${otherKey}/failReason`] = "Opponent finished first";
          updates[`participants/${otherKey}/updatedAt`] = now;
        }
      }
      changed = true;
    } else if (!anyPendingOrActive && pValues.length > 0) {
      if (anyCompleted) {
        updates.status = "completed";
        updates.completedAt = now;
      } else if (pValues.some(p => p.status === "failed")) {
        updates.status = "failed";
        updates.failedAt = now;
      }
      changed = true;
    }

    if (changed) {
      await update(ref(db, `challenges/${challengeId}`), updates);
    }
  }
}

let challengeTrackerInitialized = false;
export function startChallengeTracker() {
  if (challengeTrackerInitialized) return;
  challengeTrackerInitialized = true;

  onValue(ref(db, "leaderboards"), () => { evaluateActiveChallenges().catch(() => {}); });
  onValue(ref(db, "gameTelemetry"), () => { evaluateActiveChallenges().catch(() => {}); });
  window.setInterval(() => { evaluateActiveChallenges().catch(() => {}); }, 10000);
}

export async function runFirebaseChallengeAction(currentUser, userRecord, action, payload = {}) {
  const actorKey = userRecord?.recordKey || userRecord?.uid || currentUser?.uid;
  if (!actorKey) throw new Error("Unable to identify your user account.");

  const myIdentity = await resolveLeaderboardIdentity(
    userRecord.gameAccounts,
    payload.gameTitle,
    userRecord.leaderboardName || "Player",
    userRecord.profileImageUrl || userRecord.profileImage || ""
  );

  if (action === "profile") {
    const users = await getAllUsers();
    const targetGame = String(payload.gameTitle || "").trim().toLowerCase();
    const targetUser = String(payload.gameUsername || "").trim().toLowerCase();
    const matchedEntry = Object.values(users).find(u => {
      const accs = u.gameAccounts || {};
      return Object.entries(accs).some(
        ([g, un]) => g.trim().toLowerCase() === targetGame && String(un).trim().toLowerCase() === targetUser
      );
    });
    if (!matchedEntry) throw new Error("That player is not linked to an approved user account.");
    const targetIdentity = await resolveLeaderboardIdentity(
      matchedEntry.gameAccounts,
      payload.gameTitle,
      matchedEntry.leaderboardName || payload.gameUsername,
      matchedEntry.profileImageUrl || matchedEntry.profileImage || ""
    );
    const overallEliminations = await computeOverallEliminations(matchedEntry.gameAccounts);
    return {
      actorId: matchedEntry.recordKey,
      name: targetIdentity.name || payload.gameUsername,
      image: targetIdentity.image || "",
      overallEliminations,
      challengePoints: Math.max(0, Number(matchedEntry.challengePoints) || 0),
      currentChallengePoints: Math.max(0, Number(userRecord.challengePoints) || 0),
      gameUsername: payload.gameUsername,
      gameTitle: payload.gameTitle
    };
  }

  if (action === "create") {
    const title = String(payload.title || "").trim().slice(0, 60);
    const eliminations = Math.floor(Number(payload.eliminations));
    const requireMatchEnd = Boolean(payload.requireMatchEnd);
    const noTimeLimit = requireMatchEnd ? false : Boolean(payload.noTimeLimit);
    const timeLimitMinutes = (noTimeLimit || requireMatchEnd) ? 0 : Math.floor(Number(payload.timeLimitMinutes));

    const maxDeaths = payload.maxDeaths !== undefined && payload.maxDeaths !== "" && payload.maxDeaths !== null
      ? Math.max(0, Math.floor(Number(payload.maxDeaths)))
      : null;
    const characterRequirement = String(payload.characterRequirement || "").trim();

    if (!title) throw new Error("Enter a challenge title.");
    if (!Number.isInteger(eliminations) || eliminations < 1 || eliminations > 1000) {
      throw new Error("Choose between 1 and 1,000 eliminations.");
    }
    if (!noTimeLimit && !requireMatchEnd && (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 1440)) {
      throw new Error("Choose a time limit from 1 minute to 24 hours.");
    }

    const isGroup = payload.mode === "group";
    const isDuel = payload.mode === "1v1";
    const wagerPoints = isDuel ? Math.max(0, Math.floor(Number(payload.wagerPoints) || 0)) : 0;
    const users = await getAllUsers();
    let targets = [];

    if (isGroup) {
      const presenceSnap = await get(ref(db, "presence"));
      const presence = presenceSnap.exists() ? presenceSnap.val() : {};
      targets.push({ actorId: actorKey, name: myIdentity.name, image: myIdentity.image });

      for (const [pKey, pInfo] of Object.entries(presence)) {
        const matchedUser = users[pKey] || Object.values(users).find(u => u.uid === pKey || u.discordId === pKey || u.recordKey === pKey);
        if (matchedUser && matchedUser.recordKey !== actorKey && pInfo?.online === true && Date.now() - Number(pInfo.lastSeen || 0) < 90000) {
          if (!targets.some(t => t.actorId === matchedUser.recordKey)) {
            const iden = await resolveLeaderboardIdentity(matchedUser.gameAccounts, payload.gameTitle, matchedUser.leaderboardName || "Player", matchedUser.profileImageUrl || "");
            targets.push({ actorId: matchedUser.recordKey, name: iden.name, image: iden.image });
          }
        }
      }
    } else {
      const targetGame = String(payload.gameTitle || "").trim().toLowerCase();
      const targetUser = String(payload.gameUsername || "").trim().toLowerCase();
      const targetEntry = Object.values(users).find(u =>
        Object.entries(u.gameAccounts || {}).some(
          ([g, un]) => g.trim().toLowerCase() === targetGame && String(un).trim().toLowerCase() === targetUser
        )
      );
      if (!targetEntry) throw new Error("That player is not linked to an approved account.");
      if (targetEntry.recordKey === actorKey) throw new Error("You cannot challenge yourself.");
      const targetIden = await resolveLeaderboardIdentity(targetEntry.gameAccounts, payload.gameTitle, targetEntry.leaderboardName || payload.gameUsername, targetEntry.profileImageUrl || "");
      if (isDuel) {
        const maxWager = Math.min(Number(userRecord.challengePoints) || 0, Number(targetEntry.challengePoints) || 0);
        if (wagerPoints > maxWager) throw new Error("Wager cannot exceed the lower player's balance.");
        targets.push({ actorId: actorKey, name: myIdentity.name, image: myIdentity.image });
      }
      targets.push({ actorId: targetEntry.recordKey, name: targetIden.name, image: targetIden.image });
    }

    const participants = {};
    const now = Date.now();
    for (const t of targets) {
      const isCreatorInGroup = isGroup && t.actorId === actorKey;
      const startElims = isCreatorInGroup ? await computeOverallEliminations(userRecord.gameAccounts) : 0;
      participants[t.actorId] = {
        name: t.name,
        image: t.image || "",
        status: isCreatorInGroup ? "active" : (isDuel && t.actorId === actorKey ? "waiting" : "pending"),
        ...(isCreatorInGroup ? {
          acceptedAt: now,
          startingEliminations: startElims,
          lastTotal: startElims,
          progress: 0,
          deadline: (noTimeLimit || requireMatchEnd) ? null : now + timeLimitMinutes * 60000
        } : {}),
        deaths: 0,
        updatedAt: now
      };
    }

    const rewardPoints = calculateChallengePoints({
      eliminations,
      timeLimitMinutes,
      noTimeLimit,
      requireMatchEnd,
      maxDeaths,
      characterRequirement
    });

    const challengeId = crypto.randomUUID();
    const challenge = {
      title,
      eliminations,
      timeLimitMinutes,
      rewardPoints,
      mode: isGroup ? "group" : isDuel ? "1v1" : "individual",
      status: isDuel ? "pending" : "open",
      noTimeLimit,
      wagerPoints,
      baseRewardPoints: rewardPoints,
      maxDeaths,
      requireMatchEnd,
      characterRequirement,
      creatorId: actorKey,
      creatorName: myIdentity.name.slice(0, 50),
      createdAt: now,
      invitationExpiresAt: now + 10 * 60 * 1000,
      participants
    };

    await set(ref(db, `challenges/${challengeId}`), challenge);
    return { challengeId, rewardPoints, recipientCount: targets.length };
  }

  if (action === "respond") {
    const challengeRef = ref(db, `challenges/${payload.challengeId}`);
    const snap = await get(challengeRef);
    if (!snap.exists()) throw new Error("Challenge not found.");
    const challenge = snap.val();

    const possibleKeys = [actorKey, userRecord.uid, userRecord.recordKey, userRecord.discordId ? `discord_${userRecord.discordId}` : null].filter(Boolean);
    const participantKey = possibleKeys.find(k => challenge.participants && challenge.participants[k]);
    const participant = participantKey ? challenge.participants[participantKey] : null;

    if (!participant || participant.status !== "pending") {
      throw new Error("This invitation is no longer awaiting your response.");
    }

    const now = Date.now();
    if (Number(challenge.invitationExpiresAt) && now > Number(challenge.invitationExpiresAt)) {
      await update(ref(db, `challenges/${payload.challengeId}/participants/${participantKey}`), {
        status: "expired", updatedAt: now
      });
      throw new Error("This challenge invitation has expired.");
    }

    if (!payload.accept) {
      const changes = {
        [`participants/${participantKey}/status`]: "denied",
        [`participants/${participantKey}/updatedAt`]: now
      };
      if (challenge.mode === "1v1") {
        changes.status = "denied";
        for (const pId of Object.keys(challenge.participants || {})) {
          changes[`participants/${pId}/status`] = "denied";
          changes[`participants/${pId}/updatedAt`] = now;
        }
      }
      await update(challengeRef, changes);
    } else if (challenge.mode === "1v1") {
      const users = await getAllUsers();
      const changes = { status: "active", startedAt: now };
      for (const pId of Object.keys(challenge.participants || {})) {
        const uRec = users[pId] || Object.values(users).find(u => u.uid === pId || u.recordKey === pId);
        if (!uRec) throw new Error("A participant is no longer approved. The challenge cannot start.");
        const startElims = await computeOverallEliminations(uRec.gameAccounts);
        changes[`participants/${pId}`] = {
          ...challenge.participants[pId],
          status: "active",
          acceptedAt: now,
          startingEliminations: startElims,
          lastTotal: startElims,
          progress: 0,
          deaths: 0,
          deadline: (challenge.noTimeLimit || challenge.requireMatchEnd) ? null : now + Number(challenge.timeLimitMinutes || 0) * 60000,
          updatedAt: now
        };
        if (Number(challenge.wagerPoints) > 0) {
          await runTransaction(ref(db, `users/${uRec.recordKey}/challengePoints`), pts =>
            Math.max(0, (Number(pts) || 0) - Number(challenge.wagerPoints))
          );
        }
      }
      changes.wagerEscrowed = Number(challenge.wagerPoints) > 0;
      await update(challengeRef, changes);
    } else {
      const startElims = await computeOverallEliminations(userRecord.gameAccounts);
      const participantUpdate = {
        status: "active",
        acceptedAt: now,
        deadline: (challenge.noTimeLimit || challenge.requireMatchEnd) ? null : now + Number(challenge.timeLimitMinutes || 0) * 60000,
        startingEliminations: startElims,
        lastTotal: startElims,
        progress: 0,
        deaths: 0,
        updatedAt: now
      };
      await update(ref(db, `challenges/${payload.challengeId}`), {
        status: "active",
        [`participants/${participantKey}`]: {
          ...participant,
          ...participantUpdate
        }
      });
    }

    const updatedUser = await getUserRecord(actorKey);
    const latest = await get(challengeRef);
    return {
      challenge: latest.exists() ? latest.val() : null,
      challengePoints: Number(updatedUser?.challengePoints) || 0
    };
  }

  if (action === "abandon") {
    const challengeRef = ref(db, `challenges/${payload.challengeId}`);
    const snap = await get(challengeRef);
    if (!snap.exists()) throw new Error("Challenge not found.");
    const challenge = snap.val();
    const possibleKeys = [actorKey, userRecord.uid, userRecord.recordKey, userRecord.discordId ? `discord_${userRecord.discordId}` : null].filter(Boolean);
    const participantKey = possibleKeys.find(k => challenge.participants && challenge.participants[k]);

    if (!participantKey || challenge.participants[participantKey].status !== "active") {
      throw new Error("No active challenge to abandon.");
    }
    challenge.participants[participantKey].status = "abandoned";
    challenge.participants[participantKey].updatedAt = Date.now();
    if (challenge.mode === "1v1") {
      challenge.status = "abandoned";
      if (challenge.wagerEscrowed && challenge.wagerPoints > 0) {
        for (const pId of Object.keys(challenge.participants)) {
          await runTransaction(ref(db, `users/${pId}/challengePoints`), pts => (Number(pts) || 0) + challenge.wagerPoints);
        }
      }
    }
    await set(challengeRef, challenge);
    return { challenge };
  }

  throw new Error("Unknown challenge action.");
}