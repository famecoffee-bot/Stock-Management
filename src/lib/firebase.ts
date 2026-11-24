import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

// The same Firebase project as grove-system-kh (grove-mart). These web keys are
// public by design (grove-system-kh already serves them); the Firestore rules
// are what protect the data.
const firebaseConfig = {
  apiKey: 'AIzaSyB0N57v9Jnk71dFRSwWguDAFwDAHqGOew8',
  authDomain: 'grove-mart.firebaseapp.com',
  projectId: 'grove-mart',
  storageBucket: 'grove-mart.firebasestorage.app',
  messagingSenderId: '132089396918',
  appId: '1:132089396918:web:bc57346520d23bb7c6b017',
}

const local = import.meta.env.VITE_EMULATORS === '1'
// In practice mode we use a made-up "demo-" project, so nothing can ever reach the real grove-mart.
export const app = initializeApp(local ? { ...firebaseConfig, projectId: 'demo-grove-stock' } : firebaseConfig)
export const auth = getAuth(app)
// The stock app has its OWN database called "stock" inside the grove-mart project.
// grove-system-kh's data lives in the "(default)" database, which this app never writes to.
export const db = getFirestore(app, 'stock')
// Same region as grove-system-kh's functions (Singapore, closest to Cambodia).
export const functions = getFunctions(app, 'asia-southeast1')

// `npm run dev:local` runs the whole app against a practice copy on this computer
// (Firebase emulators), so we can try everything without touching real data.
if (local) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
