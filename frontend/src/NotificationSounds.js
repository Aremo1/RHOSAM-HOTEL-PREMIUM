/**
 * NotificationSounds.js — Web Audio API sound synthesizer for hotel notifications
 * Each notification type gets a unique, recognizable tone pattern.
 * No audio files needed — everything is synthesized in real-time.
 */

// Default sound configuration per notification type
const DEFAULT_SOUNDS = {
  ROOM_SERVICE: {
    name: "Dining Chime",
    description: "Warm, inviting two-tone chime",
    color: "#10b981",
    notes: [523.25, 659.25, 783.99], // C5, E5, G5 — major chord
    durations: [0.12, 0.12, 0.25],
    waveform: "sine",
    volume: 0.3,
  },
  SPA: {
    name: "Calm Waves",
    description: "Soft, descending spa tone",
    color: "#8b5cf6",
    notes: [698.46, 587.33, 523.25], // F5, D5, C5 — descending
    durations: [0.2, 0.2, 0.3],
    waveform: "sine",
    volume: 0.25,
  },
  HOUSEKEEPING: {
    name: "Quick Alert",
    description: "Short double-tap notification",
    color: "#0ea5e9",
    notes: [880, 880], // A5, A5
    durations: [0.08, 0.15],
    waveform: "triangle",
    volume: 0.3,
  },
  MAINTENANCE: {
    name: "Work Order",
    description: "Three-note ascending alert",
    color: "#f59e0b",
    notes: [440, 554.37, 659.25], // A4, C#5, E5
    durations: [0.1, 0.1, 0.2],
    waveform: "triangle",
    volume: 0.3,
  },
  SECURITY: {
    name: "Alert Tone",
    description: "Urgent high-priority alert",
    color: "#ef4444",
    notes: [1046.5, 987.77, 1046.5], // C6, B5, C6
    durations: [0.08, 0.08, 0.2],
    waveform: "square",
    volume: 0.2,
  },
  SHIFT: {
    name: "Schedule Ping",
    description: "Gentle two-note ping",
    color: "#6366f1",
    notes: [659.25, 783.99], // E5, G5
    durations: [0.1, 0.2],
    waveform: "sine",
    volume: 0.25,
  },
  CHECK_IN: {
    name: "Welcome Bell",
    description: "Bright, welcoming three-note bell",
    color: "#10b981",
    notes: [783.99, 987.77, 1174.66], // G5, B5, D6
    durations: [0.12, 0.12, 0.3],
    waveform: "sine",
    volume: 0.3,
  },
  CHECK_OUT: {
    name: "Farewell",
    description: "Warm descending farewell tone",
    color: "#f59e0b",
    notes: [987.77, 783.99, 587.33], // B5, G5, D5
    durations: [0.15, 0.15, 0.35],
    waveform: "sine",
    volume: 0.25,
  },
  FEEDBACK: {
    name: "Feedback",
    description: "Soft single-note acknowledgment",
    color: "#ec4899",
    notes: [659.25], // E5
    durations: [0.2],
    waveform: "sine",
    volume: 0.25,
  },
  GENERAL: {
    name: "Default Chime",
    description: "Standard notification chime",
    color: "#6b7280",
    notes: [587.33, 739.99], // D5, F#5
    durations: [0.12, 0.2],
    waveform: "triangle",
    volume: 0.3,
  },
  INFO: {
    name: "Info Tone",
    description: "Neutral information tone",
    color: "#3b82f6",
    notes: [440, 554.37], // A4, C#5
    durations: [0.15, 0.2],
    waveform: "sine",
    volume: 0.25,
  },
  WARNING: {
    name: "Warning",
    description: "Attention-grabbing warning tone",
    color: "#f59e0b",
    notes: [660, 495, 660], // E5, C5, E5
    durations: [0.1, 0.1, 0.25],
    waveform: "triangle",
    volume: 0.3,
  },
  ERROR: {
    name: "Error Alert",
    description: "Low-pitched error notification",
    color: "#ef4444",
    notes: [330, 277.18, 220], // E4, C#4, A3
    durations: [0.1, 0.1, 0.3],
    waveform: "sawtooth",
    volume: 0.15,
  },
};

// Preset tone banks users can choose from
const TONE_PRESETS = {
  chime: {
    name: "Chime",
    notes: [523.25, 659.25, 783.99],
    durations: [0.12, 0.12, 0.25],
    waveform: "sine",
  },
  ping: {
    name: "Ping",
    notes: [880],
    durations: [0.15],
    waveform: "triangle",
  },
  bell: {
    name: "Bell",
    notes: [987.77, 1174.66],
    durations: [0.1, 0.3],
    waveform: "sine",
  },
  alert: {
    name: "Alert",
    notes: [1046.5, 880, 1046.5],
    durations: [0.08, 0.08, 0.2],
    waveform: "square",
  },
  gentle: {
    name: "Gentle",
    notes: [440, 554.37],
    durations: [0.15, 0.25],
    waveform: "sine",
  },
  urgent: {
    name: "Urgent",
    notes: [1174.66, 1046.5, 1174.66, 1046.5],
    durations: [0.06, 0.06, 0.06, 0.15],
    waveform: "square",
  },
  calm: {
    name: "Calm",
    notes: [392, 349.23, 329.63],
    durations: [0.2, 0.2, 0.35],
    waveform: "sine",
  },
  digital: {
    name: "Digital",
    notes: [1046.5, 1318.51, 1567.98],
    durations: [0.06, 0.06, 0.12],
    waveform: "square",
  },
  whoosh: {
    name: "Whoosh",
    notes: [200, 800, 400],
    durations: [0.05, 0.1, 0.15],
    waveform: "sawtooth",
  },
};

