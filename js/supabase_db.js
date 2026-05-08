/* ================================================================
   supabase_db.js — Supabase-backed data layer
   Drop-in replacement for db.js  (same DB.* API surface)
   Requires: config.js loaded before this file
================================================================ */

const DB = (() => {

  /* ── Internal Supabase REST helper ──────────────────────────── */
  const SB = {
    url:  CONFIG.supabase.url,
    key:  CONFIG.supabase.anonKey,

    headers() {
      return {
        'Content-Type':  'application/json',
        'apikey':        this.key,
        'Authorization': 'Bearer ' + this.key,
        'Prefer':        'return=representation'
      };
    },

    async get(table, params = '') {
      const r = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
        headers: this.headers()
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },

    async post(table, body) {
      const r = await fetch(`${this.url}/rest/v1/${table}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },

    async patch(table, match, body) {
      const r = await fetch(`${this.url}/rest/v1/${table}?${match}`, {
        method: 'PATCH', headers: this.headers(), body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },

    async delete(table, match) {
      const r = await fetch(`${this.url}/rest/v1/${table}?${match}`, {
        method: 'DELETE', headers: this.headers()
      });
      if (!r.ok) throw new Error(await r.text());
    }
  };

  /* ── Active-user helpers (still uses sessionStorage for state) ── */
  function getActiveUid()    { return sessionStorage.getItem('dbs_active_uid'); }
  function setActiveUid(id)  { sessionStorage.setItem('dbs_active_uid', id); }

  /* ================================================================
     PUBLIC API
  ================================================================ */
  return {

    /* ── INIT ── */
    async init() {
      // Nothing to seed client-side; seed via supabase_setup.sql
    },

    /* ================================================================
       USERS
    ================================================================ */
    async getUsers() {
      return SB.get('users', 'order=created_at.asc');
    },

    async getUserById(id) {
      const rows = await SB.get('users', `id=eq.${encodeURIComponent(id)}&limit=1`);
      return rows[0] || null;
    },

    async getUser() {
      const uid = getActiveUid();
      if (uid) return this.getUserById(uid);
      const all = await this.getUsers();
      return all[0] || null;
    },

    setActiveUser(id) {
      setActiveUid(id);
    },

    async addUser(u) {
      try {
        const rows = await SB.post('users', u);
        return rows[0] || true;
      } catch (e) {
        console.error('addUser:', e.message);
        return false;
      }
    },

    async updateUser(id, patch) {
      try {
        const rows = await SB.patch('users', `id=eq.${encodeURIComponent(id)}`, patch);
        return rows[0] || true;
      } catch (e) {
        console.error('updateUser:', e.message);
        return false;
      }
    },

    async deleteUser(id) {
      await SB.delete('users', `id=eq.${encodeURIComponent(id)}`);
    },

    /* ── Login helper ── */
    async loginUser(id, pin) {
      const u = await this.getUserById(id);
      if (!u || u.pin !== pin) return null;
      setActiveUid(id);
      return u;
    },

    /* ================================================================
       TRANSFERS
    ================================================================ */
    async getTransfers(uid) {
      uid = uid || getActiveUid();
      return SB.get('transfers',
        `user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    },

    async addTransfer(t, uid) {
      uid = uid || getActiveUid();
      const payload = {
        ...t,
        user_id:    uid,
        status:     t.status || 'pending',
        created_at: t.created_at || new Date().toISOString()
      };
      const rows = await SB.post('transfers', payload);
      return rows[0];
    },

    async updateTransfer(id, patch, uid) {
      // uid unused — id is globally unique (bigserial)
      const rows = await SB.patch('transfers', `id=eq.${id}`, patch);
      return rows[0];
    },

    async deleteTransfer(id) {
      await SB.delete('transfers', `id=eq.${id}`);
    },

    /* ================================================================
       NOTIFICATIONS
    ================================================================ */
    async getNotifications(uid) {
      uid = uid || getActiveUid();
      return SB.get('notifications',
        `user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    },

    async addNotification(n, uid) {
      uid = uid || getActiveUid();
      const rows = await SB.post('notifications', {
        ...n, user_id: uid, read: false,
        created_at: new Date().toISOString()
      });
      return rows[0];
    },

    async markNotificationsRead(uid) {
      uid = uid || getActiveUid();
      await SB.patch('notifications',
        `user_id=eq.${encodeURIComponent(uid)}&read=eq.false`,
        { read: true });
    },

    async deleteNotification(id) {
      await SB.delete('notifications', `id=eq.${id}`);
    },

    async unreadCount(uid) {
      uid = uid || getActiveUid();
      // Use HEAD + count header for efficiency
      const r = await fetch(
        `${SB.url}/rest/v1/notifications?user_id=eq.${encodeURIComponent(uid)}&read=eq.false&select=id`,
        { headers: { ...SB.headers(), 'Prefer': 'count=exact' } }
      );
      const count = r.headers.get('Content-Range');  // e.g. "0-4/5"
      if (!count) return 0;
      return parseInt(count.split('/')[1]) || 0;
    },

    /* ================================================================
       HELPERS
    ================================================================ */
    fmt(num) {
      return Number(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    },

    fmtDate(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    }
  };

})();
