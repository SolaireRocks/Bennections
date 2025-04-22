// START OF FILE script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const activeGridArea = document.getElementById('active-grid-area');
    const solvedGroupsArea = document.getElementById('solved-groups-area');
    const submitButton = document.getElementById('submit-guess');
    const messageArea = document.getElementById('message-area');
    const attemptsLeftSpan = document.getElementById('attempts-left');
    const attemptCircles = document.querySelectorAll('#attempt-circles span');
    const deselectAllButton = document.getElementById('deselect-all-button');
    const shuffleButton = document.getElementById('shuffle-button');
    const loseOverlay = document.getElementById('lose-overlay');

    // --- Constants ---
    const MAX_SELECTED = 4;
    const TOTAL_ATTEMPTS = 4;
    const PUZZLE_FILE = 'puzzles.json';
    const LOSE_FACE_DURATION = 1800;
    const MESSAGE_CLEAR_DELAY = 1800;
    const CORRECT_GUESS_FADE_DURATION = 700;
    const REVEAL_STAGGER_DELAY = 250;

    // --- Game State Variables ---
    let selectedWords = [];
    let wordElements = {};
    let currentPuzzleData = null;
    let remainingAttempts = TOTAL_ATTEMPTS;
    let solvedGroups = [];
    let incorrectGuesses = new Set();
    let isGameOver = false;
    let messageTimeoutId = null;
    let isAnimating = false;

    // --- Local Storage Key ---
    function getStorageKey(dateStr) {
        return `connectionsGameState_${dateStr}`;
    }

    // --- Date Formatting ---
    function getTodayDateString() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // --- Local Storage Functions ---
    function saveGameState() {
        if (!currentPuzzleData || !currentPuzzleData.date) return;

        const currentGridWords = Array.from(activeGridArea.querySelectorAll('.word-button:not(.fading-out):not(.removing)'))
                                      .map(btn => btn.textContent);

        const stateToSave = {
            puzzleDate: currentPuzzleData.date,
            attempts: remainingAttempts,
            solvedCategories: solvedGroups.map(g => g.category),
            gridWords: currentGridWords,
            incorrectGuesses: Array.from(incorrectGuesses),
            isGameOver: isGameOver,
            isWin: isGameOver ? (solvedGroups.length === 4) : null,
            // selectedWords: selectedWords // Optional: Persist selection
        };

        try {
            localStorage.setItem(getStorageKey(currentPuzzleData.date), JSON.stringify(stateToSave));
        } catch (error) {
            console.error("Error saving game state to localStorage:", error);
        }
    }

    function loadGameState(dateStr) {
        const key = getStorageKey(dateStr);
        try {
            const savedStateJSON = localStorage.getItem(key);
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                if (savedState && savedState.puzzleDate === dateStr) {
                    return savedState;
                } else {
                    localStorage.removeItem(key);
                }
            }
        } catch (error) {
            console.error("Error loading or parsing game state from localStorage:", error);
        }
        return null;
    }

    // --- Core Game Logic ---

    async function loadPuzzleForToday() {
        const todayStr = getTodayDateString();
        console.log(`Attempting to load puzzle data for: ${todayStr}`);
        const savedState = loadGameState(todayStr);

        try {
            const response = await fetch(PUZZLE_FILE);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const allPuzzles = await response.json();
            const puzzleGroups = allPuzzles[todayStr];

            if (isValidPuzzleData(puzzleGroups)) {
                console.log("Successfully found and validated puzzle for", todayStr);
                currentPuzzleData = { date: todayStr, groups: puzzleGroups };

                if (savedState) {
                    restoreGameFromState(savedState);
                } else {
                    initializeGame(false);
                }

                // --- GA Event: Game Start ---
                if (currentPuzzleData && currentPuzzleData.date === getTodayDateString() && !savedState?.isGameOver) {
                     if (typeof gtag === 'function') {
                         gtag('event', 'game_load_today', {
                           'event_category': 'Game',
                           'event_label': currentPuzzleData.date
                         });
                         console.log("GA Event: game_load_today sent");
                     } else {
                         console.warn("gtag function not found for game_load_today event.");
                     }
                 }
                // --- End GA Event ---

            } else {
                console.warn("Puzzle data for", todayStr, "not found or is invalid in puzzles.json.");
                handleLoadError("No puzzle found for today.");
            }
        } catch (error) {
            console.error('Error loading or parsing puzzle data:', error);
            handleLoadError("Failed to load puzzle data.");
        }
    }

    function isValidPuzzleData(puzzleGroups) {
       return puzzleGroups && Array.isArray(puzzleGroups) && puzzleGroups.length === 4 &&
              puzzleGroups.every(g => g && typeof g.category === 'string' && Array.isArray(g.words) && g.words.length === 4 && typeof g.difficulty === 'number');
    }

    function handleLoadError(message) {
        displayMessage(message, "error");
        activeGridArea.innerHTML = "<p>Please try again later.</p>";
        disableGameControls();
    }

    function initializeGame(isRestoring = false) {
        isGameOver = false;
        isAnimating = false;
        selectedWords = [];
        wordElements = {};
        remainingAttempts = TOTAL_ATTEMPTS;
        solvedGroups = [];
        incorrectGuesses = new Set();

        activeGridArea.innerHTML = '';
        activeGridArea.classList.remove('game-over', 'game-won-hidden'); // Ensure hidden class is removed
        solvedGroupsArea.innerHTML = '';
        messageArea.textContent = '';
        messageArea.className = 'message';
        loseOverlay.classList.remove('visible');

        updateAttemptsDisplay();
        submitButton.disabled = true;

        const allWords = currentPuzzleData.groups.flatMap(group => group.words);
        shuffleArray(allWords);

        populateGrid(allWords);
        enableGameControls();

        if (!isRestoring) {
            saveGameState();
        }
    }

    function restoreGameFromState(savedState) {
        console.log("Restoring game from saved state:", savedState);
        isGameOver = savedState.isGameOver;
        remainingAttempts = savedState.attempts;
        incorrectGuesses = new Set(savedState.incorrectGuesses || []);
        // selectedWords = savedState.selectedWords || []; // Optional
        solvedGroups = currentPuzzleData.groups.filter(group =>
            savedState.solvedCategories.includes(group.category)
        );
        renderSolvedGroupsArea(true);

        activeGridArea.innerHTML = '';
        wordElements = {};
        populateGrid(savedState.gridWords); // Adjusts font size

        // Restore selection visually if needed
        // if (selectedWords.length > 0) { ... }

        updateAttemptsDisplay();
        submitButton.disabled = true; // Will be updated by enableGameControls if needed

        if (isGameOver) {
            disableGameControls();
            activeGridArea.classList.add('game-over');
            if (savedState.isWin) {
                displayMessage("Congratulations! You are very smart! (and a little cutie)", "correct");
                // Ensure grid is hidden immediately if loaded in won state
                if (activeGridArea.querySelectorAll('.word-button').length === 0) {
                    activeGridArea.classList.add('game-won-hidden');
                } else {
                     // Force remove buttons and hide grid if state mismatch somehow
                     removeAllButtonsFromGrid(true);
                     activeGridArea.classList.add('game-won-hidden');
                }
            } else {
                 displayMessage("Game Over! Better luck next time.", "incorrect");
                 revealRemainingGroups(true);
            }
        } else {
            enableGameControls();
            submitButton.disabled = selectedWords.length !== MAX_SELECTED; // Set initial submit state correctly
             const solvedWords = new Set(solvedGroups.flatMap(g => g.words));
             savedState.gridWords.forEach(word => {
                if (solvedWords.has(word) && wordElements[word]) {
                    wordElements[word].disabled = true;
                }
             });
        }
    }

    function adjustButtonFontSize(button) {
        button.classList.remove('small-text');
        if (button.scrollWidth > (button.clientWidth + 1)) {
            button.classList.add('small-text');
        }
    }

    function populateGrid(words) {
        const fragment = document.createDocumentFragment();
        words.forEach(word => {
            const isSolved = solvedGroups.some(group => group.words.includes(word));
            if (isSolved) return;

            const button = document.createElement('button');
            button.textContent = word;
            button.classList.add('word-button');
            button.addEventListener('click', handleWordClick);
            fragment.appendChild(button);
            wordElements[word] = button;
        });

        activeGridArea.appendChild(fragment);

        Object.values(wordElements).forEach(button => {
             if(button.parentNode === activeGridArea) {
                adjustButtonFontSize(button);
             }
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

    function getGuessId(selection) {
        return [...selection].sort().join(',');
    }

    function handleSubmitGuess() {
        if (isGameOver || isAnimating || selectedWords.length !== MAX_SELECTED) return;

        isAnimating = true;
        submitButton.disabled = true;

        const submittedSelection = [...selectedWords];
        const selectedButtons = submittedSelection.map(word => wordElements[word]).filter(Boolean);
        const guessId = getGuessId(submittedSelection);

        if (messageArea.classList.contains('info') || messageArea.classList.contains('correct')) {
            displayMessage("", "");
        }

        if (incorrectGuesses.has(guessId)) {
            displayMessage("Already guessed!", "info");
            clearMessageWithDelay();
            selectedButtons.forEach(button => {
                if (button && !button.classList.contains('fading-out')) {
                    button.classList.add('shake');
                    setTimeout(() => { if(button) button.classList.remove('shake'); }, 300);
                }
            });
            isAnimating = false;
            submitButton.disabled = false; // Re-enable submit as selection is still 4
            return;
        }

        const correctGroup = findCorrectGroup(submittedSelection);

        if (correctGroup) {
             displayMessage("Correct!", "correct");
             selectedWords = []; // Clear selection state
             selectedButtons.forEach(button => {
                 button.classList.remove('selected');
                 button.classList.add('fading-out'); // Start fade animation
             });

             setTimeout(() => {
                 solvedGroups.push(correctGroup);
                 renderSolvedGroupsArea(); // Add & animate solved group

                 // Remove faded buttons from DOM & memory
                 submittedSelection.forEach(word => {
                     const button = wordElements[word];
                     if (button) {
                         button.remove();
                         delete wordElements[word];
                     }
                 });

                 // Check for win condition *after* removing buttons
                 if (solvedGroups.length === 4) {
                     // **** ADDED THIS LINE ****
                     activeGridArea.classList.add('game-won-hidden'); // Trigger grid collapse/fade
                     // *************************
                     setTimeout(() => {
                        endGame(true); // Trigger rest of win sequence
                        // isAnimating set false in endGame for win
                     }, 100); // Small delay after adding class before rest of win logic
                 } else {
                     saveGameState(); // Save progress
                     isAnimating = false; // Release lock for next guess
                 }
                 clearMessageWithDelay();

             }, CORRECT_GUESS_FADE_DURATION); // Wait for fade

        } else { // Incorrect Guess
            remainingAttempts--;
            updateAttemptsDisplay();
            incorrectGuesses.add(guessId);

            let isOneAway = false;
            const unsolvedGroups = currentPuzzleData.groups.filter(group =>
                !solvedGroups.some(solved => solved.category === group.category)
            );
            for (const group of unsolvedGroups) {
                const correctWordsInSelection = submittedSelection.filter(word => group.words.includes(word)).length;
                if (correctWordsInSelection === MAX_SELECTED - 1) {
                    isOneAway = true;
                    break;
                }
            }

            if (isOneAway) {
                displayMessage("One away!", "info");
            } else {
                displayMessage("Incorrect Guess", "incorrect");
            }

            selectedButtons.forEach(button => {
                if (button && !button.classList.contains('fading-out')) {
                    button.classList.add('shake');
                    setTimeout(() => { if(button) button.classList.remove('shake'); }, 300);
                }
            });

            // Keep selection active

             if (remainingAttempts <= 0) {
                setTimeout(() => {
                   endGame(false); // Trigger lose sequence
                }, 400);
            } else {
                 clearMessageWithDelay();
                 saveGameState();
                 isAnimating = false;
                 submitButton.disabled = false; // Re-enable submit as selection is still 4
            }
        }
    }

    function findCorrectGroup(selection) {
        const selectionSet = new Set(selection);
        const solvedCategoryNames = new Set(solvedGroups.map(g => g.category));

        return currentPuzzleData.groups.find(group =>
            !solvedCategoryNames.has(group.category) &&
            group.words.length === selectionSet.size &&
            group.words.every(word => selectionSet.has(word))
        ) || null;
    }

    function renderSolvedGroupsArea(skipAnimation = false) {
        solvedGroups.sort((a, b) => a.difficulty - b.difficulty);
        const currentScrollTop = solvedGroupsArea.scrollTop;

        solvedGroupsArea.innerHTML = '';
        solvedGroups.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.classList.add('solved-group', `difficulty-${group.difficulty}`);
            groupDiv.innerHTML = `<strong>${group.category}</strong><p>${group.words.join(', ')}</p>`;
            solvedGroupsArea.appendChild(groupDiv);

            if (!skipAnimation) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                         groupDiv.classList.add('visible');
                    });
                });
            } else {
                groupDiv.classList.add('visible');
            }
        });
        solvedGroupsArea.scrollTop = currentScrollTop;
    }

    function removeAllButtonsFromGrid(skipAnimation = false) {
        const buttons = activeGridArea.querySelectorAll('.word-button');
        buttons.forEach(button => {
             if (wordElements[button.textContent]) {
                delete wordElements[button.textContent];
             }
             button.remove();
        });
        // Don't automatically add game-won-hidden here, let the calling function decide
    }

    function updateAttemptsDisplay() {
        attemptsLeftSpan.textContent = remainingAttempts;
        attemptCircles.forEach((circle, index) => {
            circle.classList.toggle('used', index < (TOTAL_ATTEMPTS - remainingAttempts));
        });
    }

    function disableGameControls() {
        submitButton.disabled = true;
        deselectAllButton.disabled = true;
        shuffleButton.disabled = true;
        Object.values(wordElements).forEach(button => {
            if (button && !button.classList.contains('fading-out')) {
               button.disabled = true;
            }
         });
    }

    function enableGameControls() {
        if (!isGameOver && !isAnimating) {
            deselectAllButton.disabled = false;
            shuffleButton.disabled = false;
             Object.values(wordElements).forEach(button => {
                  if (button && !button.classList.contains('fading-out')) {
                      button.disabled = false;
                  }
              });
              submitButton.disabled = selectedWords.length !== MAX_SELECTED;
        } else {
             disableGameControls();
        }
    }

    function endGame(isWin) {
        if (isGameOver) return;

        isGameOver = true;
        isAnimating = true;
        disableGameControls();
        activeGridArea.classList.add('game-over'); // Keep adding game-over for potential styling

        // --- GA Event ---
        const eventName = isWin ? 'game_win' : 'game_loss';
        const eventData = {
            'event_category': 'Game',
            'event_label': currentPuzzleData?.date || 'unknown_date',
        };
        if (typeof gtag === 'function') {
            gtag('event', eventName, eventData);
            console.log(`GA Event: ${eventName} sent`);
        } else {
            console.warn(`gtag function not found for ${eventName} event.`);
        }
        // --- End GA Event ---

        if (isWin) {
            // .game-won-hidden is now added *before* endGame is called
            displayMessage("Congratulations! You found all groups!", "correct");
            triggerFireworks();
            isAnimating = false; // Release lock, controls remain disabled
        } else {
            displayMessage("Game Over! Better luck next time.", "incorrect");
            loseOverlay.classList.add('visible');
            setTimeout(() => {
                loseOverlay.classList.remove('visible');
                 setTimeout(() => {
                      revealRemainingGroups(); // Handles releasing lock
                 }, 550);
            }, LOSE_FACE_DURATION);
        }
         saveGameState();
    }

    function triggerFireworks() {
        if (typeof confetti !== 'function') {
             console.warn("Confetti function not found.");
             return;
         }
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const brightColors = ['#FF0000','#00FF00','#0000FF','#FFFF00','#FF00FF','#00FFFF','#FFA500','#FF4500','#ADFF2F','#FF69B4','#1E90FF'];
        const defaults = { startVelocity: 45, spread: 360, ticks: 70, zIndex: 10, gravity: 0.8, scalar: 0.9 };

        function randomInRange(min, max) { return Math.random() * (max - min) + min; }

        const interval = setInterval(function() {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);
            const particleCount = 60 * (timeLeft / duration);
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }, colors: brightColors, shapes: ['star', 'circle'] }));
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }, colors: brightColors, shapes: ['star', 'circle'] }));
        }, 250);
    }

    function revealRemainingGroups(skipAnimation = false) {
         if (!currentPuzzleData) {
            isAnimating = false;
            return;
         }
         const solvedCategoryNames = new Set(solvedGroups.map(g => g.category));
         const groupsToReveal = currentPuzzleData.groups
            .filter(group => !solvedCategoryNames.has(group.category))
            .sort((a, b) => a.difficulty - b.difficulty);

        if (groupsToReveal.length === 0) {
             if (activeGridArea.querySelectorAll('.word-button').length === 0) {
                 // Ensure grid is hidden if already empty
                 activeGridArea.classList.add('game-won-hidden');
             }
             isAnimating = false;
             return;
         }

         Object.values(wordElements).forEach(button => {
             if (button) button.disabled = true;
         });

         renderSolvedGroupsArea(true);

         let revealedCount = 0;
         groupsToReveal.forEach((group, index) => {
            const revealDelay = skipAnimation ? 0 : index * REVEAL_STAGGER_DELAY;

            setTimeout(() => {
                if (!solvedCategoryNames.has(group.category)) {
                     solvedGroups.push(group);
                     solvedCategoryNames.add(group.category);

                     const groupDiv = document.createElement('div');
                     groupDiv.classList.add('solved-group', `difficulty-${group.difficulty}`);
                     groupDiv.innerHTML = `<strong>${group.category}</strong><p>${group.words.join(', ')}</p>`;
                     solvedGroupsArea.appendChild(groupDiv);

                     if (!skipAnimation) {
                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                groupDiv.classList.add('visible');
                            });
                        });
                     } else {
                         groupDiv.classList.add('visible');
                     }
                 }

                 group.words.forEach(word => {
                     const button = wordElements[word];
                     if (button) {
                         button.remove();
                         delete wordElements[word];
                     }
                 });

                 revealedCount++;
                 if (revealedCount === groupsToReveal.length) {
                     // After last group, hide grid if empty
                     if (activeGridArea.querySelectorAll('.word-button').length === 0) {
                         activeGridArea.classList.add('game-won-hidden');
                     }
                     saveGameState();
                     isAnimating = false;
                     // Controls remain disabled
                 }

            }, revealDelay);
         });
     }

    function displayMessage(msg, type) {
        if (messageTimeoutId) clearTimeout(messageTimeoutId);
        messageArea.textContent = msg;
        messageArea.className = 'message';
        if (type) messageArea.classList.add(type);
        messageArea.classList.remove('hidden');
    }

    function clearMessageWithDelay() {
        if (messageTimeoutId) clearTimeout(messageTimeoutId);
        messageTimeoutId = setTimeout(() => {
            const isEndGameMessage = messageArea.textContent === "Congratulations! You found all groups!" || messageArea.textContent === "Game Over! Better luck next time.";
            if (!isEndGameMessage) {
                 messageArea.classList.add('hidden');
            }
            messageTimeoutId = null;
        }, MESSAGE_CLEAR_DELAY);
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function deselectAll() {
        if (isGameOver || isAnimating) return;
        selectedWords.forEach(word => {
            const button = wordElements[word];
            if (button) button.classList.remove('selected');
        });
        selectedWords = [];
        submitButton.disabled = true;
        displayMessage("", "");
    }

    function shuffleGrid() {
        if (isGameOver || isAnimating) return;
        const currentButtons = Array.from(activeGridArea.querySelectorAll('.word-button:not(.fading-out)'));
        if (currentButtons.length === 0) return;

        const wordsToShuffle = currentButtons.map(btn => btn.textContent);
        shuffleArray(wordsToShuffle);
        const currentSelection = new Set(selectedWords);

        activeGridArea.innerHTML = '';
        wordElements = {};

        const fragment = document.createDocumentFragment();
        wordsToShuffle.forEach(word => {
            const button = document.createElement('button');
            button.textContent = word;
            button.classList.add('word-button');
            if (currentSelection.has(word)) {
                 button.classList.add('selected');
            }
            button.addEventListener('click', handleWordClick);
            fragment.appendChild(button);
            wordElements[word] = button;
        });

        activeGridArea.appendChild(fragment);

        Object.values(wordElements).forEach(button => {
             if(button.parentNode === activeGridArea) {
                adjustButtonFontSize(button);
             }
        });

        submitButton.disabled = selectedWords.length !== MAX_SELECTED;
        saveGameState();
     }

    // --- Event Listeners ---
    submitButton.addEventListener('click', handleSubmitGuess);
    deselectAllButton.addEventListener('click', deselectAll);
    shuffleButton.addEventListener('click', shuffleGrid);

    // --- Initial Load ---
    loadPuzzleForToday();

}); // End of DOMContentLoaded
// END OF FILE script.js