import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDocs, 
    doc, 
    getDoc, 
    setDoc,
    updateDoc,
    increment 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyArpjA7oxqiJD4YyCDmMxhL5LpdBUvxyfQ",
    authDomain: "mini-crossword-a1649.firebaseapp.com",
    projectId: "mini-crossword-a1649",
    storageBucket: "mini-crossword-a1649.firebasestorage.app",
    messagingSenderId: "661167541092",
    appId: "1:661167541092:web:c17757b6d1dddede3ac871",
    measurementId: "G-SN8LGRHSH8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// --- Constants & Config ---
const MAX_SELECTED = 4;
const TOTAL_ATTEMPTS = 4;
const PUZZLE_FILE = 'puzzles.json';
const LOSE_FACE_DURATION = 1800;
const MESSAGE_CLEAR_DELAY = 1800;
const CORRECT_GUESS_FADE_DURATION = 700;
const REVEAL_STAGGER_DELAY = 250;

// Medal Logic: 
// Gold: < 60s AND <= 1 mistake
// Silver: < 180s (3m) AND <= 2 mistakes
const THRESHOLDS = {
    GOLD_TIME: 60,
    GOLD_MISTAKES: 1,
    SILVER_TIME: 180,
    SILVER_MISTAKES: 2
};

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen');
const gameUI = document.getElementById('game-ui');
const startDateDisplay = document.getElementById('start-date-display');
const startBtn = document.getElementById('start-btn');
const leaderboardBody = document.getElementById('leaderboard-body');

// Auth DOM
const googleLoginBtn = document.getElementById('google-login-btn');
const userDisplay = document.getElementById('user-display');
const userAvatar = document.getElementById('user-avatar');
const nicknameInput = document.getElementById('nickname-input');
const signOutBtn = document.getElementById('sign-out-btn');
const medalCountsEl = document.getElementById('medal-counts');
const goldCountEl = document.getElementById('gold-count');
const silverCountEl = document.getElementById('silver-count');
const bronzeCountEl = document.getElementById('bronze-count');

// Game DOM
const activeGridArea = document.getElementById('active-grid-area');
const solvedGroupsArea = document.getElementById('solved-groups-area');
const submitButton = document.getElementById('submit-guess');
const messageArea = document.getElementById('message-area');
const attemptsLeftSpan = document.getElementById('attempts-left');
const attemptCircles = document.querySelectorAll('#attempt-circles span');
const deselectAllButton = document.getElementById('deselect-all-button');
const shuffleButton = document.getElementById('shuffle-button');
const loseOverlay = document.getElementById('lose-overlay');
const timerEl = document.getElementById('timer');

// Modal DOM
const modalOverlay = document.getElementById('modal-overlay');
const modalMedalIcon = document.getElementById('modal-medal-icon');
const modalMedalText = document.getElementById('modal-medal-text');
const finalTimeEl = document.getElementById('final-time');
const finalMistakesEl = document.getElementById('final-mistakes');
const restartBtn = document.getElementById('restart-btn');

// --- State Variables ---
let currentUser = null;
let currentPuzzleData = null;
let selectedWords = [];
let wordElements = {};
let remainingAttempts = TOTAL_ATTEMPTS;
let mistakesMade = 0;
let solvedGroups = [];
let incorrectGuesses = new Set();
let isGameOver = false;
let isAnimating = false;
let messageTimeoutId = null;

// Timer State
let startTime = null;
let timerInterval = null;
let finalSeconds = 0;

// --- Date Helper ---
function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getFormattedDate() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date().toLocaleDateString('en-US', options);
}

// --- Auth & Profile Logic ---

googleLoginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error("Login failed", error);
    }
});

signOutBtn.addEventListener('click', () => {
    signOut(auth);
});

nicknameInput.addEventListener('change', async () => {
    if (!currentUser) return;
    const newName = nicknameInput.value.trim() || "Anonymous";
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            nickname: newName,
            lastUpdated: new Date()
        }, { merge: true });
    } catch (e) {
        console.error("Error updating nickname:", e);
    }
});

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        googleLoginBtn.style.display = 'none';
        userDisplay.style.display = 'flex';
        userAvatar.src = user.photoURL;

        // Fetch User Profile
        const userRef = doc(db, "users", user.uid);
        try {
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const data = userSnap.data();
                nicknameInput.value = data.nickname || user.displayName.split(' ')[0];
                
                // Fetch Bennections Specific Medals
                const medals = data.bennections_medals || { gold: 0, silver: 0, bronze: 0 };
                goldCountEl.textContent = medals.gold || 0;
                silverCountEl.textContent = medals.silver || 0;
                bronzeCountEl.textContent = medals.bronze || 0;
                medalCountsEl.style.display = 'flex';
            } else {
                // First time setup
                const defaultName = user.displayName.split(' ')[0];
                nicknameInput.value = defaultName;
                await setDoc(userRef, {
                    nickname: defaultName,
                    email: user.email,
                    bennections_medals: { gold: 0, silver: 0, bronze: 0 }
                }, { merge: true });
                medalCountsEl.style.display = 'flex';
            }
        } catch (e) {
            console.error("Error fetching profile:", e);
        }
    } else {
        googleLoginBtn.style.display = 'flex';
        userDisplay.style.display = 'none';
        medalCountsEl.style.display = 'none';
        nicknameInput.value = '';
    }
});

