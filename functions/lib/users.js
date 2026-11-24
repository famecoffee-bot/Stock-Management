// Input checks for creating a stock user. Kept separate so they can be tested
// without Firebase (see functions/test/users.test.js).

const ROLES = ['owner', 'admin', 'member']
const BRANCH_ROLES = ['manager', 'staff', 'viewer']

/**
 * @param {unknown} data what the app sent
 * @param {string} actorRole role of the person asking ("owner" or "admin")
 * @returns {{error: string} | {value: {email:string,password:string,name:string,role:string,branchRoles:Record<string,string>}}}
 */
export function checkNewUser(data, actorRole) {
  const d = data && typeof data === 'object' ? data : {}
  const email = typeof d.email === 'string' ? d.email.trim().toLowerCase() : ''
  const name = typeof d.name === 'string' ? d.name.trim() : ''
  const password = typeof d.password === 'string' ? d.password : ''
  const role = typeof d.role === 'string' ? d.role : 'member'

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Please enter a valid email.' }
  if (!name || name.length > 60) return { error: 'Please enter a name (up to 60 letters).' }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (!ROLES.includes(role)) return { error: 'Unknown role.' }
  if (role === 'owner' && actorRole !== 'owner') return { error: 'Only an owner can create another owner.' }

  const branchRoles = {}
  if (role === 'member') {
    const raw = d.branchRoles && typeof d.branchRoles === 'object' ? d.branchRoles : {}
    for (const [branchId, r] of Object.entries(raw)) {
      if (typeof branchId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(branchId)) return { error: 'Bad branch id.' }
      if (!BRANCH_ROLES.includes(r)) return { error: 'Unknown branch role.' }
      branchRoles[branchId] = r
    }
  }
  return { value: { email, password, name, role, branchRoles } }
}

/** Is this sign-in email on grove-system-kh's owner list? (case-insensitive) */
export function isListedOwner(email, list) {
  if (typeof email !== 'string' || !email || !Array.isArray(list)) return false
  const e = email.trim().toLowerCase()
  return list.some((x) => typeof x === 'string' && x.trim().toLowerCase() === e)
}