let audioContext = null;
let masterVolume = 0.5;
let soundEnabled = true;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

/**
 * Play a synthesized tone pattern
 * @param {string} type - Notification type (ROOM_SERVICE, SPA, etc.)
 * @param {object} overrides - Optional overrides for notes, waveform, etc.
 */
function playNotificationSound(type, overrides = {}) {
  if (!soundEnabled) return;

  const config = { ...(DEFAULT_SOUNDS[type] || DEFAULT_SOUNDS.GENERAL), ...overrides };
  const ctx = getAudioContext();

  // Resume audio context if suspended (browser autoplay policy)
  if (ctx.state === "suspended") ctx.resume();

  let startTime = ctx.currentTime + 0.02; // tiny delay to avoid clicks
  const notes = config.notes || [587.33];
  const durations = config.durations || [0.2];
  const waveform = config.waveform || "sine";
  const volume = (config.volume || 0.3) * masterVolume;

  notes.forEach((freq, i) => {
    const dur = durations[i] || durations[durations.length - 1] || 0.2;
    const noteStartTime = startTime;

    // Create oscillator
    const osc = ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, noteStartTime);

    // Apply slight frequency bend for organic feel
    if (waveform === "sine" || waveform === "triangle") {
      osc.frequency.setValueAtTime(freq * 1.01, noteStartTime);
      osc.frequency.exponentialRampToValueAtTime(freq, noteStartTime + dur * 0.3);
    }

    // Gain envelope (attack-sustain-release)
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, noteStartTime);
    gainNode.gain.linearRampToValueAtTime(volume, noteStartTime + 0.01); // attack
    gainNode.gain.setValueAtTime(volume, noteStartTime + dur * 0.6); // sustain
    gainNode.gain.exponentialRampToValueAtTime(0.001, noteStartTime + dur); // release

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(noteStartTime);
    osc.stop(noteStartTime + dur + 0.01);

    startTime = noteStartTime + dur;
  });
}

/**
 * Preview a specific tone preset
 */
function previewTone(presetKey) {
  const preset = TONE_PRESETS[presetKey];
  if (!preset) return;
  playNotificationSound(null, {
    notes: preset.notes,
    durations: preset.durations,
    waveform: preset.waveform,
    volume: 0.3,
  });
}

/**
 * Preview a notification type's current sound
 */
function previewTypeSound(type) {
  const config = DEFAULT_SOUNDS[type];
  if (!config) return;
  playNotificationSound(type);
}

/**
 * Get saved sound preferences from localStorage
 */
function getSoundPreferences() {
  try {
    const saved = localStorage.getItem("rhosam_notif_sounds");
    if (saved) return JSON.parse(saved);
  } catch {}
  // Return defaults
  const prefs = {};
  for (const [type, config] of Object.entries(DEFAULT_SOUNDS)) {
    prefs[type] = {
      preset: null, // null = use default for this type
      customTone: null,
      volume: config.volume,
      enabled: true,
    };
  }
  return prefs;
}

/**
 * Save sound preferences to localStorage
 */
function saveSoundPreferences(prefs) {
  localStorage.setItem("rhosam_notif_sounds", JSON.stringify(prefs));
}

/**
 * Get master volume (0-1)
 */
function getMasterVolume() {
  const v = localStorage.getItem("rhosam_notif_volume");
  return v !== null ? parseFloat(v) : 0.5;
}

/**
 * Set master volume (0-1)
 */
function setMasterVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem("rhosam_notif_volume", String(masterVolume));
}

/**
 * Get sound enabled state
 */
function isSoundEnabled() {
  const v = localStorage.getItem("rhosam_notif_sound_enabled");
  return v !== null ? v === "true" : true;
}

/**
 * Set sound enabled state
 */
function setSoundEnabled(enabled) {
  soundEnabled = enabled;
  localStorage.setItem("rhosam_notif_sound_enabled", String(enabled));
}

// Initialize from localStorage
masterVolume = getMasterVolume();
soundEnabled = isSoundEnabled();

export {
  DEFAULT_SOUNDS,
  TONE_PRESETS,
  playNotificationSound,
  previewTone,
  previewTypeSound,
  getSoundPreferences,
  saveSoundPreferences,
  getMasterVolume,
  setMasterVolume,
  isSoundEnabled,
  setSoundEnabled,
};
