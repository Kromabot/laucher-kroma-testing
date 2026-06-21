#!/usr/bin/env node
/**
 * Diagnóstico de sincronização de comandos do Discord
 * Execute com: node diagnose-commands.js
 */

import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';

dotenv.config();

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_DEV_GUILD_ID; // Opcional, para testar num servidor específico

console.log('🔍 Diagnóstico de Sincronização de Comandos\n');

if (!CLIENT_ID) {
  console.error('❌ DISCORD_CLIENT_ID não está configurado no .env');
  process.exit(1);
}

if (!BOT_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN não está configurado no .env');
  process.exit(1);
}

console.log('✅ CLIENT_ID:', CLIENT_ID);
console.log('✅ BOT_TOKEN:', BOT_TOKEN.slice(0, 10) + '...');
console.log('');

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

async function diagnose() {
  try {
    // 1. Verificar comandos GLOBAIS
    console.log('📋 Buscando comandos GLOBAIS (registados em todos os servidores)...');
    const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(`   ✅ Encontrados ${globalCommands.length} comandos globais`);
    
    if (globalCommands.length > 0) {
      console.log('   Primeiros 5 comandos:');
      globalCommands.slice(0, 5).forEach(cmd => {
        console.log(`      - /${cmd.name}`);
      });
    }

    console.log('');

    // 2. Verificar comandos por GUILD (se DISCORD_DEV_GUILD_ID estiver configurado)
    if (GUILD_ID) {
      console.log(`📋 Buscando comandos para GUILD ${GUILD_ID}...`);
      try {
        const guildCommands = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
        console.log(`   ✅ Encontrados ${guildCommands.length} comandos nesta guild`);
        
        if (guildCommands.length > 0) {
          console.log('   Primeiros 5 comandos:');
          guildCommands.slice(0, 5).forEach(cmd => {
            console.log(`      - /${cmd.name}`);
          });
        }
      } catch (err) {
        console.error(`   ❌ Erro a buscar comandos da guild: ${err.message}`);
      }
    }

    console.log('');
    console.log('💡 PRÓXIMOS PASSOS:');
    console.log('');
    console.log('1️⃣  Se NÃO há comandos globais:');
    console.log('   ➜ Defina FORCE_GUILD_SYNC=true no .env');
    console.log('   ➜ Reinicie o bot: systemctl restart launcher-bot');
    console.log('   ➜ Aguarde sincronização por guild (logs mostram progresso)');
    console.log('');
    console.log('2️⃣  Se há comandos globais mas não aparecem no Discord:');
    console.log('   ➜ Verifique o link de convite do bot:');
    console.log(`   ➜ https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=1024&scope=bot%20applications.commands`);
    console.log('   ➜ Copie o link, clique, selecione o servidor');
    console.log('   ➜ Aguarde 1 minuto e reload no Discord (Ctrl+R ou Cmd+R)');
    console.log('');
    console.log('3️⃣  Se o bot foi adicionado SEM "applications.commands":');
    console.log('   ➜ Use o link correto acima');
    console.log('   ➜ Reconvide o bot ao servidor com o novo link');
    console.log('');

  } catch (error) {
    console.error('❌ Erro durante diagnóstico:', error.message);
    process.exit(1);
  }
}

diagnose();
