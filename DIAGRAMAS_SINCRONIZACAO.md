# Diagramas de Sincronização - Launcher Bot

## 🔴 Problema 1: Early Return Bloqueia Reload

### Fluxo Problemático Atual

```
┌─────────────────────────────────────────────────────────────┐
│ Utilizador em Dashboard                                      │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Seleciona Srv A │
                    └─────────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │ loadConfig() [useEffect]   │
                │ - if (serverConfigs[A]) → │
                │   return (skip)            │
                └────────────────────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │ fetch /configs/A           │
                │ serverConfigs[A] = config  │
                └────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
        ┌──────────────┐        ┌──────────────┐
        │ Seleciona    │        │ Outro admin  │
        │ Servidor B   │        │ muda config  │
        │              │        │ de servidor A│
        └──────────────┘        └──────────────┘
                │                       │
                ▼                       ▼
        ┌──────────────────┐    ┌──────────────┐
        │ loadConfig() [B] │    │ Banco dados  │
        │ fetch /configs/B │    │ atualizado   │
        └──────────────────┘    └──────────────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
┌──────────────┐  ┌──────────────┐
│ Volta p/     │  │ ❌ PROBLEMA  │
│ Servidor A   │  │              │
└──────────────┘  │ Config A tem  │
        │         │ TTL indefinido│
        ▼         │              │
┌──────────────────────┐         │ Configuração
│ loadConfig() [A]     │◄────────┤ DESATUALIZADA
│ if (serverConfigs[A])│         │
│    return (skip)     │         │
│ ❌ Não recarrega!    │         │
└──────────────────────┘         │
        │                         │
        ▼                         │
┌──────────────────────┐         │
│ UI mostra config     │────────►│
│ DESATUALIZADA        │         │
└──────────────────────┘         │
                                  │
                          ┌───────┴────────┐
                          │ Utilizador não │
                          │ vê mudanças    │
                          │ feitas por     │
                          │ outros admins  │
                          └────────────────┘
```

### Fluxo Corrigido (Com TTL)

```
┌─────────────────────────────────────────────────────────────┐
│ Utilizador em Dashboard                                      │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Seleciona Srv A │
                    └─────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────┐
        │ loadConfig() - Versão Corrigida    │
        │                                    │
        │ now = Date.now()                   │
        │ lastLoaded = configTimestamps[A]   │
        │ isCacheValid = (now - lastLoaded)  │
        │              < CONFIG_CACHE_TTL    │
        │              (5 minutos)           │
        │                                    │
        │ if (isCacheValid && config[A])    │
        │    return (USE CACHE) ✓           │
        │                                    │
        │ else FETCH /configs/A ✓           │
        └────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────┐
        │                                     │
        ▼                                     ▼
5 min.  Volta p/               Volta p/       >5 min.
após    Servidor A            Servidor A     após
        (cache ainda          (cache expirou)
         válido)
        │                     │
        ▼                     ▼
┌──────────────────┐  ┌──────────────────────┐
│ USE CACHE ✓      │  │ fetch /configs/A ✓   │
│ Config[A]        │  │ serverConfigs[A] = ? │
│ atualizada       │  │ (novo valor)         │
└──────────────────┘  │                      │
                      │ Vê mudanças feitas   │
                      │ por outros admins! ✓ │
                      └──────────────────────┘
```

---

## 🔴 Problema 2: saveGuildConfig Sem Validação

### Fluxo Problemático Atual

```
┌───────────────────────────────────────────┐
│ Utilizador ativa Feature X                │
└───────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────────────┐
    │ toggleFeature(X, enabled)   │
    └─────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
┌──────────────┐  ┌──────────────────────┐
│ setState()   │  │ saveGuildConfig()    │
│ UI atualiza  │  │ void (fire-and-      │
│ "ativado" ✓  │  │     forget)          │
│              │  │                      │
│ Mostra para  │  │ Não aguarda!         │
│ utilizador   │  │ Não valida!          │
│ "ativado"    │  │ Não trata erro!      │
└──────────────┘  └──────────────────────┘
       │                   │
       │                   ▼
       │          ┌─────────────────┐
       │          │ POST /configs/A │
       │          └─────────────────┘
       │                   │
       │          ┌────────┴────────┐
       │          │                 │
       │          ▼                 ▼
       │      ❌ ERRO          ✓ SUCESSO
       │      (BD indisponível) (Feature
       │       Validação)        ativada)
       │      │                   │
       │      │                   ▼
       │      │          ┌──────────────────┐
       │      │          │ BD atualizada ✓  │
       │      │          │ serverConfigs[A] │
       │      │          │ mostra "ativado" │
       │      │          └──────────────────┘
       │      │
       │      ▼
       │  ┌──────────────────────┐
       │  │ ❌ DESINCRONIZAÇÃO   │
       │  │                      │
       │  │ - UI mostra          │
       │  │   "ativado"          │
       │  │                      │
       │  │ - BD tem config      │
       │  │   DESATUALIZADA      │
       │  │   (erro não foi      │
       │  │    aplicado)         │
       │  │                      │
       │  │ - Próxima mudança    │
       │  │   pode corromper     │
       │  │   estado             │
       │  └──────────────────────┘
       │
       └─────────────────────────►
                                   │
                                   ▼
                          ┌─────────────────────┐
                          │ ❌ RESULTADO        │
                          │                     │
                          │ - Sem feedback erro │
                          │ - Estado corrupto   │
                          │ - Mudanças perdidas │
                          └─────────────────────┘
```

