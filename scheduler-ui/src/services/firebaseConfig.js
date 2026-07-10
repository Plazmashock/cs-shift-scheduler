import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, push, child } from 'firebase/database';

// Firebase Configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

// Initialize Firebase only if an API key is provided. Otherwise operate in backend-only mode.
let app = null;
let database = null;
const _hasFirebase = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL);
if (_hasFirebase) {
  try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
  } catch (e) {
    console.warn('Firebase initialization failed, continuing in backend-only mode', e);
    app = null;
    database = null;
  }
} else {
  console.info('Firebase not configured. Running in backend-only mode.');
}

// Default configuration
const DEFAULT_CONFIG = {
  staffRequirements: {
    Morning: { min_staff: 1, max_staff: 1 },
    Day: { min_staff: 2, max_staff: 4 },
    Afternoon: { min_staff: 2, max_staff: 4 },
    Night: { min_staff: 2, max_staff: 5 }
  },
  patterns: ['A', 'B', 'C', 'D'],
  patternDefinitions: {
    A: { morning: 1, day: 1, afternoon: 1, night: 2 },
    B: { morning: 0, day: 1, afternoon: 2, night: 2 },
    C: { morning: 1, day: 1, afternoon: 2, night: 1 },
    D: { morning: 0, day: 1, afternoon: 2, night: 2 }
  },
  flexEmployeeCount: 0
};

// --- Helpers: convert between backend shape and UI shape ---
const UI_DEFAULT = {
  staffRequirements: {
    morning: { min: 1, max: 1 },
    day: { min: 2, max: 4 },
    afternoon: { min: 2, max: 4 },
    night: { min: 2, max: 5 }
  },
  patterns: ['A', 'B', 'C', 'D'],
  patternDefinitions: {
    A: { morning: 1, day: 1, afternoon: 1, night: 2 },
    B: { morning: 0, day: 1, afternoon: 2, night: 2 },
    C: { morning: 1, day: 1, afternoon: 2, night: 1 },
    D: { morning: 0, day: 1, afternoon: 2, night: 2 }
  },
  flexEmployeeCount: 0,
  employees: []
};

function toUIConfig(cfg) {
  if (!cfg) return UI_DEFAULT;
  const sr = cfg.staffRequirements || {};
  const map = {
    Morning: 'morning',
    Day: 'day',
    Afternoon: 'afternoon',
    Night: 'night'
  };

  const uiReq = {};
  for (const [bk, uk] of Object.entries(map)) {
    const v = sr[bk] || sr[uk] || {};
    const min = (v.min !== undefined) ? v.min : v.min_staff;
    const max = (v.max !== undefined) ? v.max : v.max_staff;
    uiReq[uk] = { min: (min !== undefined ? min : 0), max: (max !== undefined ? max : 0) };
  }

  // Normalize backend patternDefinitions into UI-friendly structured objects
  const backendPD = cfg.patternDefinitions || {};
  const uiPD = {};
  for (const key of Object.keys(backendPD)) {
    const entry = backendPD[key];
    if (typeof entry === 'string') {
      // try to parse legacy string
      const m = entry.match(/(\d+)\s+morning/i);
      // Quick parse attempt - full parsing handled on backend; if string, include as-is for display
      uiPD[key] = entry;
    } else {
      uiPD[key] = entry;
    }
  }

  return {
    staffRequirements: uiReq,
    patterns: cfg.patterns || UI_DEFAULT.patterns,
    patternDefinitions: Object.keys(uiPD).length ? uiPD : UI_DEFAULT.patternDefinitions,
    flexEmployeeCount: cfg.flexEmployeeCount || cfg.flexEmployees || 0,
    employees: cfg.employees || UI_DEFAULT.employees
  };
}

function toBackendConfig(uiCfg) {
  const sr = uiCfg.staffRequirements || {};
  const map = {
    morning: 'Morning',
    day: 'Day',
    afternoon: 'Afternoon',
    night: 'Night'
  };
  const backendReq = {};
  for (const [uk, bk] of Object.entries(map)) {
    const v = sr[uk] || {};
    backendReq[bk] = { min_staff: v.min || 0, max_staff: v.max || 0 };
  }

  // Preserve dynamic pattern keys exactly as provided in UI shape
  const pd = uiCfg.patternDefinitions || UI_DEFAULT.patternDefinitions;

  return {
    staffRequirements: backendReq,
    patterns: uiCfg.patterns || UI_DEFAULT.patterns,
    patternDefinitions: pd,
    flexEmployeeCount: uiCfg.flexEmployeeCount || 0,
    employees: uiCfg.employees || UI_DEFAULT.employees
  };
}

// Backend API URL (Vite exposes env vars via import.meta.env)
// Default to the production Cloud Run endpoint provided by the project owner.
const API_BASE_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_APP_API_URL || 'https://scheduler-api-000000000000.europe-west1.run.app';

/**
 * Load current configuration from backend, falling back to Firebase
 */
