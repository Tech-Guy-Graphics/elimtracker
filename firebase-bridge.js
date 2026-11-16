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

  // Base points: timed challenges scale with speed (15 min = 4x elims); untimed = 1x elims
  let base = 0;
  if (requireMatchEnd) {
    // Must complete before match ends gives a strong bonus, capped below a <=15-minute time limit (which is ~4x elims)
    base = Math.ceil(elims * 2.5);
  } else if (noTimeLimit) {
    base = elims;
  } else {
    base = Math.ceil((elims * 60) / mins);
  }

  let bonusMultiplier = 1.0;

  // Decrease in allowed deaths increases points
  if (maxDeaths !== null && maxDeaths !== undefined && maxDeaths !== "" && Number.isFinite(Number(maxDeaths))) {
    const d = Math.max(0, Math.floor(Number(maxDeaths)));
    if (d === 0) bonusMultiplier += 0.50;
    else if (d === 1) bonusMultiplier += 0.35;
    else if (d === 2) bonusMultiplier += 0.25;
    else if (d <= 5) bonusMultiplier += 0.15;
    else bonusMultiplier += 0.05;
  }

  // Required character adds a 25% bonus
  if (String(characterRequirement || "").trim().length > 0) {
    bonusMultiplier += 0.25;
  }

  let total = Math.max(1, Math.round(base * bonusMultiplier));

  // Ensure "before match ends" stays slightly lower than an equivalent <=15 min timed challenge when compared at same modifiers
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
  const users = await getAllUsers();
  if (users[uid]) return users[uid];
  return Object.values(users).find(u => u.uid === uid || u.authUid === uid) || null;
}

export async function getUserRecordByDiscordId(discordId) {
  if (!discordId) return null;
  const cleanId = String(discordId).trim();
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

export async function computeOverallEliminations(gameAccounts) {
  if (!gameAccounts || typeof gameAccounts !== "object") return 0;
  const snap = await get(ref(db, "leaderboards"));
  if (!snap.exists()) return 0;
  const boards = snap.val();
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
      participants[t.actorId] = {
        name: t.name,
        image: t.image || "",
        status: isDuel && t.actorId === actorKey ? "waiting" : "pending",
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
      await update(ref(db, `challenges/${payload.challengeId}/participants/${participantKey}`), participantUpdate);
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