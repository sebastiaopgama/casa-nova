/* =========================================================
   Casa Nova — dados
   Com config.js preenchido, guarda tudo no Supabase (lista
   partilhada); senão, guarda só neste navegador.
   O resto da app fala apenas com o objeto Store.
   ========================================================= */
"use strict";

const DEFAULT_ROOMS = ["Entrada", "Sala de Estar", "Sala de Jantar", "Cozinha", "Quarto Principal", "Quarto 2", "Casa de Banho", "Geral"];
const ITEM_FIELDS = ["nome", "divisao", "categoria", "preco", "qtd", "preco_pago", "estado", "prio", "links", "notas", "sugerido"];

/* Nome de divisão com cada palavra em maiúscula, exceto as de ligação: "casa de banho" → "Casa de Banho". */
const ROOM_SMALL_WORDS = new Set(["a", "à", "ao", "aos", "as", "às", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela", "pelo", "por", "sem"]);

function roomTitle(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      const lower = word.toLocaleLowerCase("pt-PT");
      if (i > 0 && ROOM_SMALL_WORDS.has(lower)) return lower;
      if (word.length <= 3 && /\p{Lu}/u.test(word) && word === word.toLocaleUpperCase("pt-PT")) return word; // siglas como WC ou TV
      return lower.replace(/(^|-)(\p{L})/gu, (_, sep, letter) => sep + letter.toLocaleUpperCase("pt-PT"));
    })
    .join(" ");
}

/* localStorage que não rebenta em modo privado ou sem espaço */
const saved = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sem armazenamento disponível: continua só em memória */
    }
  },
};

function normalizeItem(raw) {
  const pago = raw.preco_pago;
  return {
    ...raw,
    nome: String(raw.nome ?? "").trim(),
    divisao: String(raw.divisao ?? "").trim() || "Geral",
    categoria: String(raw.categoria ?? "").trim(),
    preco: Math.max(0, Number(raw.preco) || 0),
    qtd: Math.max(1, parseInt(raw.qtd, 10) || 1),
    preco_pago: pago === null || pago === undefined || pago === "" || Number.isNaN(Number(pago)) ? null : Math.max(0, Number(pago)),
    estado: [0, 1, 2].includes(Number(raw.estado)) ? Number(raw.estado) : 0,
    prio: ["E", "I", "D"].includes(raw.prio) ? raw.prio : "I",
    links: Array.isArray(raw.links) ? raw.links.filter(Boolean) : [],
    notas: String(raw.notas ?? "").trim(),
    sugerido: raw.sugerido === true, // veio das sugestões e ainda ninguém lhe mexeu
  };
}

const toRow = item => Object.fromEntries(ITEM_FIELDS.map(key => [key, item[key]]));
const localId = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowISO = () => new Date().toISOString();