export const loadConfig = async () => {
  try {
    // Try to load from backend first
    const response = await fetch(`${API_BASE_URL}/api/config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      // convert backend shape to UI shape
      const uiCfg = toUIConfig(data.config || DEFAULT_CONFIG);

      // If the returned config lacks an employees list, try to fetch canonical
      // employees from backend (/api/employees) so the UI shows the roster.
      try {
        if (!uiCfg.employees || uiCfg.employees.length === 0) {
          const empResp = await fetch(`${API_BASE_URL}/api/employees`, { method: 'GET' });
          if (empResp.ok) {
            const empData = await empResp.json();
            if (empData && Array.isArray(empData.employees) && empData.employees.length > 0) {
              uiCfg.employees = empData.employees;
            }
          }
        }
      } catch (e) {
        console.debug('Could not fetch /api/employees fallback:', e);
      }

      return uiCfg;
    }
  } catch (error) {
    console.log('Backend config fetch failed, falling back to Firebase:', error);
  }

  // Fallback to Firebase
  try {
    if (database) {
      const configRef = ref(database, 'config/current');
      const snapshot = await get(configRef);
      if (snapshot.exists()) {
        // Firebase history/current may be stored in UI shape; normalize
        return toUIConfig(snapshot.val());
      }
    } else {
      console.debug('Skipping Firebase fallback: database not initialized');
    }
  } catch (firebaseError) {
    console.log('Firebase config fetch failed:', firebaseError);
  }

  return toUIConfig(DEFAULT_CONFIG);
}

/**
 * Save configuration to both backend and Firebase
 */
export const saveConfig = async (config, { adminEmail, timestamp = new Date().toISOString() }) => {
  try {
    // Validate config first
    const backendPayload = toBackendConfig(config);
    const validationResponse = await fetch(`${API_BASE_URL}/api/validate-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config: backendPayload }),
    });

    const validationData = await validationResponse.json();
    if (!validationData.valid) {
      throw new Error(`Config validation failed: ${validationData.errors.join(', ')}`);
    }

    // Save to backend
    const backendResponse = await fetch(`${API_BASE_URL}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config: backendPayload, adminEmail }),
    });

    if (!backendResponse.ok) {
      const error = await backendResponse.json();
      throw new Error(`Backend save failed: ${error.detail}`);
    }

    const backendData = await backendResponse.json();
    
    // Also save to Firebase for history and redundancy (if initialized)
    if (database) {
      try {
        const currentRef = ref(database, 'config/current');
        await set(currentRef, config);

        const historyRef = ref(database, 'config/history');
        const newHistoryEntry = {
          config, // store UI shape for frontend convenience
          timestamp,
          admin: adminEmail,
        };
        await push(historyRef, newHistoryEntry);
      } catch (firebaseError) {
        console.log('Firebase save failed (backend save succeeded):', firebaseError);
      }
    } else {
      console.debug('Skipping Firebase save: database not initialized');
    }

    return {
      success: true,
      message: 'Configuration saved successfully',
      timestamp,
    };
  } catch (error) {
    console.error('Error saving config:', error);
    throw error;
  }
};

/**
 * Validate configuration via backend without saving.
 */
export const validateConfig = async (config) => {
  try {
    const backendPayload = toBackendConfig(config);
    const resp = await fetch(`${API_BASE_URL}/api/validate-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: backendPayload })
    });

    if (!resp.ok) {
      const err = await resp.json();
      return { valid: false, errors: [err.detail || 'Validation API error'] };
    }

    const data = await resp.json();
    return data;
  } catch (error) {
    console.error('validateConfig error', error);
    throw error;
  }
};