// --- Leaderboard Logic ---

async function fetchLeaderboard() {
    const todayStr = getTodayDateString();
    leaderboardBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#888;">Loading...</td></tr>`;

    try {
        const q = query(
            collection(db, "bennections_scores"), // Distinct collection for this game
            where("date", "==", todayStr),
            orderBy("timeInSeconds", "asc"),
            limit(20)
        );

        const querySnapshot = await getDocs(q);
        leaderboardBody.innerHTML = ''; 

        if (querySnapshot.empty) {
            leaderboardBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#888;">No scores yet today. Be the first!</td></tr>`;
            return;
        }

        let rank = 1;
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const row = document.createElement('tr');
            
            let medalIcon = '🥉';
            if (data.medal === 'gold') medalIcon = '🥇';
            if (data.medal === 'silver') medalIcon = '🥈';

            row.innerHTML = `
                <td class="rank-col">${rank}</td>
                <td class="name-col" style="font-weight:500;">
                    ${data.nickname}
                </td>
                <td class="medal-col">${medalIcon}</td>
                <td class="mistake-col">${data.mistakes}</td>
                <td class="time-col">${data.timeString}</td>
            `;
            leaderboardBody.appendChild(row);
            rank++;
        });
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        leaderboardBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">Error loading scores.</td></tr>`;
    }
}

async function saveScore(medal) {
    if (!currentUser) return;
    const todayStr = getTodayDateString();
    let publicName = nicknameInput.value.trim() || "Anonymous";

    try {
        await addDoc(collection(db, "bennections_scores"), {
            uid: currentUser.uid,
            nickname: publicName,
            photoURL: currentUser.photoURL,
            timeInSeconds: finalSeconds,
            timeString: timerEl.textContent,
            mistakes: mistakesMade,
            date: todayStr,
            medal: medal,
            timestamp: new Date()
        });

        // Update User Totals
        const userRef = doc(db, "users", currentUser.uid);
        await updateDoc(userRef, {
            [`bennections_medals.${medal}`]: increment(1)
        });

        // Update local counts
        const countEl = document.getElementById(`${medal}-count`);
        if(countEl) countEl.textContent = parseInt(countEl.textContent) + 1;

    } catch (e) {
        console.error("Error saving score: ", e);
    }
}

// --- Game Initialization & Flow ---

document.addEventListener('DOMContentLoaded', () => {
    startDateDisplay.textContent = getFormattedDate();
    fetchLeaderboard();
});

startBtn.addEventListener('click', async () => {
    const success = await loadPuzzleForToday();
    if (success) {
        startScreen.classList.add('hidden');
        gameUI.classList.remove('hidden');
        initializeGame();
        startTimer();
    }
});

restartBtn.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
    gameUI.classList.add('hidden');
    startScreen.classList.remove('hidden');
    fetchLeaderboard(); // Refresh scores
});

// --- Core Game Logic ---

async function loadPuzzleForToday() {
    const todayStr = getTodayDateString();
    try {
        const response = await fetch(PUZZLE_FILE);
        if (!response.ok) throw new Error("HTTP error");
        const allPuzzles = await response.json();
        const puzzleGroups = allPuzzles[todayStr];

        if (isValidPuzzleData(puzzleGroups)) {
            currentPuzzleData = { date: todayStr, groups: puzzleGroups };
            return true;
        } else {
            alert("No puzzle found for today!");
            return false;
        }
    } catch (error) {
        console.error(error);
        alert("Failed to load puzzle.");
        return false;
    }
}

function isValidPuzzleData(puzzleGroups) {
    return puzzleGroups && Array.isArray(puzzleGroups) && puzzleGroups.length === 4;
}

function initializeGame() {
    isGameOver = false;
    isAnimating = false;
    selectedWords = [];
    wordElements = {};
    remainingAttempts = TOTAL_ATTEMPTS;
    mistakesMade = 0;
    solvedGroups = [];
    incorrectGuesses = new Set();
    finalSeconds = 0;

    activeGridArea.innerHTML = '';
    activeGridArea.classList.remove('game-won-hidden'); 
    solvedGroupsArea.innerHTML = '';
    messageArea.textContent = '';
    messageArea.className = '';
    loseOverlay.classList.remove('visible');

    updateAttemptsDisplay();
    submitButton.disabled = true;

    const allWords = currentPuzzleData.groups.flatMap(group => group.words);
    shuffleArray(allWords);
    populateGrid(allWords);
    enableGameControls();
}

