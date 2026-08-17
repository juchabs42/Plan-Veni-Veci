/* Client Supabase minimal, local au dépôt GitHub.
   Il évite une dépendance CDN susceptible de bloquer tout le démarrage de la PWA. */
(function () {
  'use strict';

  const now = () => Math.floor(Date.now() / 1000);
  const trimUrl = url => String(url || '').replace(/\/+$/, '');

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function makeError(payload, status, fallback) {
    return {
      message: String(payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback || `HTTP ${status}`),
      status,
      details: payload
    };
  }

  class AuthClient {
    constructor(client) {
      this.client = client;
      this.listeners = new Set();
      let project = 'veni-vici';
      try { project = new URL(client.url).hostname.split('.')[0] || project; } catch {}
      this.storageKey = `veni-vici-auth-${project}`;
    }

    load() {
      try { return JSON.parse(localStorage.getItem(this.storageKey) || 'null'); }
      catch { return null; }
    }

    save(session) {
      if (session) localStorage.setItem(this.storageKey, JSON.stringify(session));
      else localStorage.removeItem(this.storageKey);
    }

    emit(event, session) {
      this.listeners.forEach(callback => {
        try { callback(event, session); } catch (error) { console.error(error); }
      });
    }

    async refresh(session) {
      if (!session?.refresh_token) return null;
      try {
        const response = await fetch(`${this.client.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: this.client.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        const payload = await parseResponse(response);
        if (!response.ok) {
          this.save(null);
          return null;
        }
        const refreshed = { ...payload, expires_at: now() + Number(payload.expires_in || 3600) };
        this.save(refreshed);
        this.emit('TOKEN_REFRESHED', refreshed);
        return refreshed;
      } catch {
        return session;
      }
    }

    async validSession() {
      let session = this.load();
      if (!session) return null;
      if (!session.expires_at || session.expires_at - now() < 90) session = await this.refresh(session);
      return session;
    }

    async getSession() {
      return { data: { session: await this.validSession() }, error: null };
    }

    async signInWithPassword({ email, password }) {
      try {
        const response = await fetch(`${this.client.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: this.client.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const payload = await parseResponse(response);
        if (!response.ok) return { data: null, error: makeError(payload, response.status, 'Connexion impossible') };
        const session = { ...payload, expires_at: now() + Number(payload.expires_in || 3600) };
        this.save(session);
        this.emit('SIGNED_IN', session);
        return { data: { session, user: session.user }, error: null };
      } catch (error) {
        return { data: null, error: { message: error?.message || 'Connexion Supabase impossible' } };
      }
    }

    async signOut() {
      const session = this.load();
      if (session?.access_token) {
        try {
          await fetch(`${this.client.url}/auth/v1/logout`, {
            method: 'POST',
            headers: { apikey: this.client.key, Authorization: `Bearer ${session.access_token}` }
          });
        } catch {}
      }
      this.save(null);
      this.emit('SIGNED_OUT', null);
      return { error: null };
    }

    onAuthStateChange(callback) {
      this.listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => this.listeners.delete(callback) } } };
    }
  }

  class QueryBuilder {
    constructor(client, table, method = 'GET', body = null) {
      this.client = client;
      this.table = table;
      this.method = method;
      this.body = body;
      this.params = new URLSearchParams();
      this.orders = [];
      this.wantRepresentation = false;
      this.wantSingle = false;
    }

    select(columns = '*') {
      this.params.set('select', columns);
      if (this.method !== 'GET') this.wantRepresentation = true;
      return this;
    }

    order(column, options = {}) {
      this.orders.push(`${column}.${options.ascending === false ? 'desc' : 'asc'}`);
      return this;
    }

    eq(column, value) {
      this.params.set(column, `eq.${value}`);
      return this;
    }

    single() {
      this.wantSingle = true;
      this.wantRepresentation = true;
      return this;
    }

    async execute() {
      if (this.orders.length) this.params.set('order', this.orders.join(','));
      const query = this.params.toString();
      const session = await this.client.auth.validSession();
      if (!session) return { data: null, error: { message: 'Session Supabase expirée. Reconnecte-toi.' } };

      const headers = {
        apikey: this.client.key,
        Authorization: `Bearer ${session.access_token}`,
        Accept: 'application/json'
      };
      if (this.method !== 'GET' && this.method !== 'DELETE') headers['Content-Type'] = 'application/json';
      if (this.wantRepresentation) headers.Prefer = 'return=representation';

      try {
        const response = await fetch(`${this.client.url}/rest/v1/${encodeURIComponent(this.table)}${query ? `?${query}` : ''}`, {
          method: this.method,
          headers,
          body: this.body == null ? undefined : JSON.stringify(this.body)
        });
        const payload = await parseResponse(response);
        if (!response.ok) return { data: null, error: makeError(payload, response.status, 'Erreur Supabase') };
        const data = this.wantSingle && Array.isArray(payload) ? (payload[0] ?? null) : payload;
        return { data, error: null };
      } catch (error) {
        return { data: null, error: { message: error?.message || 'Connexion Supabase impossible' } };
      }
    }

    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }

  class TableClient {
    constructor(client, table) { this.client = client; this.table = table; }
    select(columns = '*') { return new QueryBuilder(this.client, this.table).select(columns); }
    update(values) { return new QueryBuilder(this.client, this.table, 'PATCH', values); }
    delete() { return new QueryBuilder(this.client, this.table, 'DELETE'); }

    async upsert(rows, options = {}) {
      const session = await this.client.auth.validSession();
      if (!session) return { data: null, error: { message: 'Session Supabase expirée. Reconnecte-toi.' } };
      const params = new URLSearchParams();
      if (options.onConflict) params.set('on_conflict', options.onConflict);
      try {
        const response = await fetch(`${this.client.url}/rest/v1/${encodeURIComponent(this.table)}?${params}`, {
          method: 'POST',
          headers: {
            apikey: this.client.key,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Prefer: `resolution=${options.ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'},return=representation`
          },
          body: JSON.stringify(rows)
        });
        const payload = await parseResponse(response);
        if (!response.ok) return { data: null, error: makeError(payload, response.status, 'Import Supabase impossible') };
        return { data: payload, error: null };
      } catch (error) {
        return { data: null, error: { message: error?.message || 'Connexion Supabase impossible' } };
      }
    }
  }

  class Client {
    constructor(url, key) {
      this.url = trimUrl(url);
      this.key = key;
      this.auth = new AuthClient(this);
    }
    from(table) { return new TableClient(this, table); }
  }

  window.SupabaseLite = {
    createClient(url, key) {
      if (!String(url || '').startsWith('https://')) throw new Error('URL Supabase invalide');
      if (!key) throw new Error('Clé Supabase manquante');
      return new Client(url, key);
    }
  };
})();
