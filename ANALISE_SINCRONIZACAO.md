# Análise de Problemas de Sincronização - Launcher Bot

**Data**: 22 de maio de 2026  
**Status**: Análise Completa com Plano de Implementação

---

## 📋 Resumo Executivo

O projeto tem **5 problemas críticos de sincronização** que causam desincronização entre:
- Frontend (Web Dashboard)
- Backend (API)
- Cache do Bot
- Estado local vs. BD

Quando múltiplos admins trabalham simultaneamente, as mudanças de um não são refletidas automaticamente para o outro.

---

## 🔴 Problemas Detalhados

### 1. **AppContext.tsx: Condição de Early Return Impede Reload**

**Localização**: [apps/web/src/contexts/AppContext.tsx](apps/web/src/contexts/AppContext.tsx#L147-L168)

**Código problemático**:
```tsx
useEffect(() => {
  if (!selectedServerId) return;
  if (serverConfigs[selectedServerId]) return;  // ← PROBLEMA: bloqueia recarregamento
  const serverId = selectedServerId;
  
  let cancelled = false;
  
  async function loadConfig() {
    // carrega config do servidor
  }
  
  void loadConfig();
  return () => { cancelled = true; };
}, [selectedServerId, serverConfigs, usingFallback]);
```

**Comportamento problemático**:
1. Utilizador seleciona servidor A → config carregada
2. Utilizador muda para servidor B → config carregada
3. Utilizador muda de volta para servidor A → **NÃO recarrega** (config já existe em cache)
4. Se alguém mudou as configs do servidor A na BD, o utilizador não vê as mudanças

**Impacto**: 🟠 **Alto** - Impossível ver mudanças feitas por outros admins sem logout/login

**Raiz**: Cache local indefinido sem TTL (Time To Live)

---

### 2. **AdminPanel.tsx: Atualização de Plano Sem Revalidação**

**Localização**: [apps/web/src/pages/AdminPanel.tsx](apps/web/src/pages/AdminPanel.tsx#L89-L112)

**Código problemático**:
```tsx
async function updateGuildPlan(guildId: string, newPlan: 'free' | 'premium') {
  setUpdatingGuildId(guildId);
  try {
    await api.setGuildPlan(guildId, newPlan);
    
    // Apenas atualiza estado local
    setUsers(prevUsers =>
      prevUsers.map(user => ({
        ...user,
        guilds: user.guilds.map(guild =>
          guild.id === guildId ? { ...guild, plan: newPlan } : guild
        )
      }))
    );
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to update plan');
  } finally {
    setUpdatingGuildId(null);
  }
}
```

**Comportamento problemático**:
1. Admin muda plano do servidor A para "premium" via AdminPanel
2. API retorna sucesso
3. Estado local é atualizado (UI mostra "premium")
4. **Mas**: Utilizadores logados no Dashboard não veem a mudança
5. Lista de utilizadores mostra plano antigo até reload manual

**Impacto**: 🟠 **Alto** - Dados desincronizados na UI vs. BD

**Raiz**: Falta de invalidação de cache e polling

---

### 3. **AppContext.tsx: saveGuildConfig Sem Validação**

**Localização**: [apps/web/src/contexts/AppContext.tsx](apps/web/src/contexts/AppContext.tsx#L216-L243)

**Código problemático**:
```tsx
toggleFeature: (featureId, enabled) => {
  if (!selectedServerId) return;
  const serverId = selectedServerId;
  let nextConfig: ServerConfig | null = null;
  
  setServerConfigs((current) => {
    // atualiza estado local
    return { ...current, [serverId]: nextConfig };
  });
  
  if (nextConfig) {
    const normalizedConfig = normalizeServerConfig(serverId, nextConfig);
    // ← PROBLEMA: não aguarda resultado, não verifica erro
    void (usingFallback
      ? fallbackApi.saveGuildConfig(serverId, normalizedConfig)
      : api.saveGuildConfig(serverId, normalizedConfig));
  }
},
```

**Comportamento problemático**:
1. Utilizador ativa feature "X" no Dashboard
2. Estado local é atualizado imediatamente (UI mostra "ativado")
3. `saveGuildConfig` é enviado mas **não é aguardado** (`void`)
4. Se API retorna erro (validação, permissão, BD indisponível):
   - Utilizador não é informado (sem erro visual)
   - Estado local desincroniza com BD
   - Próximas mudanças podem gerar estado corrupto

**Impacto**: 🔴 **Crítico** - Corrupção de estado sem feedback

**Raiz**: Fire-and-forget sem tratamento de erros

---

### 4. **Bot Config Cache: Sem Invalidação Quando Plan Muda**

**Localização**: [apps/bot/src/services/runtimeConfigStore.js](apps/bot/src/services/runtimeConfigStore.js)

**Código atual**:
```javascript
export function createRuntimeConfigStore(env) {
  const cache = new Map();

  async function getGuildConfigCached(guildId, { force = false } = {}) {
    if (!force && cache.has(guildId)) {
      return cache.get(guildId);  // retorna cache indefinidamente
    }

    const config = await fetchGuildConfig(env.apiBaseUrl, env.botApiKey, guildId);
    cache.set(guildId, config);
    return config;
  }

  function clearGuildConfig(guildId) {
    cache.delete(guildId);
  }

  // ... sem endpoint para invalidar cache quando plan muda
}
```

**Comportamento problemático**:
1. Bot carrega config do servidor A (inclui `plan: "free"`)
2. Admin muda plano para "premium" via AdminPanel API
3. BD é atualizada
4. **Mas**: Bot continua com cache (`plan: "free"`)
5. Features premium não funcionam porque cache está desatualizado

**Impacto**: 🔴 **Crítico** - Bot usa dados desatualizados indefinidamente

**Raiz**: Cache sem TTL, sem mecanismo de invalidação do lado do bot

---

### 5. **Sem Polling/Refresh: Mudanças Não São Sincronizadas**

**Localização**: Não existe em nenhum ficheiro (feature ausente)

**Cenário problemático**:
```
Timeline:
10:00:00 - Admin A e Admin B logados no Dashboard
10:00:05 - Admin A muda plano do servidor X para "premium"
10:00:06 - Admin B ainda vê "free" (mudança não é sincronizada)
10:01:00 - Admin B faz logout e login novamente → vê "premium"
```

**Impacto**: 🟠 **Alto** - Sem sincronização em tempo real entre múltiplos admins

**Raiz**: Sem mecanismo de polling ou WebSocket

---

## ✅ Plano de Solução

### **Fase 1: Correções Críticas** (Prioridade Máxima)

#### 1.1 - Forçar Recarregamento de Configs ao Trocar Servidor

**Ficheiro**: [apps/web/src/contexts/AppContext.tsx](apps/web/src/contexts/AppContext.tsx#L147-L168)

**Mudança**:
```tsx
// Antes:
useEffect(() => {
  if (!selectedServerId) return;
  if (serverConfigs[selectedServerId]) return;  // ← Remove isto
  // ...
}, [selectedServerId, serverConfigs, usingFallback]);

// Depois: Adicionar TTL (Time To Live)
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const [configTimestamps, setConfigTimestamps] = useState<Record<string, number>>({});

useEffect(() => {
  if (!selectedServerId) return;
  
  const now = Date.now();
  const lastLoaded = configTimestamps[selectedServerId];
  const isCacheValid = lastLoaded && (now - lastLoaded) < CONFIG_CACHE_TTL;
  
  if (isCacheValid && serverConfigs[selectedServerId]) return;
  
  const serverId = selectedServerId;
  let cancelled = false;

  async function loadConfig() {
    try {
      const config = usingFallback
        ? await fallbackApi.getGuildConfig(serverId)
        : await api.getGuildConfig(serverId);
      if (!cancelled) {
        setServerConfigs((current) => ({
          ...current,
          [serverId]: normalizeServerConfig(serverId, config)
        }));
        setConfigTimestamps((current) => ({
          ...current,
          [serverId]: now
        }));
      }
    } catch {
      if (!cancelled && mockServerConfigs[serverId]) {
        setServerConfigs((current) => ({ ...current, [serverId]: mockServerConfigs[serverId] }));
      }
    }
  }

  void loadConfig();
  return () => { cancelled = true; };
}, [selectedServerId, configTimestamps, usingFallback]);
```

**Benefício**: Configs expiram a cada 5 minutos, forçando recarregamento mesmo que sejam armazenadas

---

#### 1.2 - Validar Resposta de saveGuildConfig

**Ficheiro**: [apps/web/src/contexts/AppContext.tsx](apps/web/src/contexts/AppContext.tsx#L216-L270)

**Mudança**:
```tsx
// Novo estado para tracking de erros
const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
const [lastSyncTimestamp, setLastSyncTimestamp] = useState<Record<string, number>>({});

toggleFeature: (featureId, enabled) => {
  if (!selectedServerId) return;
  const serverId = selectedServerId;
  let nextConfig: ServerConfig | null = null;
  
  setServerConfigs((current) => {
    const server = current[serverId];
    if (!server) return current;
    nextConfig = {
      ...server,
      features: {
        ...server.features,
        [featureId]: {
          ...server.features[featureId],
          enabled
        }
      }
    };
    return { ...current, [serverId]: nextConfig as ServerConfig };
  });
  
  if (nextConfig) {
    const normalizedConfig = normalizeServerConfig(serverId, nextConfig);
    
    // Aguarda resultado e valida
    (usingFallback
      ? fallbackApi.saveGuildConfig(serverId, normalizedConfig)
      : api.saveGuildConfig(serverId, normalizedConfig)
    )
      .then((result) => {
        if (result?.config) {
          // Sucesso: atualiza com valor confirmado da BD
          setServerConfigs((current) => ({
            ...current,
            [serverId]: normalizeServerConfig(serverId, result.config)
          }));
          setSyncErrors((current) => {
            const next = { ...current };
            delete next[serverId];
            return next;
          });
          setLastSyncTimestamp((current) => ({
            ...current,
            [serverId]: Date.now()
          }));
        }
      })
      .catch((error) => {
        // Erro: reverte estado local
        setSyncErrors((current) => ({
          ...current,
          [serverId]: error?.message || 'Erro ao sincronizar'
        }));
        // Recarrega config do servidor para sincronizar
        void (usingFallback
          ? fallbackApi.getGuildConfig(serverId)
          : api.getGuildConfig(serverId)
        ).then((config) => {
          setServerConfigs((current) => ({
            ...current,
            [serverId]: normalizeServerConfig(serverId, config)
          }));
        });
      });
  }
},

updateFeatureConfig: (featureId, updater) => {
  // Mesmo padrão que acima
}
```

**Benefício**: Erros são capturados e o estado é sincronizado com a BD

---

#### 1.3 - Invalidar Cache do Bot Quando Plan Muda

**Ficheiro**: [apps/api/src/routes/admin.js](apps/api/src/routes/admin.js#L63-L107)

**Mudança**: Adicionar notificação ao bot quando plan muda

```javascript
import { notifyBotConfigChanged } from '../services/botNotificationService.js';

adminRouter.post('/guilds/:guildId/plan', requireAuth, requireAdmin, async (request, response) => {
  const { guildId } = request.params;
  const { plan } = request.body;

  if (!['free', 'premium'].includes(plan)) {
    return response.status(400).json({ message: 'Invalid plan. Must be "free" or "premium".' });
  }

  try {
    // Update guild record
    const guild = await prisma.guild.update({
      where: { id: guildId },
      data: { plan }
    });

    // Update guild config
    const config = await prisma.guildConfig.findUnique({
      where: { guildId }
    });

    if (config) {
      const rawConfig = config.rawConfig || {};
      rawConfig.plan = plan;
      
      await prisma.guildConfig.update({
        where: { guildId },
        data: { rawConfig }
      });
    }

    // 🆕 Notifica bot para invalidar cache
    try {
      await notifyBotConfigChanged(guildId, 'plan');
    } catch (notifyError) {
      console.warn('[admin] Failed to notify bot:', notifyError);
      // Continua mesmo se notificação falhar
    }

    response.json({ 
      message: `Guild ${guildId} plan updated to ${plan}`,
      guild: {
        id: guild.id,
        name: guild.name,
        plan: guild.plan
      }
    });
  } catch (error) {
    console.error('[admin] updateGuildPlan error:', error);
    response.status(500).json({ message: 'Failed to update guild plan' });
  }
});
```

**Novo ficheiro**: [apps/api/src/services/botNotificationService.js](apps/api/src/services/botNotificationService.js)

```javascript
/**
 * Notifica o bot para invalidar cache quando configurações mudam
 * Usa API interna do bot via HTTP ou Redis
 */
export async function notifyBotConfigChanged(guildId, changeType) {
  // Opção 1: REST API (se bot expõe endpoint interno)
  try {
    const response = await fetch(`${process.env.BOT_API_URL}/internal/invalidate-cache`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.BOT_INTERNAL_KEY}`
      },
      body: JSON.stringify({
        guildId,
        changeType,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Bot API returned ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[botNotification] Failed to notify bot for guild ${guildId}:`, error);
    throw error;
  }
}
```

**Ficheiro Bot**: [apps/bot/src/routes/internal.js](apps/bot/src/routes/internal.js) (novo)

```javascript
import { Router } from 'express';

export function createInternalRouter(configStore) {
  const router = Router();

  // Middleware: Validar chave interna
  const validateInternalKey = (req, res, next) => {
    const key = req.headers.authorization?.split(' ')[1];
    if (key !== process.env.BOT_INTERNAL_KEY) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    next();
  };

  // POST /internal/invalidate-cache
  router.post('/invalidate-cache', validateInternalKey, (req, res) => {
    const { guildId, changeType } = req.body;
    
    if (!guildId) {
      return res.status(400).json({ message: 'guildId required' });
    }

    try {
      configStore.clearGuildConfig(guildId);
      
      console.log(`[internal] Cache invalidated for guild ${guildId} (reason: ${changeType})`);
      
      res.json({
        success: true,
        message: `Cache invalidated for guild ${guildId}`,
        guildId,
        changeType,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[internal] Failed to invalidate cache:`, error);
      res.status(500).json({ message: 'Failed to invalidate cache' });
    }
  });

  return router;
}
```

**Benefício**: Quando plan muda, bot limpa cache e recarrega na próxima solicitação

---

### **Fase 2: Sincronização Automática** (Prioridade Alta)

#### 2.1 - Adicionar Polling de Sincronização

**Ficheiro**: [apps/web/src/contexts/AppContext.tsx](apps/web/src/contexts/AppContext.tsx)

**Mudança**: Novo useEffect para polling periódico

```tsx
const SYNC_INTERVAL = 1 * 60 * 1000; // 1 minuto

useEffect(() => {
  if (!selectedServerId || usingFallback) return;

  const interval = setInterval(async () => {
    try {
      const config = await api.getGuildConfig(selectedServerId);
      setServerConfigs((current) => ({
        ...current,
        [selectedServerId]: normalizeServerConfig(selectedServerId, config)
      }));
      setLastSyncTimestamp((current) => ({
        ...current,
        [selectedServerId]: Date.now()
      }));
    } catch (error) {
      console.warn('[AppContext] Sync failed:', error);
    }
  }, SYNC_INTERVAL);

  return () => clearInterval(interval);
}, [selectedServerId, usingFallback]);
```

**Benefício**: Configs são sincronizadas a cada minuto automaticamente

---

#### 2.2 - Mostrar Indicador de Última Sincronização

**Novo componente**: [apps/web/src/components/SyncStatus.tsx](apps/web/src/components/SyncStatus.tsx)

```tsx
import { useAppContext } from '../contexts/AppContext';
import { Clock, AlertCircle } from 'lucide-react';

export function SyncStatus() {
  const { selectedServerId, lastSyncTimestamp, syncErrors } = useAppContext();
  
  if (!selectedServerId) return null;

  const lastSync = lastSyncTimestamp?.[selectedServerId];
  const hasError = syncErrors?.[selectedServerId];

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes === 0) return 'agora';
    if (minutes === 1) return '1 min';
    if (minutes < 60) return `${minutes} min`;
    
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 h';
    return `${hours} h`;
  };

  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      {hasError ? (
        <>
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-red-400">Erro: {hasError}</span>
        </>
      ) : (
        <>
          <Clock className="w-4 h-4" />
          <span>
            Sincronizado {lastSync ? formatTime(lastSync) : 'há pouco'}
          </span>
        </>
      )}
    </div>
  );
}
```

**Uso**: Adicionar ao Dashboard header

---

### **Fase 3: Melhorias Adicionais** (Prioridade Média)

#### 3.1 - AdminPanel: Revalidar Lista Após Mudança de Plan

**Ficheiro**: [apps/web/src/pages/AdminPanel.tsx](apps/web/src/pages/AdminPanel.tsx#L89-L112)

```tsx
async function updateGuildPlan(guildId: string, newPlan: 'free' | 'premium') {
  setUpdatingGuildId(guildId);
  try {
    await api.setGuildPlan(guildId, newPlan);
    
    // Atualiza estado local
    setUsers(prevUsers =>
      prevUsers.map(user => ({
        ...user,
        guilds: user.guilds.map(guild =>
          guild.id === guildId ? { ...guild, plan: newPlan } : guild
        )
      }))
    );

    // 🆕 Recarrega lista completa para sincronizar
    try {
      const updatedUsers = await api.getAdminUsers();
      setUsers(updatedUsers);
    } catch (reloadError) {
      console.warn('[AdminPanel] Failed to reload users:', reloadError);
      // Mantém estado local otimista
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to update plan');
    // Recarrega para reverter estado local se houve erro
    try {
      const reloadedUsers = await api.getAdminUsers();
      setUsers(reloadedUsers);
    } catch {
      // Silencioso
    }
  } finally {
    setUpdatingGuildId(null);
  }
}
```

**Benefício**: Garante que estado local reflete a BD após mudança crítica

---

#### 3.2 - Melhorar runtimeConfigStore com TTL

**Ficheiro**: [apps/bot/src/services/runtimeConfigStore.js](apps/bot/src/services/runtimeConfigStore.js)

```javascript
export function createRuntimeConfigStore(env) {
  const cache = new Map();
  const timestamps = new Map();
  const CONFIG_TTL = 10 * 60 * 1000; // 10 minutos

  async function getGuildConfigCached(guildId, { force = false } = {}) {
    const now = Date.now();
    const lastFetch = timestamps.get(guildId);
    const isCacheValid = lastFetch && (now - lastFetch) < CONFIG_TTL;

    if (!force && cache.has(guildId) && isCacheValid) {
      return cache.get(guildId);
    }

    const config = await fetchGuildConfig(env.apiBaseUrl, env.botApiKey, guildId);
    cache.set(guildId, config);
    timestamps.set(guildId, now);
    return config;
  }

  function clearGuildConfig(guildId) {
    cache.delete(guildId);
    timestamps.delete(guildId);
  }

  // ... resto do código
}
```

**Benefício**: Cache expira automaticamente a cada 10 minutos mesmo sem invalidação

---

## 📊 Matriz de Implementação

| # | Problema | Solução | Ficheiros | Complexidade | Impacto |
|---|----------|---------|-----------|--------------|---------|
| 1.1 | Early return bloqueia reload | Adicionar TTL à cache | AppContext.tsx | 🟢 Baixa | 🔴 Crítico |
| 1.2 | saveGuildConfig sem validação | Aguardar + tratamento erro | AppContext.tsx | 🟡 Média | 🔴 Crítico |
| 1.3 | Cache bot desatualizado | API interna de invalidação | admin.js, botNotificationService.js | 🟡 Média | 🔴 Crítico |
| 2.1 | Sem polling automático | Polling a cada 1 min | AppContext.tsx | 🟡 Média | 🟠 Alto |
| 2.2 | Sem indicador de sync | Novo componente SyncStatus | SyncStatus.tsx | 🟢 Baixa | 🟡 Médio |
| 3.1 | AdminPanel não revalida | Recarregar após mudança | AdminPanel.tsx | 🟢 Baixa | 🟠 Alto |
| 3.2 | runtimeConfigStore sem TTL | Adicionar expiração | runtimeConfigStore.js | 🟢 Baixa | 🟠 Alto |

---

## 🔄 Ordem de Implementação Recomendada

### Semana 1 (Crítica):
1. ✅ 1.1 - Adicionar TTL à cache (AppContext)
2. ✅ 1.2 - Validar saveGuildConfig
3. ✅ 1.3 - Invalidação de cache do bot

### Semana 2 (Alta):
4. ✅ 2.1 - Polling automático
5. ✅ 2.2 - Indicador de sincronização

### Semana 3 (Melhorias):
6. ✅ 3.1 - Revalidação em AdminPanel
7. ✅ 3.2 - TTL em runtimeConfigStore

---

## 🧪 Testes Recomendados

### Teste 1: Cache TTL
```
1. Selecionar servidor A
2. Config carregada ✓
3. Trocar para servidor B
4. Trocar de volta para A
5. Config deve recarregar se > 5 min passou ✓
```

### Teste 2: Validação de Erro
```
1. Desligar backend temporariamente
2. Ativar feature
3. Deve mostrar erro na UI ✓
4. Estado local deve reverter ✓
5. Religar backend
6. Próxima operação sincroniza ✓
```

### Teste 3: Invalidação de Cache (Bot)
```
1. Bot conectado
2. Admin muda plan para premium
3. Bot invalida cache imediatamente ✓
4. Features premium funcionam ✓
```

### Teste 4: Multi-Admin Sync
```
1. Admin A e B logados
2. Admin A muda feature X
3. Admin B polling sincroniza em < 1 min ✓
4. Ambos veem mesmo estado ✓
```

---

## 📝 Notas de Implementação

### Performance:
- Polling a 1 min é suficiente para dashboard
- TTL de 5 min em cache local evita requests excessivos
- Bot cache com 10 min TTL e invalidação sob-demanda é ideal

### Segurança:
- `BOT_INTERNAL_KEY` deve ser seguro (env var)
- Apenas API pode chamar `/internal/invalidate-cache`
- Validar guildId antes de processar

### Tratamento de Erros:
- Falha de notificação ao bot não bloqueia operação
- Falha de polling não quebra UI
- Usuário recebe feedback visual claro

---

## 🎯 Resultados Esperados

Após implementação completa:

✅ Mudanças de um admin são refletidas em tempo real (< 1 min)  
✅ Sem desincronização entre frontend e backend  
✅ Bot sempre usa configs atualizadas  
✅ Erros são tratados e sincronizados  
✅ Múltiplos admins podem trabalhar simultaneamente  
✅ Indicador visual de última sincronização  

---

## 🔗 Referências

- [AppContext.tsx](apps/web/src/contexts/AppContext.tsx)
- [AdminPanel.tsx](apps/web/src/pages/AdminPanel.tsx)
- [admin.js](apps/api/src/routes/admin.js)
- [runtimeConfigStore.js](apps/bot/src/services/runtimeConfigStore.js)
- [api.ts](apps/web/src/lib/api.ts)
