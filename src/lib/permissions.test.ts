import { expect, test } from 'vitest'
import { canAssignRole, canAtBranch, isAdmin, visibleBranchIds } from './permissions'
import type { InvUser } from './types'

const u = (role: InvUser['role'], branchRoles: InvUser['branchRoles'] = {}, active = true): InvUser => ({
  id: role,
  name: role,
  email: `${role}@x.kh`,
  role,
  branchRoles,
  active,
})

test('admins and owners can do everything at every branch', () => {
  expect(isAdmin(u('owner'))).toBe(true)
  expect(canAtBranch(u('admin'), 'b9', 'manager')).toBe(true)
})

test('members only at their branches, up to their level', () => {
  const staff = u('member', { b1: 'staff' })
  expect(canAtBranch(staff, 'b1', 'viewer')).toBe(true)
  expect(canAtBranch(staff, 'b1', 'staff')).toBe(true)
  expect(canAtBranch(staff, 'b1', 'manager')).toBe(false)
  expect(canAtBranch(staff, 'b2', 'viewer')).toBe(false)
  expect(visibleBranchIds(staff, ['b1', 'b2'])).toEqual(['b1'])
})

test('a blocked person can do nothing', () => {
  const gone = u('owner', {}, false)
  expect(isAdmin(gone)).toBe(false)
  expect(visibleBranchIds(gone, ['b1'])).toEqual([])
})

test('admins cannot hand out the owner role', () => {
  expect(canAssignRole(u('admin'), 'owner')).toBe(false)
  expect(canAssignRole(u('admin'), 'member')).toBe(true)
  expect(canAssignRole(u('owner'), 'owner')).toBe(true)
})