### Fluxo Corrigido (Com Validação)

```
┌───────────────────────────────────────────┐
│ Utilizador ativa Feature X                │
└───────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────────────┐
    │ toggleFeature(X, enabled)   │
    │ (Versão Corrigida)          │
    └─────────────────────────────┘
              │
    ┌─────────┴──────────────────┐
    │                            │
    ▼                            ▼
┌──────────────┐  ┌──────────────────────────────┐
│ setState()   │  │ saveGuildConfig()            │
│ UI otimista  │  │ .then(result => {            │
│ "ativado" ✓  │  │    // Aguarda + Valida      │
│              │  │    if (result?.config) {    │
│              │  │      setState(result)       │
│              │  │      setSyncErrors(null)    │
│              │  │      setLastSync(now)       │
│              │  │    }                        │
│              │  │ })                          │
│              │  │ .catch(error => {           │
│              │  │    // Trata erro            │
│              │  │    setSyncErrors(error)     │
│              │  │    reloadFromDB()           │
│              │  │ })                          │
└──────────────┘  └──────────────────────────────┘
       │                      │
       │                      ▼
       │            ┌──────────────────┐
       │            │ POST /configs/A  │
       │            └──────────────────┘
       │                      │
       │            ┌─────────┴──────────┐
       │            │                    │
       │            ▼                    ▼
       │        ❌ ERRO           ✓ SUCESSO
       │                            │
       │        │                   ▼
       │        │        ┌─────────────────────┐
       │        │        │ .then() - Sucesso   │
       │        │        │                     │
       │        │        │ - setState(result)  │
       │        │        │   BD confirmada ✓   │
       │        │        │                     │
       │        │        │ - setSyncErrors(null)
       │        │        │   Sem erro ✓        │
       │        │        │                     │
       │        │        │ - setLastSync(now)  │
       │        │        │   Timestamp ✓       │
       │        │        │                     │
       │        │        │ ✓ Sincronizado!     │
       │        │        └─────────────────────┘
       │        │
       │        ▼
       │    ┌──────────────────────┐
       │    │ .catch() - Erro      │
       │    │                      │
       │    │ - setSyncErrors()    │
       │    │   Mostra erro UI ✓   │
       │    │                      │
       │    │ - getGuildConfig()   │
       │    │   Recarrega BD ✓     │
       │    │                      │
       │    │ - setState(realConfig)
       │    │   Reverte estado ✓   │
       │    │                      │
       │    │ ✓ Sincronizado!      │
       │    └──────────────────────┘
       │
       └────────────►
                     │
                     ▼
          ┌──────────────────────┐
          │ ✓ RESULTADO          │
          │                      │
          │ - Feedback clear     │
          │ - Estado correto     │
          │ - Erro tratado       │
          │ - Sincronizado       │
          └──────────────────────┘
```

---

## 🔴 Problema 3: Bot Cache Sem Invalidação

### Fluxo Problemático Atual

