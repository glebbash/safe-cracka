const safe = document.querySelector('#safe');
const shell = document.querySelector('#dialShell');
const dial = document.querySelector('#dial');
const dialFace = document.querySelector('#dialFace');
const settingsButton = document.querySelector('#settingsButton');
const settingsDialog = document.querySelector('#settingsDialog');
const settingsClose = document.querySelector('#settingsClose');
const settingsForm = document.querySelector('#settingsForm');
const cheatSetting = document.querySelector('#cheatSetting');
const blinkSetting = document.querySelector('#blinkSetting');
const cheatCurrent = document.querySelector('#cheatCurrent');
const debugStage = document.querySelector('#debugStage');
const debugTarget = document.querySelector('#debugTarget');
const debugState = document.querySelector('#debugState');
const debugEvent = document.querySelector('#debugEvent');
const svgNS = 'http://www.w3.org/2000/svg';
const settingsKey = 'safe-cracka.settings.v1';
const defaultSettings = Object.freeze({
  cheat: false,
  blink: true,
  feedback: 'haptics',
  numberCount: 3,
});

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(settingsKey));
    return {
      cheat: typeof stored?.cheat === 'boolean' ? stored.cheat : defaultSettings.cheat,
      blink: typeof stored?.blink === 'boolean' ? stored.blink : defaultSettings.blink,
      feedback: ['haptics', 'sound', 'both'].includes(stored?.feedback) ? stored.feedback : defaultSettings.feedback,
      numberCount: [3, 4].includes(Number(stored?.numberCount)) ? Number(stored.numberCount) : defaultSettings.numberCount,
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
let pendingNotch = null;
let settings = loadSettings();
let directions = makeDirections();
let requiredPasses = makeRequiredPasses();
let combination = makeCombination();
let cheatMode = settings.cheat;
let unlockTimer = null;
let audioContext = null;
let lastTickSoundAt = -Infinity;
const activeSoundSources = new Set();

function makeDirections() {
  return settings.numberCount === 4 ? [-1, 1, -1, 1, -1] : [-1, 1, -1, 1];
}

function makeRequiredPasses() {
  return settings.numberCount === 4 ? [5, 4, 3, 2] : [4, 3, 2];
}

function makeCombination() {
  const values = [];
  while (values.length < settings.numberCount) {
    const value = Math.floor(Math.random() * 100);
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function angleFromPointer(event) {
  const box = shell.getBoundingClientRect();
  return Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180 / Math.PI;
}

function normalizedDelta(next, previous) {
  let delta = next - previous;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function numberAtNotch(notch) {
  return (((-notch) % 100) + 100) % 100;
}

function haptic(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext = new AudioContext();
  return audioContext;
}

function trackSoundSource(source) {
  activeSoundSources.add(source);
  source.addEventListener('ended', () => activeSoundSources.delete(source), { once: true });
}

function stopActiveSounds() {
  activeSoundSources.forEach((source) => {
    try {
      source.stop();
    } catch {
      // A source may already have ended between events.
    }
  });
  activeSoundSources.clear();
}

function playMechanicalClick(context, begins, duration, volume, pitch = 340) {
  const body = context.createOscillator();
  const bodyGain = context.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(pitch, begins);
  body.frequency.exponentialRampToValueAtTime(85, begins + duration);
  bodyGain.gain.setValueAtTime(.0001, begins);
  bodyGain.gain.exponentialRampToValueAtTime(volume, begins + .002);
  bodyGain.gain.exponentialRampToValueAtTime(.0001, begins + duration);
  body.connect(bodyGain).connect(context.destination);
  trackSoundSource(body);
  body.start(begins);
  body.stop(begins + duration + .01);

  const snap = context.createOscillator();
  const snapGain = context.createGain();
  snap.type = 'square';
  snap.frequency.setValueAtTime(1050, begins);
  snap.frequency.exponentialRampToValueAtTime(420, begins + .012);
  snapGain.gain.setValueAtTime(.0001, begins);
  snapGain.gain.exponentialRampToValueAtTime(volume * .32, begins + .001);
  snapGain.gain.exponentialRampToValueAtTime(.0001, begins + .014);
  snap.connect(snapGain).connect(context.destination);
  trackSoundSource(snap);
  snap.start(begins);
  snap.stop(begins + .02);
}

function playSound(type) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') context.resume();
  const now = performance.now();
  const isTick = type === 'tick' || type === 'error';
  if (isTick && now - lastTickSoundAt < 20) return;
  stopActiveSounds();
  if (isTick) lastTickSoundAt = now;

  const tickPattern = [[0, .032, .14, 340]];
  const patterns = {
    tick: tickPattern,
    error: tickPattern,
    target: [[0, .055, .14, 340], [.073, .075, .14, 340]],
    unlock: [[0, .09, .16, 320], [.13, .12, .18, 430]],
  };
  const start = context.currentTime;
  (patterns[type] || tickPattern).forEach(([offset, duration, volume, pitch]) => {
    playMechanicalClick(context, start + offset, duration, volume, pitch);
  });
}

function feedback(type, pattern) {
  if (settings.feedback === 'haptics' || settings.feedback === 'both') haptic(pattern);
  if (settings.feedback === 'sound' || settings.feedback === 'both') playSound(type);
}

function logEvent(message) {
  debugEvent.textContent = message;
}

function currentTarget() {
  return progress === combination.length ? 69 : combination[progress];
}

function updateDebug() {
  const currentNotch = Math.round(rotation / 3.6);
  const current = numberAtNotch(currentNotch);
  cheatCurrent.value = String(current).padStart(2, '0');
  if (!cheatMode) return;

  const direction = directions[progress] === 1 ? 'CW' : 'CCW';
  debugStage.textContent = `Stage ${progress + 1}/${combination.length + 1} · ${direction}`;
  debugTarget.textContent = `Target ${String(currentTarget()).padStart(2, '0')}`;
  debugState.textContent = progress === combination.length
    ? 'Final run · auto-opens at 69'
    : targetPasses < requiredPasses[progress]
      ? `Target pass ${targetPasses} / ${requiredPasses[progress]}`
      : currentNotch === pendingNotch
        ? `Minimum cleared · reverse now (${targetPasses})`
        : `Minimum cleared · next target (${targetPasses})`;
}

function resetSequence(reason = 'Sequence reset') {
  progress = 0;
  targetPasses = 0;
  pendingNotch = null;
  safe.classList.remove('hit');
  logEvent(reason);
  updateDebug();
}

function processNotch(notch, direction, suppressNotchHaptic = false) {
  if (locked) return 'locked';

  if (direction !== directions[progress]) {
    resetSequence('Wrong direction · sequence reset');
    if (!suppressNotchHaptic) feedback('error', 8);
    return 'reset';
  }

  if (progress === combination.length) {
    if (numberAtNotch(notch) === 69) {
      unlock(notch);
      return 'unlocked';
    }
    feedback('tick', 8);
    updateDebug();
    return 'notch';
  }

  if (numberAtNotch(notch) === combination[progress]) {
    targetPasses += 1;
    feedback('target', [55, 18, 75]);
    if (targetPasses >= requiredPasses[progress]) {
      pendingNotch = notch;
      safe.classList.add('hit');
      logEvent(`Pass ${targetPasses}/${requiredPasses[progress]} · reverse now`);
      updateDebug();
      return 'hit';
    }
    logEvent(`Target passed ${targetPasses}/${requiredPasses[progress]}`);
    updateDebug();
    return 'target-pass';
  }

  if (pendingNotch !== null && notch !== pendingNotch) safe.classList.remove('hit');
  if (!suppressNotchHaptic) feedback('tick', 8);
  updateDebug();
  return 'notch';
}

function updateDial() {
  const notch = Math.round(rotation / 3.6);
  dial.style.setProperty('--rotation', `${rotation}deg`);
  updateDebug();
  if (notch === lastNotch) return;

  const direction = Math.sign(notch - lastNotch);

  if (pendingNotch !== null && direction !== directions[progress]) {
    if (lastNotch === pendingNotch && direction === directions[progress + 1]) {
      confirmHit();
    } else {
      resetSequence('Invalid reversal · sequence reset');
    }
  }

  let suppressNotchHaptic = false;
  for (let crossed = lastNotch + direction; crossed !== notch + direction; crossed += direction) {
    const result = processNotch(crossed, direction, suppressNotchHaptic);
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

  const value = numberAtNotch(pendingNotch);
  progress += 1;
  targetPasses = 0;
  pendingNotch = null;
  logEvent(`Number ${String(value).padStart(2, '0')} locked`);
  window.setTimeout(() => safe.classList.remove('hit'), 180);
  updateDebug();
}

function unlock(stopNotch) {
  locked = true;
  rotation = stopNotch * 3.6;
  lastNotch = stopNotch;
  dial.style.setProperty('--rotation', `${rotation}deg`);
  safe.classList.add('open');
  logEvent('69 reached · safe unlocked');
  updateDebug();
  feedback('unlock', [90, 40, 120]);
  unlockTimer = window.setTimeout(() => {
    combination = makeCombination();
    locked = false;
    resetSequence('New combination ready');
    safe.classList.remove('open');
  }, 2200);
}

function applySettings(previousSettings = null) {
  const numberCountChanged = previousSettings && previousSettings.numberCount !== settings.numberCount;
  const cheatDisabled = previousSettings?.cheat && !settings.cheat;
  directions = makeDirections();
  requiredPasses = makeRequiredPasses();
  safe.classList.toggle('blink-enabled', settings.blink);
  cheatMode = settings.cheat;
  safe.classList.toggle('cheat', cheatMode);

  if (numberCountChanged || cheatDisabled) {
    window.clearTimeout(unlockTimer);
    locked = false;
    combination = makeCombination();
    safe.classList.remove('open');
    resetSequence(numberCountChanged ? `${settings.numberCount}-number combination ready` : 'New combination generated');
  } else {
    updateDebug();
  }
}

function syncSettingsForm() {
  cheatSetting.checked = settings.cheat;
  blinkSetting.checked = settings.blink;
  settingsForm.elements.feedback.value = settings.feedback;
  settingsForm.elements.numberCount.value = String(settings.numberCount);
}

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
  settings = {
    cheat: cheatSetting.checked,
    blink: blinkSetting.checked,
    feedback: settingsForm.elements.feedback.value,
    numberCount: Number(settingsForm.elements.numberCount.value),
  };
  saveSettings();
  applySettings(previousSettings);
});

shell.addEventListener('pointerdown', (event) => {
  if (settings.feedback === 'sound' || settings.feedback === 'both') {
    const context = getAudioContext();
    if (context?.state === 'suspended') context.resume();
  }
  dragging = true;
  lastAngle = angleFromPointer(event);
  shell.setPointerCapture(event.pointerId);
});

shell.addEventListener('pointermove', (event) => {
  if (!dragging || locked) return;
  const nextAngle = angleFromPointer(event);
  rotation += normalizedDelta(nextAngle, lastAngle);
  lastAngle = nextAngle;
  updateDial();
});

function release(event) {
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
