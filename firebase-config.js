// firebase-config.js
// Paste your Firebase web app credentials here (Firebase Console →
// Project settings → Your apps → SDK setup and configuration → "Config").
// While these are placeholders, the app runs in local mode (data saved only
// in this browser via IndexedDB).
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey) && !firebaseConfig.apiKey.startsWith("YOUR_");

// Default Gemini model used by the Coach IA and photo scanner.
// Can be overridden from ⚙️ Ajustes in the app.
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
