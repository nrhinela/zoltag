// Returns the number of photos for a given tenant
async function getTenantPhotoCount(tenantId) {
    const response = await fetch(`/api/v1/admin/tenants/${tenantId}/photo_count`);
    if (!response.ok) return 0;
    const data = await response.json();
    return data.count || 0;
}

window.getTenantPhotoCount = getTenantPhotoCount;
