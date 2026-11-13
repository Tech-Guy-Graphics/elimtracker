import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, onDisconnect, onValue, ref, set, update, get, runTransaction, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCs65B8IwKAqLxbTuDGPjV_-uX9bVUJeTM",
  authDomain: "kill-tracker-e3083.firebaseapp.com",
  projectId: "kill-tracker-e3083",
  databaseURL: "https://kill-tracker-e3083-default-rtdb.firebaseio.com",
  appId: "1:888950181547:web:2349883ef1a2d82e0631ee"
};

const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getDatabase(app, FIREBASE_CONFIG.databaseURL);
export { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, onDisconnect, onValue, ref, set, update, get, runTransaction, remove };

export async function getUserRecord(uid) {
  if (!uid) return null;
  const snap = await get(ref(db, `users/${uid}`));
  return snap.exists() ? snap.val() : null;
}

export async function getAllUsers() {
  const snap = await get(ref(db, "users"));
  return snap.exists() ? snap.val() : {};
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
      p.name || "",
      p.gameUsername || "",
      p.character || "",
      Boolean(p.active),
      Number(p.placement) || (idx + 1),
      "",
      p.treasureIcon || "",
      Number(p.treasureQuantity) || 0
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

export async function resolveLeaderboardIdentity(gameAccounts, preferredGameTitle = "") {
  if (!gameAccounts || typeof gameAccounts !== "object") return { name: "Player", image: "" };
  const snap = await get(ref(db, "leaderboards"));
  if (!snap.exists()) return { name: "Player", image: "" };
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
        name: String(match[2] || "Player").trim(),
        image: String(match[0] || "").trim()
      };
    }
  }
  return { name: "Player", image: "" };
}

