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
let clickBuffer = null;
let nextTickSoundAt = 0;
const scheduledTickSounds = new Set();

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

function getClickBuffer(context) {
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

function playBufferedClick(context, startsAt, volume = .28, tickSound = false) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = getClickBuffer(context);
  gain.gain.setValueAtTime(volume, startsAt);
  source.connect(gain).connect(context.destination);
  if (tickSound) {
    scheduledTickSounds.add(source);
    source.addEventListener('ended', () => scheduledTickSounds.delete(source), { once: true });
  }
  source.start(startsAt);
}

function clearTickSoundQueue(context) {
  scheduledTickSounds.forEach((source) => {
    try {
      source.stop();
    } catch {
      // A six-millisecond click may already have finished.
    }
  });
  scheduledTickSounds.clear();
  nextTickSoundAt = context.currentTime;
}

function playTickSound(context) {
  const now = context.currentTime;
  if (nextTickSoundAt < now) nextTickSoundAt = now;
  if (nextTickSoundAt > now + .045) clearTickSoundQueue(context);
  playBufferedClick(context, nextTickSoundAt, .28, true);
  nextTickSoundAt += .008;
}

function playSound(type) {
  const context = getAudioContext();
  if (!context) return;
  if (context.state === 'suspended') context.resume();

  if (type === 'tick' || type === 'error') {
    playTickSound(context);
    return;
  }

  clearTickSoundQueue(context);
  const now = context.currentTime;
  if (type === 'target') {
    playBufferedClick(context, now, .3);
    playBufferedClick(context, now + .073, .34);
    return;
  }
  playBufferedClick(context, now, .34);
  playBufferedClick(context, now + .13, .4);
}

function feedback(type, pattern) {
  if (settings.feedback === 'haptics' || settings.feedback === 'both') haptic(pattern);
  if (settings.feedback === 'sound' || settings.feedback === 'both') playSound(type);
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

function processNotch(notch, direction, suppressNotchHaptic = false) {
  if (locked) return 'locked';

  if (direction !== directions[progress]) {
    resetSequence();
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
      updateDebug();
      return 'hit';
    }
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
      resetSequence();
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

  progress += 1;
  targetPasses = 0;
  pendingNotch = null;
  window.setTimeout(() => safe.classList.remove('hit'), 180);
  updateDebug();
}

function unlock(stopNotch) {
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
    resetSequence();
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
