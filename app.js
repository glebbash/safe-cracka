const safe = document.querySelector('#safe');
const shell = document.querySelector('#dialShell');
const dial = document.querySelector('#dial');
const dialFace = document.querySelector('#dialFace');
const cheatToggle = document.querySelector('#cheatToggle');
const cheatCurrent = document.querySelector('#cheatCurrent');
const debugStage = document.querySelector('#debugStage');
const debugTarget = document.querySelector('#debugTarget');
const debugState = document.querySelector('#debugState');
const debugEvent = document.querySelector('#debugEvent');
const svgNS = 'http://www.w3.org/2000/svg';

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
let combination = makeCombination();
let cheatMode = false;
let unlockTimer = null;
const directions = [-1, 1, -1, 1];
const requiredPasses = [4, 3, 2];

function makeCombination() {
  const values = [];
  while (values.length < 3) {
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

function logEvent(message) {
  debugEvent.textContent = message;
}

function currentTarget() {
  return progress === 3 ? 69 : combination[progress];
}

function updateDebug() {
  const currentNotch = Math.round(rotation / 3.6);
  const current = numberAtNotch(currentNotch);
  cheatCurrent.value = String(current).padStart(2, '0');
  if (!cheatMode) return;

  const direction = directions[progress] === 1 ? 'CW' : 'CCW';
  debugStage.textContent = `Stage ${progress + 1}/4 · ${direction}`;
  debugTarget.textContent = `Target ${String(currentTarget()).padStart(2, '0')}`;
  debugState.textContent = progress === 3
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
    if (!suppressNotchHaptic) haptic(8);
    return 'reset';
  }

  if (progress === 3) {
    if (numberAtNotch(notch) === 69) {
      unlock(notch);
      return 'unlocked';
    }
    haptic(8);
    updateDebug();
    return 'notch';
  }

  if (numberAtNotch(notch) === combination[progress]) {
    targetPasses += 1;
    haptic([55, 18, 75]);
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
  if (!suppressNotchHaptic) haptic(8);
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
  haptic([90, 40, 120]);
  unlockTimer = window.setTimeout(() => {
    combination = makeCombination();
    locked = false;
    resetSequence('New combination ready');
    safe.classList.remove('open');
  }, 2200);
}

function enableCheatMode() {
  if (cheatMode) return;
  cheatMode = true;
  safe.classList.add('cheat');
  logEvent('Cheat mode enabled');
  updateDebug();
}

cheatToggle.addEventListener('click', () => {
  if (!cheatMode) {
    enableCheatMode();
    cheatToggle.setAttribute('aria-pressed', 'true');
    return;
  }

  window.clearTimeout(unlockTimer);
  cheatMode = false;
  locked = false;
  combination = makeCombination();
  safe.classList.remove('cheat', 'open');
  cheatToggle.setAttribute('aria-pressed', 'false');
  resetSequence('New combination generated');
});

shell.addEventListener('pointerdown', (event) => {
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
updateDial();