// Overload: accept assumedEmployees to run feasibility checks
export const validateConfigWithAssumed = async (config, assumedEmployees) => {
  try {
    const backendPayload = toBackendConfig(config);
    const resp = await fetch(`${API_BASE_URL}/api/validate-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: backendPayload, assumedEmployees })
    });

    if (!resp.ok) {
      // If the deployed backend doesn't have this endpoint (404), compute a local
      // feasibility diagnostic so the UI can still offer useful feedback.
      if (resp.status === 404) {
        try {
          const calculateTotalSlotsNeeded = (backendCfg) => {
            const sr = backendCfg.staffRequirements || {};
            let daily = 0;
            for (const k of Object.keys(sr)) {
              const v = sr[k] || {};
              const min = (v.min_staff !== undefined) ? v.min_staff : (v.min || 0);
              daily += (min || 0);
            }
            return daily * 7;
          };

          const calculateMinEmployeesNeeded = (backendCfg) => {
            const total = calculateTotalSlotsNeeded(backendCfg);
            return Math.ceil(total / 5);
          };

          // conservative per-employee max defaults
          const perEmpMax = { morning: 1, day: 3, afternoon: 5, night: 5 };
          const pd = backendPayload.patternDefinitions || {};
          for (const pat of Object.keys(pd)) {
            const entry = pd[pat];
            if (entry && typeof entry === 'object') {
              for (const sk of ['morning', 'day', 'afternoon', 'night']) {
                try {
                  const val = parseInt(entry[sk] || 0) || 0;
                  perEmpMax[sk] = Math.max(perEmpMax[sk] || 0, val);
                } catch (e) {
                  // ignore
                }
              }
            }
          }

          const totalSlots = calculateTotalSlotsNeeded(backendPayload);
          const minEmployees = calculateMinEmployeesNeeded(backendPayload);

          const diagnostic = {
            total_staff_slots_needed: totalSlots,
            estimated_min_employees: minEmployees,
            assumed_employees: assumedEmployees,
            per_shift_weekly_required: {},
            per_shift_weekly_max_capacity: {},
            feasible: true,
            issues: []
          };

          // per-shift weekly required (expect backend keys like Morning/Day/...)
          for (const shiftKey of Object.keys(backendPayload.staffRequirements || {})) {
            const req = backendPayload.staffRequirements[shiftKey] || {};
            const min = (req.min_staff !== undefined) ? req.min_staff : (req.min || 0);
            diagnostic.per_shift_weekly_required[shiftKey] = (min || 0) * 7;
            const low = shiftKey.toLowerCase();
            const maxCap = (perEmpMax[low] || 0) * (assumedEmployees || 0);
            diagnostic.per_shift_weekly_max_capacity[shiftKey] = maxCap;
            if (maxCap < diagnostic.per_shift_weekly_required[shiftKey]) {
              diagnostic.feasible = false;
              diagnostic.issues.push({ shift: shiftKey, reason: `Insufficient capacity for ${shiftKey}: required ${diagnostic.per_shift_weekly_required[shiftKey]} slots/week but max possible with ${assumedEmployees} employees is ${maxCap}` });
            }
          }

          const totalMaxCapacity = (assumedEmployees || 0) * 5;
          if (totalSlots > totalMaxCapacity) {
            diagnostic.feasible = false;
            diagnostic.issues.push({ reason: `Total weekly required slots ${totalSlots} exceed total capacity of ${totalMaxCapacity} (assumed ${assumedEmployees} employees × 5 shifts/week)` });
          }

          return {
            status: 'success',
            valid: true,
            errors: [],
            warnings: [],
            summary: {
              total_shifts_per_employee: 5,
              total_staff_slots_needed: totalSlots,
              required_employees: minEmployees
            },
            diagnostic
          };
        } catch (ex) {
          const err = await resp.json().catch(() => ({ detail: 'Not Found' }));
          return { valid: false, errors: [err.detail || 'Validation API error'] };
        }
      }

      const err = await resp.json();
      return { valid: false, errors: [err.detail || 'Validation API error'] };
    }

    const data = await resp.json();
    return data;
  } catch (error) {
    console.error('validateConfigWithAssumed error', error);
    // Return a structured diagnostic describing the network error so UI can display it
    const reason = (error && error.message) ? error.message : 'Network error';
    return {
      valid: false,
      errors: ["Failed to reach validation service"],
      diagnostic: {
        feasible: false,
        issues: [{ reason: `Could not reach backend at ${API_BASE_URL}/api/validate-config: ${reason}` }]
      }
    };
  }
};

/**
 * Get configuration history
 */
export const getConfigHistory = async () => {
  try {
    if (!database) {
      console.debug('Skipping getConfigHistory: database not initialized');
      return [];
    }

    const historyRef = ref(database, 'config/history');
    const snapshot = await get(historyRef);

    if (!snapshot.exists()) {
      return [];
    }

    const historyData = snapshot.val();
    const historyArray = Object.entries(historyData).map(([id, entry]) => ({
      id,
      // ensure stored history entries are normalized to UI shape
      ...entry,
      config: toUIConfig(entry.config)
    }));

    // Sort by timestamp (newest first)
    return historyArray.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
  } catch (error) {
    console.error('Error fetching config history:', error);
    return [];
  }
};

/**
 * Rollback to a previous configuration
 */
export const rollbackConfig = async (config, timestamp, { adminEmail }) => {
  try {
    // Save current as history entry before rollback
    const backupEntry = {
      config: await loadConfig(),
      timestamp: new Date().toISOString(),
      admin: adminEmail,
      rollbackFrom: timestamp,
    };

    if (database) {
      const historyRef = ref(database, 'config/history');
      await push(historyRef, backupEntry);
    } else {
      console.debug('Skipping Firebase backup before rollback: database not initialized');
    }

    // Save rolled-back config to backend
    const backendPayload = toBackendConfig(config);
    const backendResponse = await fetch(`${API_BASE_URL}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config: backendPayload, adminEmail }),
    });

    if (!backendResponse.ok) {
      const error = await backendResponse.json();
      throw new Error(`Backend rollback failed: ${error.detail}`);
    }

    // Update Firebase (store UI shape for frontend convenience)
    if (database) {
      const currentRef = ref(database, 'config/current');
      await set(currentRef, config);
    }

    return {
      success: true,
      message: 'Configuration rolled back successfully',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error rolling back config:', error);
    throw error;
  }
};