// Direct Firebase Challenge Engine (replaces Apps Script bridge)
export async function runFirebaseChallengeAction(currentUser, userRecord, action, payload = {}) {
  const uid = currentUser.uid;
  const myIdentity = await resolveLeaderboardIdentity(userRecord.gameAccounts, payload.gameTitle);

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
    if (!matchedEntry) throw new Error("That player is not linked to an approved Firebase account.");
    const targetIdentity = await resolveLeaderboardIdentity(matchedEntry.gameAccounts, payload.gameTitle);
    const overallEliminations = await computeOverallEliminations(matchedEntry.gameAccounts);
    return {
      actorId: matchedEntry.uid,
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
    const noTimeLimit = payload.mode === "1v1" && payload.noTimeLimit === true;
    const timeLimitMinutes = noTimeLimit ? 0 : Math.floor(Number(payload.timeLimitMinutes));
    if (!title) throw new Error("Enter a challenge title.");
    if (!Number.isInteger(eliminations) || eliminations < 1 || eliminations > 1000) {
      throw new Error("Choose between 1 and 1,000 eliminations.");
    }
    if (!noTimeLimit && (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 1440)) {
      throw new Error("Choose a time limit from 1 minute to 24 hours.");
    }

    const isGroup = payload.mode === "group";
    const isDuel = payload.mode === "1v1";
    const wagerPoints = isDuel ? Math.floor(Number(payload.wagerPoints)) : 0;
    const users = await getAllUsers();
    let targets = [];

    if (isGroup) {
      const presenceSnap = await get(ref(db, "presence"));
      const presence = presenceSnap.exists() ? presenceSnap.val() : {};
      targets.push({ actorId: uid, name: myIdentity.name, image: myIdentity.image });
      for (const [pUid, pInfo] of Object.entries(presence)) {
        if (pUid !== uid && users[pUid] && pInfo?.online === true && Date.now() - Number(pInfo.lastSeen || 0) < 90000) {
          const iden = await resolveLeaderboardIdentity(users[pUid].gameAccounts, payload.gameTitle);
          targets.push({ actorId: pUid, name: iden.name, image: iden.image });
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
      if (targetEntry.uid === uid) throw new Error("You cannot challenge yourself.");
      const targetIden = await resolveLeaderboardIdentity(targetEntry.gameAccounts, payload.gameTitle);
      if (isDuel) {
        const maxWager = Math.min(Number(userRecord.challengePoints) || 0, Number(targetEntry.challengePoints) || 0);
        if (wagerPoints > maxWager) throw new Error("Wager cannot exceed the lower player's balance.");
        targets.push({ actorId: uid, name: myIdentity.name, image: myIdentity.image });
      }
      targets.push({ actorId: targetEntry.uid, name: targetIden.name, image: targetIden.image });
    }

    const participants = {};
    const now = Date.now();
    for (const t of targets) {
      participants[t.actorId] = {
        name: t.name,
        image: t.image || "",
        status: isDuel && t.actorId === uid ? "waiting" : "pending",
        updatedAt: now
      };
    }

    const rewardPoints = Math.max(1, noTimeLimit ? eliminations : Math.ceil((eliminations * 60) / timeLimitMinutes));
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
      creatorId: uid,
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
    const participant = challenge.participants?.[uid];
    if (!participant || participant.status !== "pending") throw new Error("Challenge is no longer awaiting response.");

    const now = Date.now();
    if (!payload.accept) {
      participant.status = "denied";
      participant.updatedAt = now;
      if (challenge.mode === "1v1") {
        challenge.status = "denied";
        Object.values(challenge.participants).forEach(p => { p.status = "denied"; p.updatedAt = now; });
      }
    } else if (challenge.mode === "1v1") {
      const users = await getAllUsers();
      for (const actorId of Object.keys(challenge.participants)) {
        const uRec = users[actorId];
        if (!uRec) throw new Error("Participant is no longer approved.");
        const startElims = await computeOverallEliminations(uRec.gameAccounts);
        challenge.participants[actorId] = {
          ...challenge.participants[actorId],
          status: "active",
          acceptedAt: now,
          startingEliminations: startElims,
          lastTotal: startElims,
          progress: 0,
          deadline: challenge.noTimeLimit ? null : now + challenge.timeLimitMinutes * 60000,
          updatedAt: now
        };
        if (challenge.wagerPoints > 0) {
          await runTransaction(ref(db, `users/${actorId}/challengePoints`), pts => Math.max(0, (Number(pts) || 0) - challenge.wagerPoints));
        }
      }
      challenge.wagerEscrowed = challenge.wagerPoints > 0;
      challenge.status = "active";
      challenge.startedAt = now;
    } else {
      const startElims = await computeOverallEliminations(userRecord.gameAccounts);
      participant.status = "active";
      participant.acceptedAt = now;
      participant.deadline = now + challenge.timeLimitMinutes * 60000;
      participant.startingEliminations = startElims;
      participant.lastTotal = startElims;
      participant.progress = 0;
      participant.updatedAt = now;
    }

    await set(challengeRef, challenge);
    const updatedUser = await getUserRecord(uid);
    return { challenge, challengePoints: Number(updatedUser?.challengePoints) || 0 };
  }

  if (action === "abandon") {
    const challengeRef = ref(db, `challenges/${payload.challengeId}`);
    const snap = await get(challengeRef);
    if (!snap.exists()) throw new Error("Challenge not found.");
    const challenge = snap.val();
    if (!challenge.participants?.[uid] || challenge.participants[uid].status !== "active") {
      throw new Error("No active challenge to abandon.");
    }
    challenge.participants[uid].status = "abandoned";
    challenge.participants[uid].updatedAt = Date.now();
    if (challenge.mode === "1v1") {
      challenge.status = "abandoned";
      if (challenge.wagerEscrowed && challenge.wagerPoints > 0) {
        for (const actorId of Object.keys(challenge.participants)) {
          await runTransaction(ref(db, `users/${actorId}/challengePoints`), pts => (Number(pts) || 0) + challenge.wagerPoints);
        }
      }
    }
    await set(challengeRef, challenge);
    return { challenge };
  }

  if (action === "bet") {
    const challengeRef = ref(db, `challenges/${payload.challengeId}`);
    const snap = await get(challengeRef);
    if (!snap.exists()) throw new Error("Challenge not found.");
    const challenge = snap.val();
    const stake = Math.floor(Number(payload.amount));
    if (challenge.mode !== "1v1" || challenge.status !== "active") throw new Error("1v1 is not accepting bets.");
    if (challenge.participants?.[uid]) throw new Error("Participants cannot bet.");
    if (!Number.isInteger(stake) || stake < 1) throw new Error("Minimum bet is 1 point.");
    const freshUser = await getUserRecord(uid);
    const bal = Number(freshUser?.challengePoints) || 0;
    if (stake > bal) throw new Error("Insufficient challenge points.");

    await set(ref(db, `users/${uid}/challengePoints`), bal - stake);
    challenge.bets = challenge.bets || {};
    const existing = challenge.bets[uid];
    if (existing && existing.sideActorId !== payload.sideActorId) {
      throw new Error("You can only add points to the player you already backed.");
    }
    challenge.bets[uid] = {
      sideActorId: payload.sideActorId,
      amount: (Number(existing?.amount) || 0) + stake,
      name: myIdentity.name,
      status: "held",
      updatedAt: Date.now()
    };
    await set(challengeRef, challenge);
    return { challenge, challengePoints: bal - stake };
  }

  throw new Error("Unknown challenge action.");
}
