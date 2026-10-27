const API_ROOT = import.meta.env.VITE_API_ROOT || "/api";

export async function apiRequest(path, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) requestHeaders["Content-Type"] = "application/json";
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: requestHeaders,
    credentials: "include",
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
}

export const normalizeProduct = product => ({
  id: product.product_id,
  name: product.product_name,
  description: product.description || "",
  price: String(product.selling_price ?? ""),
  image: product.image_url || ""
});

export const normalizePlan = plan => ({
  id: plan.plan_id,
  name: plan.business_name || "",
  product: plan.product || "",
  customers: plan.target_customers || "",
  price: String(plan.selling_price ?? ""),
  costs: String(plan.estimated_cost ?? ""),
  marketing: plan.marketing || "",
  goal: plan.first_goal || ""
});

export const planPayload = plan => ({
  business_name: plan.name || "",
  product: plan.product || "",
  target_customers: plan.customers || "",
  startup_budget: Number(plan.startupBudget || plan.costs) || 0,
  selling_price: Number(plan.price) || 0,
  estimated_cost: Number(plan.costs) || 0,
  marketing: plan.marketing || "",
  first_goal: plan.goal || ""
});
