/* ================================================================
   supabase_db.js — v3 (Edge Function secured)
   All auth goes through Edge Functions using service role key.
   The anon key is only used for non-sensitive data calls.
   Requires: config.js loaded before this file.
================================================================ */

const DB = (() => {

  const SB = {
    url:  CONFIG.supabase.url,
    key:  CONFIG.supabase.anonKey,

    headers(extra = {}) {
      return {
        'Content-Type':  'application/json',
        'apikey':        this.key,
        'Authorization': 'Bearer ' + this.key,
        'Prefer':        'return=representation',
        ...extra
      };
    },

    // Direct REST — only used after RLS allows it (admin via service role edge fn)
    async get(table, params = '') {
      const r = await fetch(`${this.url}/rest/v1/${table}?${params}`, { headers: this.headers() });
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
    },

    // Edge Function call
    async fn(name, body = {}) {
      const r = await fetch(`${this.url}/functions/v1/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': this.key },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Edge function error');
      return data;
    }
  };

  /* ── Session helpers ─────────────────────────────────────────── */
  const SESSION_KEY = 'dbs_session_token';
  function getSessionToken()      { return sessionStorage.getItem(SESSION_KEY); }
  function setSessionToken(token) { sessionStorage.setItem(SESSION_KEY, token); }
  function clearSessionToken()    { sessionStorage.removeItem(SESSION_KEY); }

  // Cache validated user for the page lifetime
  let _cachedUser = null;

  /* ================================================================
     PUBLIC API
  ================================================================ */
  return {

    /* ================================================================
       AUTH / SESSION
    ================================================================ */

    /** Login: ID+PIN verified server-side. PIN never compared in browser. */
    async loginUser(id, pin) {
      const data = await SB.fn('login', { id, pin }).catch(() => null);
      if (!data || !data.token) return null;
      setSessionToken(data.token);
      _cachedUser = data.user; // safe object — no PIN
      return data.user;
    },

    /** Validate session via Edge Function — returns safe user or null */
    async validateSession() {
      if (_cachedUser) return _cachedUser;
      const token = getSessionToken();
      if (!token) return null;
      const data = await SB.fn('validate-session', { token }).catch(() => null);
      if (!data || !data.user) { clearSessionToken(); return null; }
      _cachedUser = data.user;
      return data.user;
    },

    /** Logout: delete session server-side */
    async logout() {
      const token = getSessionToken();
      if (token) await SB.fn('logout', { token }).catch(() => {});
      clearSessionToken();
      _cachedUser = null;
    },

    /** Guard: redirects to index.html if no valid session */
    async requireAuth() {
      const user = await this.validateSession();
      if (!user) { window.location.href = 'index.html'; return null; }
      return user;
    },

    /** Admin login: verified server-side, returns token or null */
    async adminLogin(email, password) {
      const data = await SB.fn('admin-login', { email, password }).catch(() => null);
      if (!data || !data.token) return false;
      sessionStorage.setItem('dbs_admin_token', data.token);
      return true;
    },

    /** Admin session check */
    async validateAdminSession() {
      const token = sessionStorage.getItem('dbs_admin_token');
      if (!token) return false;
      // Admin tokens are prefixed "adm_" — validate via same endpoint
      const data = await SB.fn('validate-session', { token }).catch(() => null);
      // admin sessions have no user — just check the token was valid (no error thrown)
      return !!data;
    },

    async getUser() {
      return this.validateSession();
    },

    /* ================================================================
       USERS  (admin only — all go through Edge Function proxy)
    ================================================================ */
    async getUsers() {
      return SB.fn('admin-query', { action: 'getUsers' });
    },
    async getUserById(id) {
      const data = await SB.fn('admin-query', { action: 'getUserById', id });
      return data.user || null;
    },
    async addUser(u) {
      const data = await SB.fn('admin-query', { action: 'addUser', user: u }).catch(() => null);
      return data ? (data.user || true) : false;
    },
    async updateUser(id, patch) {
      const data = await SB.fn('admin-query', { action: 'updateUser', id, patch });
      return data.user || true;
    },
    async deleteUser(id) {
      await SB.fn('admin-query', { action: 'deleteUser', id });
    },

    /* ================================================================
       TRANSFERS
    ================================================================ */
    async getTransfers(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return [];
      return SB.fn('admin-query', { action: 'getTransfers', uid });
    },
    async addTransfer(t, uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      const data = await SB.fn('admin-query', { action: 'addTransfer', uid, transfer: t });
      return data.transfer || data;
    },
    async updateTransfer(id, patch) {
      if (patch.createdAt) { patch.created_at = patch.createdAt; delete patch.createdAt; }
      const data = await SB.fn('admin-query', { action: 'updateTransfer', id, patch });
      return data.transfer || data;
    },
    async deleteTransfer(id) {
      await SB.fn('admin-query', { action: 'deleteTransfer', id });
    },
    async resolveTransfer(id, status, uid) {
      await SB.fn('admin-query', { action: 'resolveTransfer', id, status, uid });
    },

    /* ================================================================
       NOTIFICATIONS
    ================================================================ */
    async getNotifications(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return [];
      return SB.fn('admin-query', { action: 'getNotifications', uid });
    },
    async addNotification(n, uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      const data = await SB.fn('admin-query', { action: 'addNotification', uid, notification: n });
      return data.notification || data;
    },
    async markNotificationsRead(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return;
      await SB.fn('admin-query', { action: 'markNotificationsRead', uid });
    },
    async deleteNotification(id) {
      await SB.fn('admin-query', { action: 'deleteNotification', id });
    },
    async unreadCount(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return 0;
      const data = await SB.fn('admin-query', { action: 'unreadCount', uid }).catch(() => ({ count: 0 }));
      return data.count || 0;
    },

    /* ================================================================
       HELPERS
    ================================================================ */
    fmt(num) {
      return Number(num).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
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
