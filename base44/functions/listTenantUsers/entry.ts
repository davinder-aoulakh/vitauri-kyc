import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const callerTenantId = user.tenant_id || user.data?.tenant_id;
    const callerAppRole = user.app_role || user.data?.app_role;

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    let targetTenantId = callerTenantId;
    if (body?.target_tenant_id && callerAppRole === 'Vitauri Ops') {
      targetTenantId = body.target_tenant_id;
    }

    if (!targetTenantId) {
      return Response.json({ error: 'No tenant associated with this user' }, { status: 400 });
    }

    const allUsers = await base44.asServiceRole.entities.User.list();
    const tenantUsers = (allUsers || []).filter(u => {
      const uTenantId = u.tenant_id || u.data?.tenant_id;
      return uTenantId === targetTenantId;
    });

    const sanitized = tenantUsers.map(u => ({
      id: u.id,
      full_name: u.full_name || u.data?.full_name,
      email: u.email,
      role: u.role || u.data?.role,
      app_role: u.app_role || u.data?.app_role,
      is_active: (u.is_active !== undefined ? u.is_active : u.data?.is_active) !== false,
      mfa_enabled: !!(u.mfa_enabled !== undefined ? u.mfa_enabled : u.data?.mfa_enabled),
      tenant_id: u.tenant_id || u.data?.tenant_id,
    }));

    return Response.json({ users: sanitized });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}