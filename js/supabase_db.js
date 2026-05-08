/* ================================================================
   supabase_db.js — v4 (RPC-based auth, direct REST for data)
   Login verified server-side via Postgres RPC — PIN never sent
   to browser. All other calls use direct REST with open RLS.
   Requires: config.js loaded before this file.
================================================================ */

const DB = (() => {

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

    // Postgres RPC call
    async rpc(fn, params = {}) {
      const r = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify(params)
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    }
  };

  /* ── Session helpers ─────────────────────────────────────────── */
  const SESSION_KEY = 'dbs_session_token';
  function getSessionToken()      { return sessionStorage.getItem(SESSION_KEY); }
  function setSessionToken(token) { sessionStorage.setItem(SESSION_KEY, token); }
  function clearSessionToken()    { sessionStorage.removeItem(SESSION_KEY); }

  let _cachedUser = null;

  /* ================================================================
     PUBLIC API
  ================================================================ */
  return {

    /* ================================================================
       AUTH — RPC-based (PIN never leaves the database)
    ================================================================ */

    /** Login: PIN verified inside Postgres via RPC. Returns user or null. */
    async loginUser(id, pin) {
      const result = await SB.rpc('login_user', { p_id: id, p_pin: pin }).catch(() => null);
      if (!result || !result.token) return null;
      setSessionToken(result.token);
      _cachedUser = result.user; // safe object — no PIN
      return result.user;
    },

    /** Validate session token via RPC */
    async validateSession() {
      if (_cachedUser) return _cachedUser;
      const token = getSessionToken();
      if (!token) return null;
      const result = await SB.rpc('validate_session', { p_token: token }).catch(() => null);
      if (!result || !result.user) { clearSessionToken(); return null; }
      _cachedUser = result.user;
      return result.user;
    },

    /** Logout: delete session row */
    async logout() {
      const token = getSessionToken();
      if (token) await SB.delete('sessions', `token=eq.${token}`).catch(() => {});
      clearSessionToken();
      _cachedUser = null;
    },

    /** Guard: redirect to index.html if no valid session */
    async requireAuth() {
      const user = await this.validateSession();
      if (!user) { window.location.href = 'index.html'; return null; }
      return user;
    },

    /** Admin login: verified via RPC */
    async adminLogin(email, password) {
      const result = await SB.rpc('login_admin', { p_email: email, p_password: password }).catch(() => null);
      if (!result || !result.token) return false;
      sessionStorage.setItem('dbs_admin_token', result.token);
      return true;
    },

    /** Validate admin session */
    async validateAdminSession() {
      const token = sessionStorage.getItem('dbs_admin_token');
      if (!token) return false;
      const result = await SB.rpc('validate_session', { p_token: token }).catch(() => null);
      return !!(result && result.admin === true);
    },

    async getUser() {
      return this.validateSession();
    },

    /* ================================================================
       USERS
    ================================================================ */
    async getUsers() {
      return SB.get('users', 'select=id,name,account,currency,balance,created_at&order=created_at.asc');
    },
    async getUserById(id) {
      const rows = await SB.get('users', `select=id,name,account,currency,balance,created_at&id=eq.${encodeURIComponent(id)}&limit=1`);
      return rows[0] || null;
    },
    async addUser(u) {
      try {
        const rows = await SB.post('users', u);
        return rows[0] || true;
      } catch(e) { return false; }
    },
    async updateUser(id, patch) {
      const rows = await SB.patch('users', `id=eq.${encodeURIComponent(id)}`, patch);
      return rows[0] || true;
    },
    async deleteUser(id) {
      await SB.delete('users', `id=eq.${encodeURIComponent(id)}`);
    },

    /* ================================================================
       TRANSFERS
    ================================================================ */
    async getTransfers(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return [];
      return SB.get('transfers', `user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    },
    async addTransfer(t, uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      const rows = await SB.post('transfers', {
        user_id:        uid,
        account:        t.account        || t.recipient_name || '',
        recipient_name: t.recipient_name || t.account        || '',
        iban:           t.iban           || '',
        swift:          t.swift          || '',
        country:        t.country        || '',
        currency:       t.currency       || 'EUR',
        amount:         t.amount,
        direction:      t.direction      || 'outgoing',
        status:         t.status         || 'pending',
        purpose:        t.purpose        || '',
        remarks:        t.remarks        || '',
        created_at:     t.created_at     || new Date().toISOString()
      });
      return rows[0];
    },
    async updateTransfer(id, patch) {
      if (patch.createdAt) { patch.created_at = patch.createdAt; delete patch.createdAt; }
      const rows = await SB.patch('transfers', `id=eq.${id}`, patch);
      return rows[0];
    },
    async deleteTransfer(id) {
      await SB.delete('transfers', `id=eq.${id}`);
    },
    async resolveTransfer(id, status, uid) {
      const transfers = await SB.get('transfers', `id=eq.${id}&limit=1`);
      const transfer = transfers[0];
      if (!transfer) return;
      await this.updateTransfer(id, { status });
      if (status === 'completed') {
        const userId = uid || transfer.user_id;
        const user = await this.getUserById(userId);
        if (user) {
          let newBalance = parseFloat(user.balance);
          if (transfer.direction === 'outgoing') newBalance -= parseFloat(transfer.amount);
          if (transfer.direction === 'incoming') newBalance += parseFloat(transfer.amount);
          await this.updateUser(userId, { balance: Math.max(0, newBalance) });
        }
      }
    },

    /* ================================================================
       NOTIFICATIONS
    ================================================================ */
    async getNotifications(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return [];
      return SB.get('notifications', `user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    },
    async addNotification(n, uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      const rows = await SB.post('notifications', {
        user_id: uid, message: n.message, read: false,
        created_at: new Date().toISOString()
      });
      return rows[0];
    },
    async markNotificationsRead(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return;
      await SB.patch('notifications', `user_id=eq.${encodeURIComponent(uid)}&read=eq.false`, { read: true });
    },
    async deleteNotification(id) {
      await SB.delete('notifications', `id=eq.${id}`);
    },
    async unreadCount(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return 0;
      const r = await fetch(
        `${SB.url}/rest/v1/notifications?user_id=eq.${encodeURIComponent(uid)}&read=eq.false&select=id`,
        { headers: { ...SB.headers(), 'Prefer': 'count=exact' } }
      );
      const count = r.headers.get('Content-Range');
      return parseInt((count || '0/0').split('/')[1]) || 0;
    },

    /* ================================================================
       HELPERS
    ================================================================ */
    fmt(num) {
      return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    fmtDate(iso) {
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  };

})();