const Store = {
  sb: null, // cliente Supabase; null = modo local
  items: [],
  cfg: { divisoes: DEFAULT_ROOMS.slice(), orcamento: null },
  listeners: [],

  get shared() {
    return this.sb !== null;
  },

  onChange(fn) {
    this.listeners.push(fn);
  },

  emit() {
    if (!this.sb) {
      saved.set("casa.itens", this.items);
      saved.set("casa.cfg", this.cfg);
    }
    this.listeners.forEach(fn => fn());
  },

  find(id) {
    return this.items.find(it => it.id === id);
  },

  put(raw) {
    const item = normalizeItem(raw);
    const index = this.items.findIndex(it => it.id === item.id);
    if (index >= 0) this.items[index] = item;
    else this.items.push(item);
    return item;
  },

  drop(id) {
    this.items = this.items.filter(it => it.id !== id);
  },

  applyConfig(cfg) {
    if (!cfg) return;
    if (Array.isArray(cfg.divisoes)) this.cfg.divisoes = cfg.divisoes.slice();
    if ("orcamento" in cfg) this.cfg.orcamento = cfg.orcamento == null ? null : Number(cfg.orcamento);
  },

  /* ---------- arranque ---------- */

  loadLocal() {
    this.items = saved.get("casa.itens", []).map(raw => normalizeItem({ ...raw, id: raw.id || localId() }));
    this.applyConfig(saved.get("casa.cfg", null));
    this.emit();
  },

  async loadRemote() {
    const [items, cfg] = await Promise.all([
      this.sb.from("itens").select("*").order("criado_em"),
      this.sb.from("config").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (items.error) throw items.error;
    if (cfg.error) throw cfg.error;
    this.items = items.data.map(normalizeItem);
    this.applyConfig(cfg.data);
    this.emit();
  },

  subscribe(onStatus) {
    this.sb
      .channel("casa")
      .on("postgres_changes", { event: "*", schema: "public", table: "itens" }, change => {
        if (change.eventType === "DELETE") this.drop(change.old.id);
        else this.put(change.new);
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, change => {
        this.applyConfig(change.new);
        this.emit();
      })
      .subscribe(onStatus);
  },

  /* ---------- itens ---------- */

  async saveItem(item) {
    if (!this.sb) {
      const result = this.put({ ...item, id: item.id || localId(), criado_em: item.criado_em || nowISO(), atualizado_em: nowISO() });
      this.emit();
      return result;
    }

    if (!item.id) {
      const { data, error } = await this.sb.from("itens").insert(toRow(item)).select().single();
      if (error) throw error;
      const result = this.put(data);
      this.emit();
      return result;
    }

    // Atualização: mostra já a alteração e confirma com o servidor.
    const before = this.find(item.id);
    this.put(item);
    this.emit();
    const { data, error } = await this.sb.from("itens").update(toRow(item)).eq("id", item.id).select().single();
    if (error) {
      if (before) this.put(before);
      this.emit();
      throw error;
    }
    const result = this.put(data);
    this.emit();
    return result;
  },

  async insertItems(list) {
    if (!list.length) return 0;
    if (!this.sb) {
      list.forEach(raw => this.put({ ...raw, id: localId(), criado_em: nowISO() }));
      this.emit();
      return list.length;
    }
    const { data, error } = await this.sb.from("itens").insert(list.map(toRow)).select();
    if (error) throw error;
    data.forEach(row => this.put(row));
    this.emit();
    return data.length;
  },

  async removeItem(id) {
    if (this.sb) {
      const { error } = await this.sb.from("itens").delete().eq("id", id);
      if (error) throw error;
    }
    this.drop(id);
    this.emit();
  },

  async removeItems(ids) {
    if (!ids.length) return;
    if (this.sb) {
      const { error } = await this.sb.from("itens").delete().in("id", ids);
      if (error) throw error;
    }
    const gone = new Set(ids);
    this.items = this.items.filter(it => !gone.has(it.id));
    this.emit();
  },

  /* ---------- divisões e orçamento ---------- */

  async updateConfig(patch) {
    const before = { divisoes: this.cfg.divisoes.slice(), orcamento: this.cfg.orcamento };
    this.applyConfig(patch);
    this.emit();
    if (!this.sb) return;
    const { error } = await this.sb.from("config").upsert({ id: 1, divisoes: this.cfg.divisoes, orcamento: this.cfg.orcamento });
    if (error) {
      this.applyConfig(before);
      this.emit();
      throw error;
    }
  },

  addRoom(name) {
    return this.updateConfig({ divisoes: [...this.cfg.divisoes, name] });
  },

  async ensureRoom(name) {
    if (!this.cfg.divisoes.includes(name)) await this.addRoom(name);
  },

  async renameRoom(from, to) {
    if (this.sb) {
      const { error } = await this.sb.from("itens").update({ divisao: to }).eq("divisao", from);
      if (error) throw error;
    }
    this.items = this.items.map(it => (it.divisao === from ? { ...it, divisao: to } : it));
    const rooms = this.cfg.divisoes.includes(from)
      ? this.cfg.divisoes.map(room => (room === from ? to : room))
      : [...this.cfg.divisoes, to];
    await this.updateConfig({ divisoes: [...new Set(rooms)] });
  },

  /* Põe as divisões já existentes no padrão "Casa de Banho" (inclui dados antigos). */
  async normalizeRoomNames() {
    const names = [...new Set([...this.cfg.divisoes, ...this.items.map(it => it.divisao)])];
    for (const from of names) {
      const to = roomTitle(from);
      if (to && to !== from) await this.renameRoom(from, to);
    }
  },

  async removeRoom(name) {
    if (this.sb) {
      const { error } = await this.sb.from("itens").delete().eq("divisao", name);
      if (error) throw error;
    }
    this.items = this.items.filter(it => it.divisao !== name);
    await this.updateConfig({ divisoes: this.cfg.divisoes.filter(room => room !== name) });
  },
};
