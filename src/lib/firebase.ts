import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

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

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
// Same region as grove-system-kh's functions (Singapore, closest to Cambodia).
export const functions = getFunctions(app, 'asia-southeast1')
