import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkNewUser, isListedOwner } from '../lib/users.js'

const ok = { email: 'Dara@Grove.kh ', name: 'Dara', password: 'secret123', role: 'member', branchRoles: { b1: 'staff' } }

test('accepts a valid member and cleans the email', () => {
  const r = checkNewUser(ok, 'admin')
  assert.deepEqual(r.value, { email: 'dara@grove.kh', name: 'Dara', password: 'secret123', role: 'member', branchRoles: { b1: 'staff' } })
})

test('rejects short passwords and bad emails', () => {
  assert.ok(checkNewUser({ ...ok, password: 'short' }, 'owner').error)
  assert.ok(checkNewUser({ ...ok, email: 'not-an-email' }, 'owner').error)
})

test('only an owner can create an owner', () => {
  assert.ok(checkNewUser({ ...ok, role: 'owner' }, 'admin').error)
  assert.equal(checkNewUser({ ...ok, role: 'owner' }, 'owner').value.role, 'owner')
})

test('admins and owners get no branch list (they see all branches)', () => {
  assert.deepEqual(checkNewUser({ ...ok, role: 'admin' }, 'owner').value.branchRoles, {})
})

test('rejects unknown branch roles', () => {
  assert.ok(checkNewUser({ ...ok, branchRoles: { b1: 'boss' } }, 'owner').error)
})

test('owner list check ignores case and rejects missing data', () => {
  assert.equal(isListedOwner('Boss@Grove.kh', ['boss@grove.kh']), true)
  assert.equal(isListedOwner('other@grove.kh', ['boss@grove.kh']), false)
  assert.equal(isListedOwner('boss@grove.kh', undefined), false)
  assert.equal(isListedOwner(undefined, ['boss@grove.kh']), false)
})
