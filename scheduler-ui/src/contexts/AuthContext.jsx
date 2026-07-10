import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  onAuthStateChanged as _onAuthStateChanged, 
  signInWithPopup as _signInWithPopup, 
  signOut as _firebaseSignOut 
} from 'firebase/auth';
import getFirebase from '../services/lazyFirebase';
import { loadAdminEmails } from '../services/firebaseService';
import cache from '../utils/cache';

const AuthContext = createContext({});

// Default admin users (fallback if Firebase load fails)
const DEFAULT_ADMIN_USERS = [
  'kordzadze2002@gmail.com',
  'nino.gogoladze@example.com',
  'giga.melikidze@example.com'
];

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmails, setAdminEmails] = useState(new Set(DEFAULT_ADMIN_USERS));

  useEffect(() => {
    // demo: bypass Firebase Auth entirely with a fake admin user (local demo only)
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      setUser({
        email: 'demo.manager@example.com',
        displayName: 'Demo Manager',
        getIdToken: async () => 'demo-token'
      });
      setIsAdmin(true);
      setLoading(false);
      return;
    }
    let unsubscribe = null;
    let authInstance = null;
    let googleProvider = null;

    (async () => {
      try {
        console.log('AuthProvider: Lazy-initializing Firebase for auth');
        
        // Clear admin emails cache on app initialization to ensure fresh data
        // This fixes issues where emails were added after users cached the old list
        cache.invalidate('adminEmails');
        console.log('🔄 Admin emails cache cleared on app init');
        
        const firebase = await getFirebase();
        authInstance = firebase.auth;
        googleProvider = firebase.googleProvider;

        unsubscribe = _onAuthStateChanged(authInstance, async (user) => {
          console.log('AuthProvider: Auth state changed', { user: user?.email, hasUser: !!user });
          
          if (user) {
            // Load admin emails from Firebase once user is authenticated
            try {
              const emails = await loadAdminEmails();
              // Ensure emails is an array
              const emailArray = Array.isArray(emails) ? emails : [];
              setAdminEmails(new Set(emailArray));
              console.log('✅ Admin emails loaded:', emailArray);
              console.log('🔍 Checking admin status for:', user.email);
              console.log('🔍 Email list:', emailArray);
              console.log('🔍 Includes check result:', emailArray.includes(user.email));
              
              // Enforce @example.com domain: allow only company emails; others are rejected and signed out
              if (user.email && user.email.endsWith('@example.com')) {
                console.log('AuthProvider: User authenticated and allowed:', user.email);
                const userIsAdmin = emailArray.includes(user.email);
                console.log('🔍 Final isAdmin value:', userIsAdmin);
                setUser(user);
                setIsAdmin(userIsAdmin);
                setError(null);
              } else {
                console.log('AuthProvider: User email not allowed, signing out:', user?.email);
                setUser(null);
                setIsAdmin(false);
                setError(`Access denied. Only @example.com emails are allowed. Your email: ${user?.email}`);
                _firebaseSignOut(authInstance);
              }
            } catch (err) {
              console.error('Failed to load admin emails, using defaults:', err);
              setAdminEmails(new Set(DEFAULT_ADMIN_USERS));
              
              // Still proceed with authentication
              if (user.email && user.email.endsWith('@example.com')) {
                console.log('AuthProvider: User authenticated and allowed:', user.email);
                const userIsAdmin = DEFAULT_ADMIN_USERS.includes(user.email);
                setUser(user);
                setIsAdmin(userIsAdmin);
                setError(null);
              } else {
                console.log('AuthProvider: User email not allowed, signing out:', user?.email);
                setUser(null);
                setIsAdmin(false);
                setError(`Access denied. Only @example.com emails are allowed. Your email: ${user?.email}`);
                _firebaseSignOut(authInstance);
              }
            }
          } else {
            console.log('AuthProvider: No user authenticated');
            setUser(null);
            setIsAdmin(false);
            setError(null);
          }
          setLoading(false);
        });
      } catch (err) {
        console.error('AuthProvider: Failed to initialize auth:', err);
        setLoading(false);
      }
    })();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []); // Remove adminEmails dependency

  const signInWithGoogle = async () => {
    try {
      console.log('AuthProvider: Starting Google sign-in');
      setLoading(true);
      setError(null);
      const { auth: authInstance, googleProvider } = await getFirebase();
      const result = await _signInWithPopup(authInstance, googleProvider);
      const user = result.user;
      
      console.log('AuthProvider: Google sign-in successful:', user.email);
      
      // Double-check domain restriction
      if (!user.email || !user.email.endsWith('@example.com')) {
        console.log('AuthProvider: Domain check failed, signing out:', user.email);
        await _firebaseSignOut(authInstance);
        throw new Error(`Access denied. Only @example.com emails are allowed. Your email: ${user.email}`);
      }
      
      console.log('AuthProvider: Domain check passed:', user.email);
      setUser(user);
      
      // Reload page after successful login to ensure all data is properly initialized
      console.log('AuthProvider: Reloading page to initialize schedule data...');
      setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      console.error('AuthProvider: Sign in error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled. Please try again.');
      } else if (error.code === 'auth/popup-blocked') {
        setError('Pop-up was blocked by browser. Please allow pop-ups and try again.');
      } else {
        setError(error.message);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      const { auth: authInstance } = await getFirebase();
      await _firebaseSignOut(authInstance);
      setUser(null);
      setIsAdmin(false);
      setError(null);
    } catch (error) {
      console.error('Sign out error:', error);
      setError(error.message);
    }
  };

  const getIdToken = async () => {
    if (user) {
      try {
        const token = await user.getIdToken(true); // Force refresh
        return token;
      } catch (error) {
        console.error('AuthContext: Error getting ID token:', error);
        return null;
      }
    }
    return null;
  };

  // Reload admin emails from Firebase
  const reloadAdminEmails = async () => {
    try {
      // Invalidate cache to ensure fresh data
      cache.invalidate('adminEmails');
      
      const emails = await loadAdminEmails();
      setAdminEmails(new Set(emails));
      
      // Re-check if current user is admin
      if (user?.email) {
        setIsAdmin(emails.includes(user.email));
      }
      
      console.log('✅ Admin emails reloaded:', emails);
    } catch (err) {
      console.error('Failed to reload admin emails:', err);
      throw err;
    }
  };

  const value = {
    user,
    loading,
    error,
    isAdmin,
    signInWithGoogle,
    signOut,
    getIdToken,
    reloadAdminEmails,
    isAuthenticated: !!user && user.email?.endsWith('@example.com')
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};