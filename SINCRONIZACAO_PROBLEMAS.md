# Análise de Problemas de Sincronização 🔍

**Data:** 22 de maio de 2026  
**Problema:** Dados não sincronizam bem - é preciso logout/login para atualizar

## 🔴 Problemas Identificados

### 1. **Config carregada uma única vez** (AppContext.tsx:152-180)
```tsx
useEffect(() => {
    if (!selectedServerId) return;
    if (serverConfigs[selectedServerId]) return;  // ⚠️ PROBLEMA: Carrega apenas 1x
    
    async function loadConfig() {
      const config = await api.getGuildConfig(serverId);
      setServerConfigs(current => ({ ...current, [serverId]: config }));
    }
}, [selectedServerId, serverConfigs, usingFallback]);
```

**Impacto:** 
- Se o bot sincroniza dados enquanto o painel está aberto, o painel **nunca vê as mudanças**
- Mudanças feitas por outro admin não são refletidas
- Dados do Discord (canais/roles adicionadas) não aparecem até logout/login

---

### 2. **Sem refetch após salvar** (AppContext.tsx:221-248)
```tsx
void (usingFallback
  ? fallbackApi.saveGuildConfig(serverId, normalizedConfig)
  : api.saveGuildConfig(serverId, normalizedConfig)  // ⚠️ Fire-and-forget!
);
```

**Impacto:**
- Após fazer uma mudança, o estado local muda mas **não sincroniza com o servidor**
- Se houver erro no servidor, o utilizador não sabe
- Conflitos entre estado local e servidor

---

### 3. **Sincronização de estrutura (canais/roles) não é refletida no painel** 
(guildStructureSync.js → API → BD, mas painel não refetcha)

**Fluxo:**
1. Bot faz sync de canais/roles → API → BD
2. Painel carregou config há 5 minutos
3. **Painel nunca vê os novos canais/roles** até logout/login

**Ficheiros afetados:**
- `guildStructureSync.js` - Bot sincroniza estrutura
- `AppContext.tsx` - Painel carrega config uma única vez

---

### 4. **Sem mecanismo de invalidação de cache**
Não há forma de avisar o painel: "Ei, a config mudou, refetch agora!"

---

### 5. **Polling/refetch manual inexistente**
- Sem interval para refetch automático
- Sem button "Atualizar" explícito
- Sem WebSocket ou SSE para mudanças em tempo real

---

## ✅ Solução Proposta

### Fase 1: Refetch após mudanças (imediato)
```tsx
// AppContext.tsx - updateFeatureConfig
async function updateFeatureConfig(featureId, updater) {
  // 1. Atualiza estado local (otimista)
  setServerConfigs(current => ({...}));
  
  // 2. AGUARDA a resposta do servidor
  try {
    const response = await api.saveGuildConfig(serverId, normalizedConfig);
    
    // 3. Atualiza com dados do servidor (reconciliação)
    setServerConfigs(current => ({
      ...current,
      [serverId]: response
    }));
  } catch (error) {
    // 4. REVERT em caso de erro
    setServerConfigs(current => ({
      ...current,
      [serverId]: server // volta ao estado anterior
    }));
  }
}
```

### Fase 2: Botão "Atualizar" explícito
```tsx
<button onClick={() => refetchGuildConfig(selectedServerId)}>
  🔄 Atualizar dados
</button>
```

### Fase 3: Refetch automático periodicamente (opcional)
```tsx
useEffect(() => {
  const interval = setInterval(() => {
    refetchGuildConfig(selectedServerId);
  }, 30000); // A cada 30s
  
  return () => clearInterval(interval);
}, [selectedServerId]);
```

### Fase 4: WebSocket ou SSE (ideal, mas complexo)
- Bot envia evento: "Config mudou"
- Painel escuta e refetcha automaticamente
- Em tempo real (~100ms)

---

## 📋 Checklist de Fixes

- [x] **Fix 1:** Adicionar refetch após `saveGuildConfig` (aguarda resposta)
- [x] **Fix 2:** Adicionar "Refresh" button no dashboard
- [ ] **Fix 3:** Adicionar refetch automático a cada 30-60s (configurável)
- [ ] **Fix 4:** Melhorar tratamento de erros (mostrar toast ao utilizador)
- [ ] **Fix 5:** (Opcional) Implementar WebSocket para sync em tempo real

---

## ✨ Mudanças Implementadas (22 de maio de 2026)

### Ficheiros Modificados:

**1. apps/web/src/contexts/AppContext.tsx**
- ✅ Adicionado função `refetchGuildConfig(serverId)` - refetch manual da config
- ✅ `toggleFeature()` agora aguarda resposta + refetch automático
- ✅ `updateFeatureConfig()` agora aguarda resposta + refetch automático
- ✅ Ambas com fallback: revert ao estado anterior se houver erro
- ✅ Adicionado ao contexto (tipo + valor)

**2. apps/web/src/pages/dashboard/DashboardFrame.tsx**
- ✅ Adicionado botão "Atualizar" (🔄 icon com loading spinner)
- ✅ Localizado ao lado de "Trocar servidor"
- ✅ Chamada `handleRefresh()` dispara `refetchGuildConfig(selectedServerId)`
- ✅ Estado `isRefreshing` mostra spinner enquanto carrega

### Benefícios:

| Antes | Depois |
|-------|--------|
| Mudanças desaparecem até logout | Mudanças sincronizam imediatamente ✅ |
| Nenhuma forma de atualizar | Botão "Atualizar" visível ✅ |
| Conflitos silenciosos | Revert automático se erro ✅ |
| Canais/roles novos invisíveis | Um clique atualiza tudo ✅ |

### Próximos Passos (Opcional):

- **Fix 3:** Auto-refresh a cada 30s no background
- **Fix 4:** Toast notifications para erros/sucesso
- **Fix 5:** WebSocket para sync real-time (ideal para produção)

1. **apps/web/src/contexts/AppContext.tsx** (CRÍTICO)
   - Adicionar `refetchGuildConfig(serverId)` function
   - Chamar após `saveGuildConfig`
   - Adicionar retry logic com backoff

2. **apps/web/src/pages/dashboard/DashboardFrame.tsx** (ou ServerOverviewPage)
   - Adicionar "Refresh" button
   - Mostrar último update timestamp

3. **apps/api/src/routes/configs.js** (opcional)
   - Retornar `updatedAt` timestamp
   - Cliente pode mostrar "Atualizado em X minutos"

---

## 📊 Impacto da Solução

| Problema | Antes | Depois |
|----------|-------|--------|
| Mudanças aparecem no painel | Nunca (até logout) | Imediato (< 1s) |
| Novo canal/role do bot | Nunca (até logout) | 30s (com polling) |
| Conflitos entre admins | Frequentes | Raros (refetch) |
| Experiência do utilizador | Confusa ❌ | Clara ✅ |
