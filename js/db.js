/* ================================================================
   db.js — Shared localStorage data layer (multi-user)
   Supabase-ready: replace each function body to call your API.
================================================================ */

const DB = {

  /* ---- DEFAULTS: seed user ---- */
  _seedUser: {
    id: "655016554",
    pin: "11559900",
    name: "Hironori Sugiyama",
    account: "Galidix Limited",
    currency: "EUR",
    balance: 180357.86
  },

  /* ---- INIT ---- */
  init() {
    // Users list
    if (!localStorage.getItem('dbs_users')) {
      const seed = { ...this._seedUser };
      localStorage.setItem('dbs_users', JSON.stringify([seed]));
    }
    // Active user ID (the one currently logged in on the client side)
    if (!localStorage.getItem('dbs_active_uid')) {
      const users = this.getUsers();
      if (users.length > 0) localStorage.setItem('dbs_active_uid', users[0].id);
    }
  },

  /* ================================================================
     USERS
  ================================================================ */
  getUsers() {
    return JSON.parse(localStorage.getItem('dbs_users') || '[]');
  },
  _saveUsers(list) {
    localStorage.setItem('dbs_users', JSON.stringify(list));
  },
  getUserById(id) {
    return this.getUsers().find(u => u.id === id) || null;
  },
  // The user currently logged in on the banking side
  getUser() {
    const uid = localStorage.getItem('dbs_active_uid');
    return this.getUserById(uid) || this.getUsers()[0];
  },
  setActiveUser(id) {
    localStorage.setItem('dbs_active_uid', id);
  },
  addUser(u) {
    const list = this.getUsers();
    if (list.find(x => x.id === u.id)) return false; // duplicate ID
    list.push(u);
    this._saveUsers(list);
    return true;
  },
  updateUser(id, patch) {
    const list = this.getUsers();
    const idx = list.findIndex(u => u.id === id);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], ...patch };
    this._saveUsers(list);
    // If active user was updated, keep active uid in sync (id may have changed)
    if (patch.id && patch.id !== id) {
      if (localStorage.getItem('dbs_active_uid') === id) {
        localStorage.setItem('dbs_active_uid', patch.id);
      }
    }
    return list[idx];
  },
  deleteUser(id) {
    const list = this.getUsers().filter(u => u.id !== id);
    this._saveUsers(list);
    // Also remove that user's transfers + notifications
    localStorage.removeItem('dbs_transfers_' + id);
    localStorage.removeItem('dbs_notifs_' + id);
    // Reset active if deleted
    if (localStorage.getItem('dbs_active_uid') === id) {
      const remaining = list[0];
      if (remaining) localStorage.setItem('dbs_active_uid', remaining.id);
      else localStorage.removeItem('dbs_active_uid');
    }
  },

  /* ================================================================
     TRANSFERS (per user)
  ================================================================ */
  getTransfers(uid) {
    uid = uid || (this.getUser() || {}).id;
    return JSON.parse(localStorage.getItem('dbs_transfers_' + uid) || '[]');
  },
  _saveTransfers(uid, list) {
    localStorage.setItem('dbs_transfers_' + uid, JSON.stringify(list));
  },
  addTransfer(t, uid) {
    uid = uid || (this.getUser() || {}).id;
    const list = this.getTransfers(uid);
    t.id        = Date.now();
    t.status    = t.status || 'pending';
    t.createdAt = t.createdAt || new Date().toISOString();
    list.unshift(t);
    this._saveTransfers(uid, list);
    return t;
  },
  updateTransfer(id, patch, uid) {
    uid = uid || (this.getUser() || {}).id;
    const list = this.getTransfers(uid);
    const idx  = list.findIndex(t => t.id == id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    this._saveTransfers(uid, list);
    return list[idx];
  },
  deleteTransfer(id, uid) {
    uid = uid || (this.getUser() || {}).id;
    const list = this.getTransfers(uid).filter(t => t.id != id);
    this._saveTransfers(uid, list);
  },

  /* ================================================================
     NOTIFICATIONS (per user)
  ================================================================ */
  getNotifications(uid) {
    uid = uid || (this.getUser() || {}).id;
    return JSON.parse(localStorage.getItem('dbs_notifs_' + uid) || '[]');
  },
  _saveNotifications(uid, list) {
    localStorage.setItem('dbs_notifs_' + uid, JSON.stringify(list));
  },
  addNotification(n, uid) {
    uid = uid || (this.getUser() || {}).id;
    const list = this.getNotifications(uid);
    n.id        = Date.now();
    n.createdAt = new Date().toISOString();
    n.read      = false;
    list.unshift(n);
    this._saveNotifications(uid, list);
    return n;
  },
  markNotificationsRead(uid) {
    uid = uid || (this.getUser() || {}).id;
    const list = this.getNotifications(uid).map(n => ({ ...n, read: true }));
    this._saveNotifications(uid, list);
  },
  deleteNotification(id, uid) {
    uid = uid || (this.getUser() || {}).id;
    const list = this.getNotifications(uid).filter(n => n.id != id);
    this._saveNotifications(uid, list);
  },
  unreadCount(uid) {
    uid = uid || (this.getUser() || {}).id;
    return this.getNotifications(uid).filter(n => !n.read).length;
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

DB.init();
