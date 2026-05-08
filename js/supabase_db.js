/* ================================================================
   supabase_db.js — Supabase-backed data layer  (v2)
   Requires: config.js loaded before this file
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
    }
  };

  /* ── Session helpers ─────────────────────────────────────────── */
  const SESSION_KEY = 'dbs_session_token';

  function getSessionToken()       { return sessionStorage.getItem(SESSION_KEY); }
  function setSessionToken(token)  { sessionStorage.setItem(SESSION_KEY, token); }
  function clearSessionToken()     { sessionStorage.removeItem(SESSION_KEY); }

  function _makeToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ================================================================
     PUBLIC API
  ================================================================ */
  return {

    /* ================================================================
       AUTH / SESSION
    ================================================================ */

    /** Login: verify ID+PIN, create server-side session, return user or null */
    async loginUser(id, pin) {
      const rows = await SB.get('users', `id=eq.${encodeURIComponent(id)}&limit=1`);
      const user = rows[0];
      if (!user || user.pin !== pin) return null;

      const token = _makeToken();
      await SB.post('sessions', {
        token,
        user_id:    user.id,
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
      });
      setSessionToken(token);
      return user;
    },

    /** Validate current session. Returns user or null. */
    async validateSession() {
      const token = getSessionToken();
      if (!token) return null;
      const rows = await SB.get('sessions',
        `token=eq.${token}&expires_at=gt.${new Date().toISOString()}&select=user_id,users(*)&limit=1`
      ).catch(() => []);
      if (!rows || !rows[0] || !rows[0].users) { clearSessionToken(); return null; }
      return rows[0].users;
    },

    /** Logout: delete session from DB and clear local token */
    async logout() {
      const token = getSessionToken();
      if (token) await SB.delete('sessions', `token=eq.${token}`).catch(() => {});
      clearSessionToken();
    },

    /** Guard: call on every protected page. Redirects to index.html if no valid session. */
    async requireAuth() {
      const user = await this.validateSession();
      if (!user) { window.location.href = 'index.html'; return null; }
      return user;
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
      return this.validateSession();
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

    /* ================================================================
       TRANSFERS
    ================================================================ */
    async getTransfers(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return [];
      return SB.get('transfers',
        `user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    },

    async addTransfer(t, uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      const payload = {
        user_id:        uid,
        account:        t.account         || t.recipient_name || '',
        recipient_name: t.recipient_name  || t.account        || '',
        iban:           t.iban            || '',
        swift:          t.swift           || '',
        country:        t.country         || '',
        currency:       t.currency        || 'EUR',
        amount:         t.amount,
        direction:      t.direction       || 'outgoing',
        status:         t.status          || 'pending',
        purpose:        t.purpose         || '',
        remarks:        t.remarks         || '',
        created_at:     t.created_at      || new Date().toISOString()
      };
      const rows = await SB.post('transfers', payload);
      return rows[0];
    },

    async updateTransfer(id, patch) {
      // Map camelCase fields that may come from old code
      if (patch.createdAt) { patch.created_at = patch.createdAt; delete patch.createdAt; }
      if (patch.recipientName) { patch.recipient_name = patch.recipientName; delete patch.recipientName; }
      const rows = await SB.patch('transfers', `id=eq.${id}`, patch);
      return rows[0];
    },

    async deleteTransfer(id) {
      await SB.delete('transfers', `id=eq.${id}`);
    },

    /**
     * Approve a transfer: set status=completed and deduct from user balance.
     * Reject: set status=failed, no balance change.
     */
    async resolveTransfer(id, status, uid) {
      const transfer = (await SB.get('transfers', `id=eq.${id}&limit=1`))[0];
      if (!transfer) return;

      await this.updateTransfer(id, { status });

      if (status === 'completed' && transfer.direction === 'outgoing') {
        const user = await this.getUserById(uid || transfer.user_id);
        if (user) {
          const newBalance = Math.max(0, parseFloat(user.balance) - parseFloat(transfer.amount));
          await this.updateUser(user.id, { balance: newBalance });
        }
      }
      if (status === 'completed' && transfer.direction === 'incoming') {
        const user = await this.getUserById(uid || transfer.user_id);
        if (user) {
          const newBalance = parseFloat(user.balance) + parseFloat(transfer.amount);
          await this.updateUser(user.id, { balance: newBalance });
        }
      }
    },

    /* ================================================================
       NOTIFICATIONS
    ================================================================ */
    async getNotifications(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return [];
      return SB.get('notifications',
        `user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc`);
    },

    async addNotification(n, uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      const rows = await SB.post('notifications', {
        user_id:    uid,
        message:    n.message,
        read:       false,
        created_at: new Date().toISOString()
      });
      return rows[0];
    },

    async markNotificationsRead(uid) {
      if (!uid) { const u = await this.getUser(); uid = u && u.id; }
      if (!uid) return;
      await SB.patch('notifications',
        `user_id=eq.${encodeURIComponent(uid)}&read=eq.false`,
        { read: true });
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
      if (!count) return 0;
      return parseInt(count.split('/')[1]) || 0;
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
