import { test as base, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const password = 'E2e!' + randomUUID();
const required = (key: string) => { if (!process.env[key]) throw new Error(`Configuração obrigatória ausente: ${key}. Veja docs/PLAYWRIGHT.md`); return process.env[key]!; };
const test = base.extend<{ scenario: any }>({
  scenario: async ({ request }, use) => {
    expect(required('E2E_ALLOW_TEST_DATA')).toBe('1');
    const auth = createClient(required('E2E_SUPABASE_URL'), required('E2E_SUPABASE_SECRET_KEY'), { auth: { persistSession: false } });
    const db = new pg.Client({ connectionString: required('E2E_DATABASE_URL') });
    await db.connect();
    const users: string[] = []; let tenant: string | undefined;
    const login = async (email: string) => {
      const client = createClient(required('E2E_SUPABASE_URL'), required('E2E_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Falha ao autenticar conta de teste: ${error.message}`);
      const token = data.session!.access_token;
      // Decode only to schedule the request; the API still verifies the signature.
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const validAfter = Math.max(claims.iat ?? 0, claims.nbf ?? 0) * 1000;
      const delay = validAfter - Date.now() + 1000;
      if (delay > 30000) throw new Error('Relógio do Windows está mais de 30 segundos atrasado em relação ao Supabase. Sincronize em Configurações > Data e hora > Sincronizar agora.');
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      return token;
    };
    const call = async (token: string, method: string, path: string, data?: unknown, status = 200) => {
      const response = await request.fetch(path, { method, data, headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
      expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
      return response.json();
    };
    try {
      const email = `e2e-${randomUUID()}@example.invalid`;
      const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      users.push(created.data.user.id);
      await db.query('insert into app.restaurant_administrators(user_id) values($1)', [users[0]]);
      const admin = await login(email);
      const restaurant = await call(admin, 'POST', '/v1/restaurants', { name: `E2E ${randomUUID()}`, address: 'Rua Teste, 10', opens_at: '18:00', closes_at: '23:00', service_type: 'alacarte', cnpj: cnpj() }, 201);
      tenant = restaurant.id;
      const path = `/v1/tenants/${tenant}/`;
      const api = (role: string, method: string, resource: string, body?: unknown, status = 200) => call(role, method, path + resource, body, status);
      const roles: Record<string, string> = {};
      for (const role of ['waiter', 'cashier']) {
        const username = `e2e.${randomUUID().replaceAll('-', '').slice(0, 20)}`;
        const member = await api(admin, 'POST', 'employee-logins', { display_name: `E2E ${role}`, username, password, role }, 201);
        users.push(member.user_id);
        roles[role] = await login(`${username}@staff.comandei.internal`);
      }
      const category = await api(admin, 'POST', 'categories', { name: 'E2E' }, 201);
      const products = [];
      for (let i = 1; i <= 4; i++) products.push(await api(admin, 'POST', 'products', { category_id: category.id, name: `Produto ${i}`, price_cents: 1000 * i }, 201));
      const tables = [];
      for (let i = 1; i <= 5; i++) tables.push(await api(admin, 'POST', 'tables', { code: String(i), name: `Mesa ${i}`, capacity: 4 }, 201));
      await use({ api, admin, ...roles, products, tables });
    } finally {
      // Limpeza restrita aos IDs criados por esta execução.
      try {
      await db.query('BEGIN');
      if (tenant) {
        await db.query('delete from realtime.messages where topic=$1', [`tenant:${tenant}:operations`]);
        for (const table of ['background_jobs', 'idempotency_records', 'outbox_events', 'audit_events', 'cash_movements', 'payment_entries', 'tab_settlements', 'cash_sessions', 'cash_registers', 'approval_requests', 'adjustments', 'order_item_modifiers', 'order_items', 'orders', 'tabs', 'product_modifier_groups', 'modifier_options', 'modifier_groups', 'products', 'categories', 'dining_tables', 'invitations', 'tenant_entitlements', 'memberships']) {
          await db.query(`delete from app.${table} where tenant_id=$1`, [tenant]);
        }
        await db.query('delete from app.tenants where id=$1', [tenant]);
      }
      for (const id of users.reverse()) {
        await db.query('delete from app.restaurant_administrators where user_id=$1', [id]);
        await db.query('delete from app.profiles where user_id=$1', [id]);
        await db.query('delete from app.request_buckets where key like $1', [`${id}:%`]);
      }
      await db.query('COMMIT');
      for (const id of users) {
        const result = await auth.auth.admin.deleteUser(id); if (result.error) throw result.error;
      }
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
      await db.end();
      }
    }
  }
});
function cnpj() {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  for (const weights of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const remainder = digits.reduce((sum, digit, i) => sum + digit * weights[i], 0) % 11;
    digits.push(remainder < 2 ? 0 : 11 - remainder);
  }
  return digits.join('');
}
test('Admin cria restaurante, dois funcionários, quatro produtos e cinco mesas', async ({ scenario: s }) => {
  for (const [resource, count] of [['products', 4], ['tables', 5]] as const) {
    await test.step(`Confirmar ${count} registros de ${resource}`, async () => expect((await s.api(s.admin, 'GET', resource)).items).toHaveLength(count));
  }
  await test.step('Confirmar garçom e caixa vinculados', async () => {
    const members = (await s.api(s.admin, 'GET', 'members')).items;
    expect(members.filter((m: any) => ['waiter', 'cashier'].includes(m.role))).toHaveLength(2);
  });
});
test('Garçom atende quatro pessoas; caixa aplica 10%, recebe PIX e libera mesa', async ({ scenario: s }) => {
  let tab: any;
  let tabId: string;
  const resource = () => `tabs/${tabId}`;
  await test.step('Garçom abre comanda com quatro pessoas e envia dois produtos', async () => {
    tab = await s.api(s.waiter, 'POST', 'tabs', { table_id: s.tables[0].id, guests: [{ label: 'Quatro pessoas', quantity: 4, complimentary: true }] }, 201);
    tabId = tab.id;
    const products = await Promise.all(s.products.slice(0, 2).map((p: any) => s.api(s.waiter, 'GET', `products/${p.id}`)));
    tab = await s.api(s.waiter, 'POST', `${resource()}/orders`, { expected_version: tab.version, items: products.map((p: any) => ({ product_id: p.id, catalog_version: p.version, quantity: '1' })) }, 201);
    tab = (await s.api(s.waiter, 'POST', `${resource()}/start-closing`, { expected_version: tab.version, service_accepted: false })).tab;
    expect(tab.status).toBe('closing');
  });
  await test.step('Caixa desconta R$ 3,00 (10% de R$ 30,00)', async () => {
    const settings = await s.api(s.admin, 'GET', 'settings');
    await s.api(s.admin, 'PATCH', 'settings', { expected_version: settings.version, cashier_discount_limit_bps: 1000 });
    tab = await s.api(s.cashier, 'POST', `${resource()}/adjustments`, { expected_version: tab.version, type: 'discount', amount_cents: 300, reason: 'Desconto de 10%' });
    expect(tab.amounts.discount_cents).toBe(300);
    expect(tab.amounts.total_cents).toBe(2700);
  });
  await test.step('Caixa recebe PIX e encerra a comanda', async () => {
    const register = await s.api(s.admin, 'POST', 'cash-registers', { code: '1', name: 'E2E' }, 201);
    const session = await s.api(s.cashier, 'POST', 'cash-sessions', { register_id: register.id }, 201);
    const paid = await s.api(s.cashier, 'POST', `${resource()}/payments`, { expected_version: tab.version, cash_session_id: session.id, method: 'pix', amount_cents: 2700, confirmed: true, operation_key: randomUUID() }, 201);
    await s.api(s.cashier, 'POST', `${resource()}/close`, { expected_version: paid.version });
    const receipt = await s.api(s.cashier, 'GET', `${resource()}/receipt`);
    expect(receipt.amounts.balance_cents).toBe(0);
    expect(receipt.payments[0].method).toBe('pix');
    expect((await s.api(s.cashier, 'GET', resource())).status).toBe('closed');
  });
  await test.step('Mesa fica livre e aceita uma nova comanda', async () => {
    const table = (await s.api(s.waiter, 'GET', 'tables')).items.find((t: any) => t.id === s.tables[0].id);
    expect(table.active_tab).toBeNull();
    const reopened = await s.api(s.waiter, 'POST', 'tabs', { table_id: table.id, guests: [{ label: 'Novo atendimento', quantity: 1, complimentary: true }] }, 201);
    expect(reopened.id).not.toBe(tabId);
    expect(reopened.status).toBe('open');
  });
});