```
╔══════════════════════════════════════════════════════════════╗
║                        SERVIDOR 1                            ║
║                    plan: "free"                              ║
║                    cache em Bot                              ║
╚══════════════════════════════════════════════════════════════╝
              │
    ┌─────────┴──────────┐
    │                    │
    ▼                    ▼
┌──────────────┐  ┌────────────────┐
│ Bot          │  │ Admin muda     │
│ getConfig()  │  │ plan → premium  │
│              │  │ via AdminPanel  │
│ cache.get()  │  │                │
│ plan: "free" │  │ POST /admin/    │
│              │  │ guilds/1/plan   │
└──────────────┘  └────────────────┘
    │                    │
    │                    ▼
    │            ┌─────────────────┐
    │            │ Prisma.update() │
    │            │                 │
    │            │ guild.plan:     │
    │            │   "premium" ✓   │
    │            │                 │
    │            │ config.plan:    │
    │            │   "premium" ✓   │
    │            │                 │
    │            │ BD atualizada ✓ │
    │            └─────────────────┘
    │                    │
    │                    ▼
    │            ┌─────────────────┐
    │            │ ❌ BOT NÃO SABE │
    │            │                 │
    │            │ Cache continua: │
    │            │ plan: "free"    │
    │            │                 │
    │            │ Sem invalidação │
    │            └─────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Bot em Servidor 1       │
│ Config de cache:        │
│                         │
│ - plan: "free" ❌       │
│ - permissões normais    │
│                         │
│ ❌ Features premium NÃO │
│    funcionam            │
│                         │
│ Discrepância:           │
│ BD: premium             │
│ Bot: free               │
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ ❌ RESULTADO            │
│                         │
│ - Bot com cache antigo  │
│ - Features não aparecem │
│ - Admin confuso         │
│ - "Pagou mas não vê?"   │
└─────────────────────────┘
```

### Fluxo Corrigido (Com Invalidação)

```
╔══════════════════════════════════════════════════════════════╗
║                        SERVIDOR 1                            ║
║                    plan: "free"                              ║
║                    cache em Bot                              ║
╚══════════════════════════════════════════════════════════════╝
              │
    ┌─────────┴──────────┐
    │                    │
    ▼                    ▼
┌──────────────┐  ┌────────────────┐
│ Bot          │  │ Admin muda     │
│ getConfig()  │  │ plan → premium  │
│              │  │ via AdminPanel  │
│ cache.get()  │  │                │
│ plan: "free" │  │ POST /admin/    │
│              │  │ guilds/1/plan   │
└──────────────┘  └────────────────┘
    │                    │
    │                    ▼
    │            ┌─────────────────┐
    │            │ Prisma.update() │
    │            │                 │
    │            │ guild.plan:     │
    │            │   "premium" ✓   │
    │            │                 │
    │            │ config.plan:    │
    │            │   "premium" ✓   │
    │            │                 │
    │            │ BD atualizada ✓ │
    │            └─────────────────┘
    │                    │
    │                    ▼
    │            ┌─────────────────────┐
    │            │ 🆕 notifyBot()      │
    │            │                     │
    │            │ POST /internal/     │
    │            │  invalidate-cache   │
    │            │                     │
    │            │ Headers:            │
    │            │  Authorization:     │
    │            │    BOT_INTERNAL_KEY │
    │            │                     │
    │            │ Body:               │
    │            │  guildId: "1"       │
    │            │  changeType: "plan" │
    │            └─────────────────────┘
    │                    │
    │                    ▼
    │            ┌─────────────────────┐
    │            │ Bot recebe request  │
    │            │ /internal/...       │
    │            │                     │
    │            │ validateKey() ✓     │
    │            │                     │
    │            │ configStore        │
    │            │  .clear(guildId)   │
    │            │                     │
    │            │ cache.delete("1") ✓│
    │            │ timestamps.delete() │
    │            │                     │
    │            │ Log: "Cache cleared"│
    │            └─────────────────────┘
    │                    │
    │                    ▼
    │            ┌─────────────────────┐
    │            │ Próxima solicitação │
    │            │ do Bot              │
    │            │ getConfig("1")      │
    │            │                     │
    │            │ cache.has("1") = NO │
    │            │ → Fetch BD ✓        │
    │            │                     │
    │            │ plan: "premium" ✓   │
    │            │ cache.set("1", new) │
    │            └─────────────────────┘
    │
    ▼
┌──────────────────────────┐
│ Bot em Servidor 1        │
│ Config ATUALIZADA:       │
│                          │
│ - plan: "premium" ✓      │
│ - features premium       │
│                          │
│ ✓ Features premium       │
│   FUNCIONAM!             │
└──────────────────────────┘
        │
        ▼
┌──────────────────────────┐
│ ✓ RESULTADO              │
│                          │
│ - Bot sincronizado       │
│ - Features aparecem      │
│ - Admin satisfeito       │
│ - Sem desincronização    │
└──────────────────────────┘
```

---

## 🟠 Problema 4: Sem Polling (Multi-Admin)

### Cenário Problemático Atual

