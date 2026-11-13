// テスト用：Supabase のかわりに、ページの中だけで動く小さなデータベース。
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const PNG = 'https://fake.supabase.co/storage/v1/object/sign/photos/';
const db = window.__fake = {
  offline: false,
  session: null,
  tables: JSON.parse(JSON.stringify(window.__seed)),
  listeners: [],
  emit(table) { for (const f of this.listeners) f(table); },
  partnerInsert(table, row) { this.tables[table].push(row); this.emit(table); },
};
const fail = () => { if (db.offline) throw new TypeError('Failed to fetch'); };
const visible = (table, rows) => (table === 'moods' ? rows.filter((m) => m.user_id === db.session?.user.id || m.shared) : rows);

function query(table) {
  const q = { op: 'select', filters: [], row: null, patch: null, returning: false };
  const run = async () => {
    await new Promise((r) => setTimeout(r, 5));
    try { fail(); } catch (e) { return { data: null, error: { message: e.message }, status: 0 }; }
    const rows = db.tables[table];
    const match = (r) => q.filters.every(([k, v]) => r[k] === v);
    if (q.op === 'select') return { data: visible(table, rows).filter(match).map((r) => ({ ...r })), error: null, status: 200 };
    if (q.op === 'insert') {
      if (rows.some((r) => r.id === q.row.id)) return { data: null, error: { message: 'duplicate', code: '23505' }, status: 409 };
      rows.push({ ...q.row }); return { data: null, error: null, status: 201 };
    }
    if (q.op === 'upsert') {
      const key = q.conflict || 'id';
      const hit = rows.find((r) => r[key] === q.row[key]);
      if (hit) Object.assign(hit, q.row); else rows.push({ id: crypto.randomUUID(), ...q.row });
      return { data: null, error: null, status: 200 };
    }
    const hits = rows.filter(match);
    if (q.op === 'update') hits.forEach((r) => Object.assign(r, q.patch));
    if (q.op === 'delete') db.tables[table] = rows.filter((r) => !match(r));
    return { data: hits.map((r) => ({ id: r.id })), error: null, status: 200 };
  };
  const api = {
    select() { if (q.op === 'select') return api; q.returning = true; return api; },
    order() { return api; },
    eq(k, v) { q.filters.push([k, v]); return api; },
    insert(row) { q.op = 'insert'; q.row = row; return api; },
    update(patch) { q.op = 'update'; q.patch = patch; return api; },
    delete() { q.op = 'delete'; return api; },
    upsert(row, opts) { q.op = 'upsert'; q.row = row; q.conflict = opts?.onConflict; return api; },
    then(a, b) { return run().then(a, b); },
  };
  return api;
}

export function createClient() {
  const authCbs = [];
  return {
    auth: {
      async getSession() { return { data: { session: db.session } }; },
      onAuthStateChange(cb) { authCbs.push(cb); },
      async signInWithPassword({ email, password }) {
        if (password !== 'password1') return { data: {}, error: { message: 'Invalid login credentials' } };
        db.session = { user: { id: email.startsWith('miku') ? U2 : U1, email } };
        authCbs.forEach((f) => f('SIGNED_IN', db.session));
        return { data: { session: db.session }, error: null };
      },
      async updateUser() { return { error: null }; },
      async signOut() { db.session = null; authCbs.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
    },
    from: (table) => query(table),
    storage: { from: () => ({
      async createSignedUrls(paths) { fail(); return { data: paths.map((path) => ({ path, signedUrl: `${PNG}${path}?token=t` })), error: null }; },
      async upload() { try { fail(); } catch (e) { return { error: { message: e.message } }; } return { error: null }; },
      async remove() { try { fail(); } catch (e) { return { error: { message: e.message } }; } return { error: null }; },
    }) },
    channel() {
      const ch = { on(_t, _f, cb) { db.listeners.push(cb); return ch; }, subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 10); return ch; } };
      return ch;
    },
    removeChannel() { db.listeners.length = 0; },
  };
}
