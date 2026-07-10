/**
 * Firebase Realtime Database Service
 * Handles all data persistence exclusively via Firebase RTDB
 * No localStorage fallback - Firebase is required
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get, remove, update } from 'firebase/database';
import cache, { withCache } from '../utils/cache';

// Initialize Firebase (uses same config as main app)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

let db = null;
let firebaseAvailable = false;

// Check if all required Firebase config is present
const hasFirebaseConfig = Object.values(firebaseConfig).every(val => val && val.toString().trim() !== '');

if (hasFirebaseConfig) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    firebaseAvailable = true;
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
    firebaseAvailable = false;
  }
} else {
  console.error('❌ Firebase config incomplete - cannot initialize');
  firebaseAvailable = false;
}

/**
 * Save team members to Firebase (or localStorage fallback)
 * @param {Array} employees - Array of employee objects {id, name}
 * @returns {Promise<void>}
 */
export async function saveTeamMembers(members) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot save team members');
  }
  try {
    const membersRef = ref(db, 'teamMembers');
    
    // Convert array to object with IDs as keys for better Firebase structure
    const membersObj = {};
    if (Array.isArray(members)) {
      members.forEach(member => {
        membersObj[member.id] = member;
      });
    } else {
      // Already an object
      Object.assign(membersObj, members);
    }
    
    await set(membersRef, membersObj);
    
    // Invalidate team members cache
    cache.invalidate('teamMembers');
    
    console.log('✅ Team members saved to Firebase');
    return true;
  } catch (error) {
    console.error('Error saving team members to Firebase:', error);
    throw error;
  }
}

/**
 * Load team members from Firebase (or localStorage fallback)
 * @returns {Promise<Array>} Array of employee objects
 */
export async function loadTeamMembers() {
  // demo: in demo mode, serve fictional employees from a local fixture instead of Firebase
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    const res = await fetch('/demo/employees.json');
    return res.ok ? res.json() : [];
  }
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot load team members');
  }
  
  return withCache(
    'teamMembers',
    async () => {
      try {
        const membersRef = ref(db, 'teamMembers');
        const snapshot = await get(membersRef);
        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log('✅ Team members loaded from Firebase');
          
          // Convert object to array if needed (Firebase stores arrays as objects with numeric keys)
          if (Array.isArray(data)) {
            return data;
          } else if (typeof data === 'object' && data !== null) {
            // Convert object {0: {...}, 1: {...}} to array
            return Object.values(data);
          }
          return [];
        } else {
          console.log('No team members found in Firebase');
          return [];
        }
      } catch (error) {
        console.error('Error loading team members from Firebase:', error);
        throw error;
      }
    },
    15 * 60 * 1000 // Cache for 15 minutes (team members rarely change)
  );
}

/**
 * Delete team members data
 * @returns {Promise<void>}
 */
export async function deleteTeamMembers() {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot delete team members');
  }
  try {
    const teamRef = ref(db, 'teamMembers');
    await remove(teamRef);
    console.log('✅ Team members deleted from Firebase');
  } catch (error) {
    console.error('❌ Error deleting team members:', error);
    throw error;
  }
}

/**
 * Save schedule assignments to Firebase
 * @param {string} weekStart - Week start date (YYYY-MM-DD)
 * @param {Array} assignments - Array of assignment objects
 * @returns {Promise<void>}
 */
export async function saveSchedule(weekStart, assignments) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot save schedule');
  }
  try {
    const scheduleRef = ref(db, `schedules/${weekStart}`);
    const assignmentsObj = {};
    
    assignments.forEach((assignment, index) => {
      assignmentsObj[index] = assignment;
    });
    
    await set(scheduleRef, assignmentsObj);
    console.log(`✅ Schedule for ${weekStart} saved to Firebase`);
  } catch (error) {
    console.error(`❌ Error saving schedule:`, error);
    throw error;
  }
}

/**
 * Load schedule assignments from Firebase
 * @param {string} weekStart - Week start date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of assignment objects
 */
export async function loadSchedule(weekStart) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot load schedule');
  }
  try {
    const scheduleRef = ref(db, `schedules/${weekStart}`);
    const snapshot = await get(scheduleRef);
    
    if (snapshot.exists()) {
      const assignmentsObj = snapshot.val();
      const assignments = Object.values(assignmentsObj);
      console.log(`✅ Schedule for ${weekStart} loaded from Firebase`);
      return assignments;
    }
    
    console.log(`No schedule found for ${weekStart} in Firebase`);
    return [];
  } catch (error) {
    console.error(`❌ Error loading schedule for ${weekStart}:`, error);
    throw error;
  }
}

