let initialized = false;
let cached = null;

export async function getFirebase() {
  if (initialized && cached) return cached;

  // Dynamically import Firebase modules only when needed
  const [{ initializeApp }, { getAuth, GoogleAuthProvider }, { getDatabase }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/database')
  ]);

  const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "your-project-id.firebaseapp.com",
    databaseURL: "https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "your-project-id",
    storageBucket: "your-project-id.firebasestorage.app",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:YOUR_APP_ID"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ hd: 'example.com' });
  const db = getDatabase(app);

  cached = { app, auth, googleProvider, db };
  initialized = true;
  console.log('Lazy Firebase initialized');
  return cached;
}

export default getFirebase;