```
TIMELINE:

10:00:00
┌─────────────────────────────────────────────┐
│ Admin A logado no Dashboard                  │
│ Admin B logado no Dashboard                  │
│ Ambos veem: Servidor X - plan: "free"      │
└─────────────────────────────────────────────┘

10:00:05
┌─────────────────────────────────────────────┐
│ Admin A vai para AdminPanel                  │
│ Admin A muda Servidor X plan: "free" → "prem"
│                                              │
│ POST /admin/guilds/X/plan                   │
│ Resposta: ✓ Sucesso                         │
│                                              │
│ Admin A vê: "premium" ✓                      │
└─────────────────────────────────────────────┘

10:00:06
┌─────────────────────────────────────────────┐
│ Admin B ainda em Dashboard                   │
│ Admin B vê: "free" ❌                        │
│                                              │
│ Sem polling → sem notificação                │
│ Admin B não sabe que mudou!                  │
│                                              │
│ Confusão do utilizador:                      │
│ "Porque está ainda de graça?"                │
│ "Activei premium! Porquê não funciona?"      │
└─────────────────────────────────────────────┘

10:01:00
┌─────────────────────────────────────────────┐
│ Admin B ainda vê: "free" ❌                  │
│ (1 minuto depois!)                           │
│                                              │
│ Sem mecanismo automático                     │
│ Admin B tem que fazer logout/login           │
│ Único jeito de sincronizar                   │
└─────────────────────────────────────────────┘
```

### Fluxo Corrigido (Com Polling)

```
TIMELINE:

10:00:00
┌─────────────────────────────────────────────┐
│ Admin A logado no Dashboard                  │
│ Admin B logado no Dashboard                  │
│ Ambos veem: Servidor X - plan: "free"      │
│                                              │
│ 🔄 Polling iniciado a cada 1 min             │
│    (em background)                           │
└─────────────────────────────────────────────┘

10:00:05
┌─────────────────────────────────────────────┐
│ Admin A vai para AdminPanel                  │
│ Admin A muda Servidor X plan: "free" → "prem"
│                                              │
│ POST /admin/guilds/X/plan                   │
│ Resposta: ✓ Sucesso                         │
│                                              │
│ Admin A vê: "premium" ✓                      │
│ lastSync: 10:00:05                           │
└─────────────────────────────────────────────┘

10:00:06
┌─────────────────────────────────────────────┐
│ Admin B ainda em Dashboard                   │
│ Admin B vê: "free" (ainda)                   │
│                                              │
│ Mas polling já started:                      │
│ 🔄 GET /configs/X (em background)           │
│ Configuração ATUALIZADA recebida ✓           │
│                                              │
│ Admin B UI atualiza: "premium" ✓             │
│ Admin B vê: "premium" (1 seg depois)         │
│ lastSync: 10:00:06 ✓                         │
└─────────────────────────────────────────────┘

10:00:07
┌─────────────────────────────────────────────┐
│ Ambos admins em sincronização!               │
│                                              │
│ Admin A: "premium" ✓ (01 seg)                │
│ Admin B: "premium" ✓ (02 seg)                │
│                                              │
│ Indicador visual: "Sincronizado há 1 seg"    │
│ ✓ Sem confusão                               │
│ ✓ Real-time (< 2 seg)                        │
└─────────────────────────────────────────────┘
```

---

## ✅ Solução Completa - Fluxo Sincronizado

