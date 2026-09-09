// @ts-check

/**
 * @typedef {{
 *   cheat: boolean;
 *   blink: boolean;
 *   vibration: boolean;
 *   sound: boolean;
 *   numberCount: 3 | 4;
 * }} Settings
 * 
 * @typedef {'locked' | 'reset' | 'unlocked' | 'notch' | 'hit' | 'target-pass'} NotchResult
 */

const safe = /** @type {HTMLElement} */ (document.querySelector('#safe'));
const shell = /** @type {HTMLElement} */ (document.querySelector('#dialShell'));
const dial = /** @type {HTMLElement} */ (document.querySelector('#dial'));
const dialFace = /** @type {SVGSVGElement} */ (document.querySelector('#dialFace'));
const settingsButton = /** @type {HTMLButtonElement} */ (document.querySelector('#settingsButton'));
const settingsDialog = /** @type {HTMLDialogElement} */ (document.querySelector('#settingsDialog'));
const settingsClose = /** @type {HTMLButtonElement} */ (document.querySelector('#settingsClose'));
const settingsForm = /** @type {HTMLFormElement} */ (document.querySelector('#settingsForm'));
const cheatSetting = /** @type {HTMLInputElement} */ (document.querySelector('#cheatSetting'));
const blinkSetting = /** @type {HTMLInputElement} */ (document.querySelector('#blinkSetting'));
const vibrationSetting = /** @type {HTMLInputElement} */ (document.querySelector('#vibrationSetting'));
const soundSetting = /** @type {HTMLInputElement} */ (document.querySelector('#soundSetting'));
const cheatCurrent = /** @type {HTMLOutputElement} */ (document.querySelector('#cheatCurrent'));
const debugStage = /** @type {HTMLElement} */ (document.querySelector('#debugStage'));
const debugTarget = /** @type {HTMLElement} */ (document.querySelector('#debugTarget'));
const debugState = /** @type {HTMLElement} */ (document.querySelector('#debugState'));
const svgNS = 'http://www.w3.org/2000/svg';
const settingsKey = 'safe-cracka.settings.v1';

/** @type {Settings} */
const defaultSettings = Object.freeze({
  cheat: false,
  blink: true,
  // Android's Web Audio clicks sound poor, while PCs have no vibration API at all.
  vibration: /Android/i.test(navigator.userAgent),
  sound: !/Android/i.test(navigator.userAgent),
  numberCount: 3,
});

