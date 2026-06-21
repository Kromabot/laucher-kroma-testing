# Diagnóstico: Sistema de Regras - Internal Server Error

## Problema
Ao tentar enviar o sistema de regras personalizado, aparece erro HTTP 500 com HTML de challenge Cloudflare.

## Causa Raiz
A rota `/bot/guilds/{guildId}/rules/send` requer:
1. `requireAuth` - Sessão OAuth com user e guilds carregados
2. `requireGuildAdmin` - User deve ser admin da guild

**Possíveis causas:**
- Sessão expirada ou não carregada corretamente
- Guilds não sincronizadas da sessão OAuth
- User não tem permissão de admin na guild
- Feature de regras desativada na configuração

## Comandos de Diagnóstico no VPS

### 1. Ver logs detalhados de erro
```bash
sudo systemctl restart launcher-bot-api
sudo journalctl -u launcher-bot-api -f --no-pager | grep -E "\[api\.(rules|auth)\]"
```

### 2. Testar de forma isolada
No navegador, abrir browser console e executar:
```javascript
// Ver se há sessão carregada
fetch('/api/auth/me', { credentials: 'include' })
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

### 3. Verificar se feature está ativada
```bash
sudo -i bash -c 'source /etc/launcher-bot/launcher-bot.env && \
psql "$DATABASE_URL" -c "SELECT guild_id, raw_config::text FROM guild_config LIMIT 1;"'
```

### 4. Logs da API em tempo real
```bash
sudo journalctl -u launcher-bot-api -n 500 --no-pager | tail -100
```

Procura por:
```
[api.rules] send start
[api.auth] requireGuildAdmin
[auth] bot key validation attempt
```

## Possíveis Mensagens de Erro

### "Administrator permission required for this guild"
- User não está autenticado corretamente
- Session não tem a guild carregada
- User é membro mas não admin

### "You are not a member of this guild"
- Guild ID incorreto
- Session não sincronizou as guilds do user

### "Rules system is disabled"
- Feature `rules` não está ativada na configuração da guild

### "Failed to send rules embed"
- Erro genérico - ver logs da API para detalhe

## Melhorias Implementadas

1. ✅ **Logging detalhado** em `apps/api/src/routes/bot.js`
   - Mostra guildId, mode, sucesso/erro

2. ✅ **Middleware aprimorado** em `apps/api/src/middleware/auth.js`
   - Log de quantas guilds há na sessão
   - Diferencia entre "não é membro" e "não é admin"

3. ✅ **Tratamento de erro melhorado** em `apps/web/src/lib/api.ts`
   - Mostra mensagem de erro real do servidor (não HTML Cloudflare)

## Próximos Passos

1. Execute os logs acima quando tentar enviar as regras
2. Cole os logs aqui
3. Vou identificar exatamente onde está a falha