function startTimer() {
    clearInterval(timerInterval);
    startTime = Date.now();
    timerEl.textContent = "00:00";
    timerInterval = setInterval(() => {
        finalSeconds = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(finalSeconds / 60).toString().padStart(2, '0');
        const secs = (finalSeconds % 60).toString().padStart(2, '0');
        timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

// --- Grid & Interaction ---

function adjustButtonFontSize(button) {
    button.classList.remove('small-text');
    if (button.scrollWidth > (button.clientWidth + 1)) {
        button.classList.add('small-text');
    }
}

function populateGrid(words) {
    const fragment = document.createDocumentFragment();
    words.forEach(word => {
        const button = document.createElement('button');
        button.textContent = word;
        button.classList.add('word-button');
        button.addEventListener('click', handleWordClick);
        fragment.appendChild(button);
        wordElements[word] = button;
    });

    activeGridArea.appendChild(fragment);

    requestAnimationFrame(() => {
        Object.values(wordElements).forEach(button => {
             if(button.parentNode === activeGridArea) adjustButtonFontSize(button);
        });
    });
}

function handleWordClick(event) {
    if (isGameOver || isAnimating) return;
    const button = event.target;
    const word = button.textContent;

    if (button.disabled || button.classList.contains('fading-out')) return;

    if (selectedWords.includes(word)) {
        selectedWords = selectedWords.filter(w => w !== word);
        button.classList.remove('selected');
    } else {
        if (selectedWords.length < MAX_SELECTED) {
            selectedWords.push(word);
            button.classList.add('selected');
        }
    }
    submitButton.disabled = selectedWords.length !== MAX_SELECTED;
}

function handleSubmitGuess() {
    if (isGameOver || isAnimating || selectedWords.length !== MAX_SELECTED) return;

    isAnimating = true;
    submitButton.disabled = true;

    const submittedSelection = [...selectedWords];
    const selectedButtons = submittedSelection.map(word => wordElements[word]);
    const guessId = [...submittedSelection].sort().join(',');

    // Reset message
    if (!messageArea.textContent.includes("Game Over")) displayMessage("", "");

    if (incorrectGuesses.has(guessId)) {
        displayMessage("Already guessed!", "message");
        clearMessageWithDelay();
        shakeButtons(selectedButtons);
        isAnimating = false;
        submitButton.disabled = false;
        return;
    }

    const correctGroup = findCorrectGroup(submittedSelection);

    if (correctGroup) {
         // Correct!
         selectedWords = [];
         selectedButtons.forEach(btn => {
             btn.classList.remove('selected');
             btn.classList.add('fading-out');
             btn.disabled = true;
         });

         setTimeout(() => {
             solvedGroups.push(correctGroup);
             renderSolvedGroup(correctGroup);

             submittedSelection.forEach(word => {
                 const btn = wordElements[word];
                 if (btn) {
                     btn.remove();
                     delete wordElements[word];
                 }
             });

             if (solvedGroups.length === 4) {
                 activeGridArea.classList.add('game-won-hidden');
                 setTimeout(() => endGame(true), 100);
             } else {
                 isAnimating = false;
             }
         }, CORRECT_GUESS_FADE_DURATION);

    } else {
        // Incorrect
        remainingAttempts--;
        mistakesMade++;
        updateAttemptsDisplay();
        incorrectGuesses.add(guessId);

        // Check "One Away"
        let isOneAway = false;
        const unsolvedGroups = currentPuzzleData.groups.filter(group => 
            !solvedGroups.some(solved => solved.category === group.category)
        );
        
        for (const group of unsolvedGroups) {
            const matches = submittedSelection.filter(word => group.words.includes(word)).length;
            if (matches === 3) {
                isOneAway = true;
                break;
            }
        }

        if (isOneAway) displayMessage("One away!", "message");
        else displayMessage("Incorrect", "message");

        shakeButtons(selectedButtons);
        clearMessageWithDelay();

        if (remainingAttempts <= 0) {
            setTimeout(() => endGame(false), 500);
        } else {
             isAnimating = false;
             submitButton.disabled = false;
        }
    }
}

function findCorrectGroup(selection) {
    const set = new Set(selection);
    const solvedCats = new Set(solvedGroups.map(g => g.category));
    return currentPuzzleData.groups.find(group => 
        !solvedCats.has(group.category) &&
        group.words.every(w => set.has(w))
    );
}

function renderSolvedGroup(group) {
    const div = document.createElement('div');
    div.classList.add('solved-group', `difficulty-${group.difficulty}`);
    div.innerHTML = `<strong>${group.category}</strong><p>${group.words.join(', ')}</p>`;
    solvedGroupsArea.appendChild(div);
}

function shakeButtons(buttons) {
    buttons.forEach(btn => {
        if (btn) {
            btn.classList.add('shake');
            setTimeout(() => btn.classList.remove('shake'), 400);
        }
    });
}

function updateAttemptsDisplay() {
    attemptsLeftSpan.textContent = remainingAttempts;
    attemptCircles.forEach((circle, index) => {
        circle.classList.toggle('used', index < (TOTAL_ATTEMPTS - remainingAttempts));
    });
}

// --- End Game Logic ---

function endGame(isWin) {
    isGameOver = true;
    stopTimer();
    disableGameControls();

    if (isWin) {
        processWin();
    } else {
        displayMessage("Game Over!", "message");
        loseOverlay.classList.add('visible');
        setTimeout(() => {
            loseOverlay.classList.remove('visible');
            revealRemainingGroups();
        }, LOSE_FACE_DURATION);
    }
}

function processWin() {
    let medal = 'bronze';
    let medalText = 'Bronze';
    let icon = '🥉';

    // Medal Logic
    if (finalSeconds <= THRESHOLDS.GOLD_TIME && mistakesMade <= THRESHOLDS.GOLD_MISTAKES) {
        medal = 'gold';
        medalText = 'Gold';
        icon = '🥇';
    } else if (finalSeconds <= THRESHOLDS.SILVER_TIME && mistakesMade <= THRESHOLDS.SILVER_MISTAKES) {
        medal = 'silver';
        medalText = 'Silver';
        icon = '🥈';
    }

    // Update Modal
    modalMedalIcon.textContent = icon;
    modalMedalText.innerHTML = `You got the <span style="color:#000">${medalText} Medal</span>!`;
    finalTimeEl.textContent = timerEl.textContent;
    finalMistakesEl.textContent = mistakesMade;

    // Trigger Confetti
    triggerFireworks();

    // Show Modal
    setTimeout(() => {
        modalOverlay.classList.remove('hidden');
    }, 500);

    // Save Score
    if (currentUser) {
        saveScore(medal);
    }
}

function revealRemainingGroups() {
    const solvedCats = new Set(solvedGroups.map(g => g.category));
    const toReveal = currentPuzzleData.groups
        .filter(g => !solvedCats.has(g.category))
        .sort((a,b) => a.difficulty - b.difficulty);

    activeGridArea.innerHTML = ''; // Clear grid
    
    toReveal.forEach((group, index) => {
        setTimeout(() => {
            renderSolvedGroup(group);
        }, index * REVEAL_STAGGER_DELAY);
    });
}

// --- Utils & Helpers ---

function displayMessage(msg, type) {
    if (messageTimeoutId) clearTimeout(messageTimeoutId);
    messageArea.textContent = msg;
    messageArea.className = type;
    messageArea.classList.remove('hidden');
}

function clearMessageWithDelay() {
    if (messageTimeoutId) clearTimeout(messageTimeoutId);
    messageTimeoutId = setTimeout(() => {
        messageArea.classList.add('hidden');
    }, MESSAGE_CLEAR_DELAY);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function disableGameControls() {
    submitButton.disabled = true;
    deselectAllButton.disabled = true;
    shuffleButton.disabled = true;
    Object.values(wordElements).forEach(btn => btn.disabled = true);
}

function enableGameControls() {
    deselectAllButton.disabled = false;
    shuffleButton.disabled = false;
    submitButton.disabled = selectedWords.length !== MAX_SELECTED;
}

function deselectAll() {
    if (isGameOver || isAnimating) return;
    selectedWords.forEach(word => {
        const btn = wordElements[word];
        if (btn) btn.classList.remove('selected');
    });
    selectedWords = [];
    submitButton.disabled = true;
}

function shuffleGrid() {
    if (isGameOver || isAnimating) return;
    const currentBtns = Array.from(activeGridArea.querySelectorAll('.word-button'));
    const words = currentBtns.map(b => b.textContent);
    shuffleArray(words);
    
    // Re-render
    const fragment = document.createDocumentFragment();
    words.forEach(word => {
        const btn = wordElements[word]; // Reuse existing element logic? Better to rebuild to ensure order
        // Actually, just re-appending them in new order works
        fragment.appendChild(wordElements[word]);
    });
    activeGridArea.appendChild(fragment);
}

function triggerFireworks() {
    if (typeof confetti !== 'function') return;
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 3500 };

    const randomInRange = (min, max) => Math.random() * (max - min) + min;

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return clearInterval(interval);
        const particleCount = 50 * (timeLeft / duration);
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

// --- Listeners ---
submitButton.addEventListener('click', handleSubmitGuess);
deselectAllButton.addEventListener('click', deselectAll);
shuffleButton.addEventListener('click', shuffleGrid);