```
┌─────────────────────────────────────────────────────────────────┐
│                     ADMIN PANEL                                  │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ Servidor X | Plan: free                                     │
│  │ [Mudar para Premium]                                        │
│  │                                                              │
│  │ SyncStatus:                                                 │
│  │ ⚠️  Sincronizado há 30 seg                                  │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
              │
              │ POST /admin/guilds/X/plan
              │ { plan: "premium" }
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API (Backend)                              │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ adminRouter.post('/guilds/:guildId/plan')                  │
│  │ ✓ Valida token admin                                       │
│  │ ✓ Valida plano                                             │
│  │ ✓ Prisma.guild.update(plan: "premium")                    │
│  │ ✓ Prisma.guildConfig.update(rawConfig.plan)               │
│  │                                                              │
│  │ 🆕 notifyBotConfigChanged(guildId, 'plan')                │
│  │    POST /internal/invalidate-cache                         │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
              │                              │
              │ Resposta: ✓ Success          │ POST /internal/
              │                              │ invalidate-cache
              ▼                              │
┌─────────────────────────────┐             │
│     ADMIN PANEL UPDATE      │             │
│ ┌───────────────────────────┐             │
│ │ 1. setState(users, new)   │             │
│ │    plan: "premium" ✓      │             │
│ │                           │             │
│ │ 2. setLastSync(now) ✓     │             │
│ │                           │             │
│ │ 3. loadUsers() reload     │             │
│ │    double-check ✓         │             │
│ │                           │             │
│ │ UI mostra:                │             │
│ │ "premium" ✓               │             │
│ └───────────────────────────┘             │
└─────────────────────────────┘             │
                                            ▼
                            ┌──────────────────────────┐
                            │    BOT SERVICE           │
                            │ /internal/invalidate-    │
                            │  cache                   │
                            │                          │
                            │ ✓ Validate key          │
                            │ ✓ configStore.clear()   │
                            │ ✓ Timestamp reset        │
                            │ ✓ Log: cached cleared    │
                            └──────────────────────────┘
                                            │
                                            ▼ (próx. request)
                            ┌──────────────────────────┐
                            │ Bot getConfig(X)         │
                            │                          │
                            │ cache.has(X) = NO        │
                            │ Fetch: GET /configs/X    │
                            │ plan: "premium" ✓        │
                            │ cache.set(X, new)        │
                            └──────────────────────────┘
                                            │
                                            ▼
                            ┌──────────────────────────┐
                            │ Bot em Servidor X        │
                            │                          │
                            │ plan: "premium" ✓        │
                            │ features premium ON ✓    │
                            │ Sincronizado! ✓          │
                            └──────────────────────────┘

────────────────────────────────────────────────────────────

POLLING (Background - cada 1 min)

┌─────────────────────────────────────────────────────────┐
│          DASHBOARD - Admin B                             │
│ Timer: 10:00:05 (Admin A mudou)                          │
│                                                          │
│ 🔄 Polling tick (10:01:05)                             │
│                                                          │
│ GET /configs/X                                          │
│ ↓                                                       │
│ Response:                                               │
│ {                                                       │
│   plan: "premium",     ← ATUALIZADO!                   │
│   features: {...}                                       │
│ }                                                       │
│                                                          │
│ ✓ setServerConfigs[X] = nova config                     │
│ ✓ setLastSyncTimestamp[X] = 10:01:05                   │
│                                                          │
│ UI atualiza:                                            │
│ Servidor X | Plan: "premium" ✓                          │
│                                                          │
│ SyncStatus: "Sincronizado há 0 seg"                     │
└─────────────────────────────────────────────────────────┘

────────────────────────────────────────────────────────────

ERROR HANDLING

┌─────────────────────────────────────────────────────────┐
│ ADMIN PANEL                                              │
│                                                          │
│ Feature toggle + saveGuildConfig()                      │
│     ↓ (error: network down)                             │
│     ├─ .catch(error)                                    │
│     ├─ setSyncErrors[serverId] = error.message          │
│     ├─ getGuildConfig() → reloadFromDB                  │
│     ├─ setState(realConfig) → revert changes            │
│     └─ UI shows: ⚠️  "Erro: Timeout"                    │
│                                                          │
│ User feedback:                                          │
│ ⚠️  Erro sincronizando. Tente novamente.                │
│                                                          │
│ Data consistency:                                       │
│ ✓ Estado local reverte para BD ✓                        │
│ ✓ Sem corrupção de dados ✓                              │
└─────────────────────────────────────────────────────────┘
```

---

## 📊 Tempo de Sincronização

```
┌──────────────────────────────────────────────────────────┐
│ Operação                         │ Tempo        │ Status   │
├──────────────────────────────────┼──────────────┼──────────┤
│ Admin A muda plan (POST)         │ 0 ms        │ 🔵 Início│
│ API atualiza BD                  │ +50 ms      │ 🟡 DB    │
│ Bot é notificado                 │ +100 ms     │ 🟡 Bot   │
│ Admin A UI atualiza (setState)   │ +150 ms     │ 🟢 Vê    │
│ Bot limpa cache                  │ +200 ms     │ 🟢 Cache │
│ Admin B polling sincroniza       │ +1000 ms    │ 🟢 Vê    │
│                                  │ (1 segundo) │         │
└──────────────────────────────────────────────────────────┘

SEM Polling (Antes):
┌─────────────────────────────────────────────┐
│ Admin A vê mudança:    +150 ms ✓             │
│ Admin B vê mudança:    ∞ (até logout/login)  │
│ Status: Desincronizado                      │
└─────────────────────────────────────────────┘

COM Polling (Depois):
┌─────────────────────────────────────────────┐
│ Admin A vê mudança:    +150 ms ✓             │
│ Admin B vê mudança:    ~1000 ms (1 seg) ✓   │
│ Status: Sincronizado!                       │
└─────────────────────────────────────────────┘
```
