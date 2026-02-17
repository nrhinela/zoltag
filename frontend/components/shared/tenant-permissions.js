export function normalizeTenantRef(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizePermissionKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function getMemberships(currentUser) {
  return Array.isArray(currentUser?.tenants) ? currentUser.tenants : [];
}

export function resolveTenantMembership(currentUser, tenantRef) {
  const normalizedRef = normalizeTenantRef(tenantRef);
  if (!normalizedRef) return null;
  const memberships = getMemberships(currentUser);
  return memberships.find((membership) => {
    const membershipTenantId = normalizeTenantRef(String(membership?.tenant_id || ''));
    const membershipIdentifier = normalizeTenantRef(membership?.tenant_identifier || '');
    return normalizedRef === membershipTenantId || (membershipIdentifier && normalizedRef === membershipIdentifier);
  }) || null;
}

export function getTenantPermissions(currentUser, tenantRef) {
  const membership = resolveTenantMembership(currentUser, tenantRef);
  const permissions = Array.isArray(membership?.permissions) ? membership.permissions : [];
  return permissions
    .map((value) => normalizePermissionKey(value))
    .filter(Boolean);
}

export function hasTenantPermission(currentUser, tenantRef, permissionKey) {
  const target = normalizePermissionKey(permissionKey);
  if (!target) return false;
  return getTenantPermissions(currentUser, tenantRef).includes(target);
}

export function hasPermissionData(currentUser, tenantRef) {
  return getTenantPermissions(currentUser, tenantRef).length > 0;
}

export function getTenantRole(currentUser, tenantRef) {
  const membership = resolveTenantMembership(currentUser, tenantRef);
  return normalizeTenantRef(membership?.role || '').toLowerCase() || null;
}

export function userIsSuperAdmin(currentUser) {
  return !!currentUser?.user?.is_super_admin;
}

export function allowByPermissionOrRole(
  currentUser,
  tenantRef,
  permissionKey,
  _fallbackRoles = ['admin'],
) {
  if (userIsSuperAdmin(currentUser)) return true;
  return hasTenantPermission(currentUser, tenantRef, permissionKey);
}

export function canCurateTenant(currentUser, tenantRef) {
  if (userIsSuperAdmin(currentUser)) return true;
  return hasTenantPermission(currentUser, tenantRef, 'curate.use');
}

export function canViewTenantUsers(currentUser, tenantRef) {
  if (userIsSuperAdmin(currentUser)) return true;
  if (hasTenantPermission(currentUser, tenantRef, 'tenant.users.manage')) return true;
  return hasTenantPermission(currentUser, tenantRef, 'tenant.users.view');
}

export function hasAnyTenantUsersAccess(currentUser) {
  if (userIsSuperAdmin(currentUser)) return true;
  const memberships = getMemberships(currentUser);
  return memberships.some((membership) => {
    const tenantId = normalizeTenantRef(String(membership?.tenant_id || ''));
    if (!tenantId) return false;
    if (canViewTenantUsers(currentUser, tenantId)) return true;
    return false;
  });
}