function loadSettings() {
  try {
    const stored = JSON.parse(/** @type {string} */ (localStorage.getItem(settingsKey)));
    return {
      cheat: typeof stored?.cheat === 'boolean' ? stored.cheat : defaultSettings.cheat,
      blink: typeof stored?.blink === 'boolean' ? stored.blink : defaultSettings.blink,
      vibration: typeof stored?.vibration === 'boolean' ? stored.vibration : defaultSettings.vibration,
      sound: typeof stored?.sound === 'boolean' ? stored.sound : defaultSettings.sound,
      numberCount: [3, 4].includes(Number(stored?.numberCount)) ? /** @type {3 | 4} */ (Number(stored.numberCount)) : defaultSettings.numberCount,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // The game remains usable if storage is unavailable or full.
  }
}

for (let number = 0; number < 100; number += 1) {
  const angle = number * 3.6;
  const tick = document.createElementNS(svgNS, 'line');
  tick.setAttribute('x1', '200');
  tick.setAttribute('x2', '200');
  tick.setAttribute('y1', '12');
  tick.setAttribute('y2', number % 10 === 0 ? '39' : number % 5 === 0 ? '33' : '26');
  tick.setAttribute('transform', `rotate(${angle} 200 200)`);
  tick.setAttribute('class', `tick ${number % 10 === 0 ? 'ten' : number % 5 === 0 ? 'five' : ''}`);
  dialFace.append(tick);

  if (number % 10 === 0) {
    const radians = (angle - 90) * Math.PI / 180;
    const x = 200 + Math.cos(radians) * 142;
    const y = 200 + Math.sin(radians) * 142;
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', String(y));
    label.setAttribute('transform', `rotate(${angle} ${x} ${y})`);
    label.setAttribute('class', 'dial-number');
    label.textContent = String(number).padStart(2, '0');
    dialFace.append(label);
  }
}

let rotation = 0;
let lastAngle = 0;
let lastNotch = 0;
let dragging = false;
let progress = 0;
let locked = false;
let targetPasses = 0;
/** @type {number | null} */
let pendingNotch = null;
let settings = loadSettings();
let directions = makeDirections();
let requiredPasses = makeRequiredPasses();
let combination = makeCombination();
let cheatMode = settings.cheat;
/** @type {number | null} */
let unlockTimer = null;
/** @type {AudioContext | null} */
let audioContext = null;
/** @type {AudioBuffer | null} */
let clickBuffer = null;
/** @type {AudioBuffer | null} */
let thunkBuffer = null;
let nextTickSoundAt = 0;
let lastMoveTime = 0;
/** @type {Set<{ source: AudioBufferSourceNode, gain: GainNode }>} */
const scheduledTickSounds = new Set();

function makeDirections() {
  return settings.numberCount === 4 ? [-1, 1, -1, 1, -1] : [-1, 1, -1, 1];
}

function makeRequiredPasses() {
  return settings.numberCount === 4 ? [5, 4, 3, 2] : [4, 3, 2];
}

function makeCombination() {
  /** @type {number[]} */
  const values = [];
  while (values.length < settings.numberCount) {
    const value = Math.floor(Math.random() * 100);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function angleFromPointer(/** @type {PointerEvent} */ event) {
  const box = shell.getBoundingClientRect();
  return Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180 / Math.PI;
}

function normalizedDelta(/** @type {number} */ next, /** @type {number} */ previous) {
  let delta = next - previous;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function numberAtNotch(/** @type {number} */ notch) {
  return (((-notch) % 100) + 100) % 100;
}

function haptic(/** @type {number | number[]} */ pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContext = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
  if (!AudioContext) return null;
  audioContext = new AudioContext();
  return audioContext;
}

function getClickBuffer(/** @type {AudioContext} */ context) {
  if (clickBuffer) return clickBuffer;
  const length = Math.ceil(context.sampleRate * .006);
  clickBuffer = context.createBuffer(1, length, context.sampleRate);
  const samples = clickBuffer.getChannelData(0);
  let noiseState = 0x2f6e2b1;
  for (let index = 0; index < length; index += 1) {
    noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
    const noise = (noiseState / 0xffffffff) * 2 - 1;
    const progress = index / length;
    const envelope = (1 - progress) ** 3;
    const strike = Math.sin(Math.PI * 2 * (1450 - progress * 650) * index / context.sampleRate);
    samples[index] = (strike * .7 + noise * .3) * envelope;
  }
  return clickBuffer;
}

// Same shape as the normal tick, just slightly longer and higher-pitched so hit feedback stands out subtly.
function getThunkBuffer(/** @type {AudioContext} */ context) {
  if (thunkBuffer) return thunkBuffer;
  const length = Math.ceil(context.sampleRate * .01);
  thunkBuffer = context.createBuffer(1, length, context.sampleRate);
  const samples = thunkBuffer.getChannelData(0);
  let noiseState = 0x9e3779b1;
  for (let index = 0; index < length; index += 1) {
    noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
    const noise = (noiseState / 0xffffffff) * 2 - 1;
    const progress = index / length;
    const envelope = (1 - progress) ** 3;
    const chime = Math.sin(Math.PI * 2 * (1550 - progress * 700) * index / context.sampleRate);
    samples[index] = (chime * .7 + noise * .3) * envelope;
  }
  return thunkBuffer;
}

function playBufferedClick(/** @type {AudioContext} */ context, /** @type {number} */ startsAt, /** @type {number} */ volume = .28, /** @type {boolean} */ tickSound = false, /** @type {boolean} */ thunk = false) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = thunk ? getThunkBuffer(context) : getClickBuffer(context);
  gain.gain.setValueAtTime(volume, startsAt);
  source.connect(gain).connect(context.destination);
  if (tickSound) {
    const entry = { source, gain };
    scheduledTickSounds.add(entry);
    source.addEventListener('ended', () => scheduledTickSounds.delete(entry), { once: true });
  }
  source.start(startsAt);
}

function clearTickSoundQueue(/** @type {AudioContext} */ context) {
  const now = context.currentTime;
  scheduledTickSounds.forEach(({ source, gain }) => {
    try {
      // Fade out instead of stopping instantly, which produced an audible pop on every target pass.
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + .003);
      source.stop(now + .003);
    } catch {
      // A six-millisecond click may already have finished.
    }
  });
  scheduledTickSounds.clear();
  nextTickSoundAt = now;
}

function playTickSound(/** @type {AudioContext} */ context, /** @type {number} */ tickSpacing = .008) {
  const now = context.currentTime;
  if (nextTickSoundAt < now) nextTickSoundAt = now;
  if (nextTickSoundAt > now + .045) clearTickSoundQueue(context);
  playBufferedClick(context, nextTickSoundAt, .28, true);
  nextTickSoundAt += tickSpacing;
}

function playSound(/** @type {'tick' | 'error' | 'target' | 'hit' | 'unlock'} */ type, /** @type {number | undefined} */ tickSpacing = undefined) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') context.resume();

  if (type === 'tick' || type === 'error') {
    playTickSound(context, tickSpacing);
    return;
  }

  clearTickSoundQueue(context);
  const now = context.currentTime;
  if (type === 'target') {
    playBufferedClick(context, now, .3);
    playBufferedClick(context, now + .073, .34);
    return;
  }
  if (type === 'hit') {
    playBufferedClick(context, now, .3, false, true);
    return;
  }
  playBufferedClick(context, now, .4, false, true);
  playBufferedClick(context, now + .13, .5, false, true);
}

function feedback(/** @type {'tick' | 'error' | 'target' | 'hit' | 'unlock'} */ type, /** @type {number | number[]} */ pattern, /** @type {number | undefined} */ tickSpacing = undefined) {
  if (settings.vibration) haptic(pattern);
  if (settings.sound) playSound(type, tickSpacing);
}

function currentTarget() {
  return progress === combination.length ? 69 : combination[progress];
}

function updateDebug() {
  const currentNotch = Math.round(rotation / 3.6);
  const current = numberAtNotch(currentNotch);
  cheatCurrent.value = String(current).padStart(2, '0');
  if (!cheatMode) return;

  const direction = directions[progress] === 1 ? 'right' : 'left';
  const nextDirection = directions[progress + 1] === 1 ? 'right' : 'left';
  const finalDial = progress === combination.length;
  const requiredTurns = finalDial ? 1 : requiredPasses[progress];
  const completedTurns = locked ? requiredTurns : Math.min(targetPasses, requiredTurns);
  debugStage.textContent = `Dial ${progress + 1}/${combination.length + 1} | Turn ${completedTurns}/${requiredTurns}`;
  debugTarget.textContent = `Target ${String(currentTarget()).padStart(2, '0')}`;
  if (locked) {
    debugState.textContent = 'Safe unlocked';
  } else if (finalDial) {
    debugState.textContent = `Turn ${direction} · stop at target`;
  } else if (currentNotch === pendingNotch) {
    debugState.textContent = `Turn ${nextDirection}`;
  } else if (targetPasses >= requiredTurns - 1) {
    debugState.textContent = `Turn ${direction} · stop at target`;
  } else {
    debugState.textContent = `Turn ${direction}`;
  }
}

function resetSequence() {
  progress = 0;
  targetPasses = 0;
  pendingNotch = null;
  safe.classList.remove('hit');
  updateDebug();
}

function processNotch(/** @type {number} */ notch, /** @type {number} */ direction, /** @type {boolean} */ suppressNotchHaptic = false, /** @type {number} */ tickSpacing = .008) {
  if (locked) return 'locked';

  if (direction !== directions[progress]) {
    resetSequence();
    if (!suppressNotchHaptic) feedback('error', 8, tickSpacing);
    return 'reset';
  }

  if (progress === combination.length) {
    if (numberAtNotch(notch) === 69) {
      unlock(notch);
      return 'unlocked';
    }
    feedback('tick', 8, tickSpacing);
    updateDebug();
    return 'notch';
  }

  if (numberAtNotch(notch) === combination[progress]) {
    targetPasses += 1;
    // Only the passes that would actually stop-and-unlock get the harder hit feedback.
    const stopWorthy = targetPasses >= requiredPasses[progress];
    feedback(stopWorthy ? 'hit' : 'target', stopWorthy ? [70, 25, 90] : [55, 18, 75]);
    if (stopWorthy) {
      pendingNotch = notch;
      safe.classList.add('hit');
      updateDebug();
      return 'hit';
    }
    updateDebug();
    return 'target-pass';
  }

  if (pendingNotch !== null && notch !== pendingNotch) safe.classList.remove('hit');
  if (!suppressNotchHaptic) feedback('tick', 8, tickSpacing);
  updateDebug();
  return 'notch';
}

function updateDial(/** @type {number} */ eventTime = performance.now()) {
  const notch = Math.round(rotation / 3.6);
  dial.style.setProperty('--rotation', `${rotation}deg`);
  updateDebug();

  const elapsedMs = lastMoveTime ? Math.max(eventTime - lastMoveTime, 0) : 0;
  lastMoveTime = eventTime;

  if (notch === lastNotch) return;

  const direction = Math.sign(notch - lastNotch);
  const notchesCrossed = Math.abs(notch - lastNotch);
  // Spread ticks across the real time the pointer took to cross them, instead of a fixed step,
  // so a coarse touch event that jumps many notches at once doesn't fire an artificial fast rhythm.
  const tickSpacing = elapsedMs > 0
    ? Math.min(Math.max(elapsedMs / notchesCrossed / 1000, .004), .05)
    : .008;

  if (pendingNotch !== null && direction !== directions[progress]) {
    if (lastNotch === pendingNotch && direction === directions[progress + 1]) {
      confirmHit();
    } else {
      resetSequence();
    }
  }

  let suppressNotchHaptic = false;
  for (let crossed = lastNotch + direction; crossed !== notch + direction; crossed += direction) {
    const result = processNotch(crossed, direction, suppressNotchHaptic, tickSpacing);
    if (result === 'hit') {
      suppressNotchHaptic = true;
      continue;
    }
    if (result === 'reset') {
      break;
    }
    if (result === 'unlocked') return;
  }
  lastNotch = notch;
}

function confirmHit() {
  if (pendingNotch === null || lastNotch !== pendingNotch || locked) return;

  progress += 1;
  targetPasses = 0;
  pendingNotch = null;
  window.setTimeout(() => safe.classList.remove('hit'), 180);
  updateDebug();
}

function unlock(/** @type {number} */ stopNotch) {
  locked = true;
  rotation = stopNotch * 3.6;
  lastNotch = stopNotch;
  dial.style.setProperty('--rotation', `${rotation}deg`);
  safe.classList.add('open');
  updateDebug();
  feedback('unlock', [90, 40, 120]);
  unlockTimer = window.setTimeout(() => {
    combination = makeCombination();
    locked = false;
    resetSequence();
    safe.classList.remove('open');
  }, 2200);
}

function applySettings(/** @type {Settings | null} */ previousSettings = null) {
  const numberCountChanged = previousSettings && previousSettings.numberCount !== settings.numberCount;
  const cheatDisabled = previousSettings?.cheat && !settings.cheat;
  directions = makeDirections();
  requiredPasses = makeRequiredPasses();
  safe.classList.toggle('blink-enabled', settings.blink);
  cheatMode = settings.cheat;
  safe.classList.toggle('cheat', cheatMode);

  if (numberCountChanged || cheatDisabled) {
    window.clearTimeout(unlockTimer ?? undefined);
    locked = false;
    combination = makeCombination();
    safe.classList.remove('open');
    resetSequence();
  } else {
    updateDebug();
  }
}

function syncSettingsForm() {
  cheatSetting.checked = settings.cheat;
  blinkSetting.checked = settings.blink;
  vibrationSetting.checked = settings.vibration;
  soundSetting.checked = settings.sound;
  const elements = /** @type {any} */ (settingsForm.elements);
  elements.numberCount.value = String(settings.numberCount);
}

// Tooltip buttons live inside their setting's <label>; without this, clicking one would also toggle the switch.
document.querySelectorAll('.tooltip-trigger').forEach((trigger) => {
  trigger.addEventListener('click', (event) => event.preventDefault());
});

settingsButton.addEventListener('click', () => {
  syncSettingsForm();
  settingsDialog.showModal();
});

settingsClose.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});

