// Firebase configuration
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, setPersistence, inMemoryPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  databaseURL: "https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Google Auth Provider with domain restriction
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  hd: 'example.com' // Restrict to example.com domain
});

// Use in-memory persistence for Auth to avoid writing to localStorage or sessionStorage.
// In-memory persistence keeps auth state only in memory and will not be persisted across tabs
// or page reloads, which ensures the app (and Firebase SDK) won't persist auth to localStorage.
try {
  setPersistence(auth, inMemoryPersistence).catch(() => {});
} catch (e) {
  // If persistence API is not available in the environment, ignore and continue.
  console.warn('Could not set Firebase auth persistence to inMemoryPersistence:', e?.message || e);
}

// Test Firebase connection
console.log('Firebase initialized:', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain
});

export default app;