/**
 * Save shift settings to Firebase
 * @param {Object} settings - Shift settings object
 * @returns {Promise<void>}
 */
export async function saveShiftSettings(settings) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot save shift settings');
  }
  try {
    const settingsRef = ref(db, 'shift-settings');
    await set(settingsRef, settings);
    console.log('✅ Shift settings saved to Firebase');
  } catch (error) {
    console.error('❌ Error saving shift settings:', error);
    throw error;
  }
}


/**
 * Load shift settings from Firebase
 * @returns {Promise<Object>} Shift settings object
 */
export async function loadShiftSettings() {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot load shift settings');
  }
  try {
    const settingsRef = ref(db, 'shift-settings');
    const snapshot = await get(settingsRef);
    
    if (snapshot.exists()) {
      console.log('✅ Shift settings loaded from Firebase');
      return snapshot.val();
    }
    
    console.log('No shift settings found in Firebase');
    return null;
  } catch (error) {
    console.error('❌ Error loading shift settings:', error);
    throw error;
  }
}

/**
 * Save user preferences to Firebase
 * @param {string} userId - User ID
 * @param {Object} preferences - User preferences
 * @returns {Promise<void>}
 */
export async function saveUserPreferences(userId, preferences) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot save user preferences');
  }
  try {
    const prefRef = ref(db, `user-preferences/${userId}`);
    await set(prefRef, preferences);
    console.log(`✅ User preferences for ${userId} saved to Firebase`);
  } catch (error) {
    console.error('❌ Error saving user preferences:', error);
    throw error;
  }
}

/**
 * Load user preferences from Firebase
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User preferences object
 */
export async function loadUserPreferences(userId) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot load user preferences');
  }
  try {
    const prefRef = ref(db, `user-preferences/${userId}`);
    const snapshot = await get(prefRef);
    
    if (snapshot.exists()) {
      console.log(`✅ User preferences for ${userId} loaded from Firebase`);
      return snapshot.val();
    }
    
    console.log(`No user preferences found for ${userId} in Firebase`);
    return null;
  } catch (error) {
    console.error(`❌ Error loading user preferences for ${userId}:`, error);
    throw error;
  }
}

/**
 * Save admin emails list to Firebase
 * @param {Array<string>} adminEmails - Array of admin email addresses
 * @returns {Promise<void>}
 */
export async function saveAdminEmails(adminEmails) {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot save admin emails');
  }
  try {
    const adminsRef = ref(db, 'admin-emails');
    await set(adminsRef, adminEmails);
    
    // Invalidate admin emails cache
    cache.invalidate('adminEmails');
    
    console.log('✅ Admin emails saved to Firebase');
  } catch (error) {
    console.error('❌ Error saving admin emails to Firebase:', error);
    throw error;
  }
}

/**
 * Load admin emails list from Firebase
 * @returns {Promise<Array<string>>} Array of admin email addresses
 */
export async function loadAdminEmails() {
  if (!firebaseAvailable) {
    throw new Error('Firebase not initialized - cannot load admin emails');
  }
  
  return withCache(
    'adminEmails',
    async () => {
      try {
        const adminsRef = ref(db, 'admin-emails');
        const snapshot = await get(adminsRef);
        
        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log('✅ Admin emails loaded from Firebase:', data);
          
          // Ensure we return an array
          if (Array.isArray(data)) {
            return data;
          } else if (typeof data === 'object' && data !== null) {
            // Convert object to array of values
            return Object.values(data);
          } else {
            console.warn('Unexpected admin-emails format, using defaults');
            return [
              'kordzadze2002@gmail.com',
              'nino.gogoladze@example.com',
              'giga.melikidze@example.com'
            ];
          }
        }
        
        // Return default admins if not set in Firebase yet
        console.log('No admin emails found in Firebase, using defaults');
        return [
          'kordzadze2002@gmail.com',
          'nino.gogoladze@example.com',
          'giga.melikidze@example.com'
        ];
      } catch (error) {
        console.error('❌ Error loading admin emails from Firebase:', error);
        throw error;
      }
    },
    15 * 60 * 1000 // Cache for 15 minutes (admin list rarely changes)
  );
}

export default {
  saveTeamMembers,
  loadTeamMembers,
  deleteTeamMembers,
  saveSchedule,
  loadSchedule,
  saveShiftSettings,
  loadShiftSettings,
  saveUserPreferences,
  loadUserPreferences,
  saveAdminEmails,
  loadAdminEmails,
};