settingsForm.addEventListener('change', () => {
  const previousSettings = { ...settings };
  const elements = /** @type {any} */ (settingsForm.elements);
  settings = {
    cheat: cheatSetting.checked,
    blink: blinkSetting.checked,
    vibration: vibrationSetting.checked,
    sound: soundSetting.checked,
    numberCount: /** @type {3 | 4} */ (Number(elements.numberCount.value)),
  };
  saveSettings();
  applySettings(previousSettings);
});

shell.addEventListener('pointerdown', (event) => {
  if (settings.sound) {
    const context = getAudioContext();
    if (context?.state === 'suspended') context.resume();
  }
  dragging = true;
  lastAngle = angleFromPointer(event);
  lastMoveTime = 0;
  shell.setPointerCapture(event.pointerId);
});

shell.addEventListener('pointermove', (event) => {
  if (!dragging || locked) return;
  const nextAngle = angleFromPointer(event);
  rotation += normalizedDelta(nextAngle, lastAngle);
  lastAngle = nextAngle;
  updateDial(event.timeStamp);
});

function release(/** @type {PointerEvent} */ event) {
  if (!dragging) return;
  dragging = false;
  rotation = Math.round(rotation / 3.6) * 3.6;
  dial.style.setProperty('--rotation', `${rotation}deg`);
  updateDebug();
  if (shell.hasPointerCapture(event.pointerId)) shell.releasePointerCapture(event.pointerId);
}

shell.addEventListener('pointerup', release);
shell.addEventListener('pointercancel', release);
shell.addEventListener('contextmenu', (event) => event.preventDefault());
applySettings();
syncSettingsForm();
updateDial();
