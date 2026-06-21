#!/usr/bin/env node
/**
 * Deploy Clean de Comandos
 * Limpa comandos de guild e faz deploy global correto
 * Execute com: node deploy-clean.js
 */

import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!CLIENT_ID || !BOT_TOKEN) {
  console.error('❌ DISCORD_CLIENT_ID ou DISCORD_BOT_TOKEN não configurados');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

// Carregar comandos (igual a registerCommands.js)
async function loadCommands() {
  try {
    // Tenta importar definitions.js
    const definitionsPath = path.resolve('./apps/bot/src/commands/definitions.js');
    const module = await import(`file://${definitionsPath}`);
    const { commandDefinitions } = module;
    return commandDefinitions.map(cmd => cmd.data.toJSON());
  } catch (err) {
    console.error('❌ Erro a carregar comandos:', err.message);
    process.exit(1);
  }
}

async function deploy() {
  try {
    console.log('🔍 DIAGNÓSTICO E DEPLOY\n');

    // 1. Ver comandos GLOBAIS
    console.log('1️⃣ Verificando comandos GLOBAIS...');
    const globalCommands = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(`   ✅ ${globalCommands.length} comandos globais encontrados\n`);

    // 2. Ver comandos por GUILD
    console.log('2️⃣ Verificando comandos por GUILD...');
    const client = { guilds: { cache: new Map() } };
    
    // Buscar guilds onde o bot está
    const guilds = await rest.get(`/users/@me/guilds`);
    console.log(`   ✅ Bot está em ${guilds.length} servidores\n`);

    let guildCommandsFound = 0;
    for (const guild of guilds) {
      try {
        const guildCmds = await rest.get(
          Routes.applicationGuildCommands(CLIENT_ID, guild.id)
        );
        if (guildCmds.length > 0) {
          console.log(`   ⚠️  Guild ${guild.id} (${guild.name}): ${guildCmds.length} comandos LOCAIS`);
          guildCommandsFound++;
        }
      } catch (err) {
        // Ignorar erro
      }
    }

    if (guildCommandsFound > 0) {
      console.log(`\n⚠️  ENCONTRADOS ${guildCommandsFound} SERVIDORES COM COMANDOS LOCAIS!\n`);
    } else {
      console.log('   ✅ Nenhum comando local encontrado\n');
    }

    // 3. Carregar comandos do projeto
    console.log('3️⃣ Carregando comandos do projeto...');
    const commands = await loadCommands();
    console.log(`   ✅ ${commands.length} comandos carregados\n`);

    // 4. Limpar guild commands (se existem)
    if (guildCommandsFound > 0) {
      console.log('4️⃣ LIMPANDO comandos locais de guild...');
      for (const guild of guilds) {
        try {
          const guildCmds = await rest.get(
            Routes.applicationGuildCommands(CLIENT_ID, guild.id)
          );
          if (guildCmds.length > 0) {
            await rest.put(
              Routes.applicationGuildCommands(CLIENT_ID, guild.id),
              { body: [] }
            );
            console.log(`   ✅ Guild ${guild.id} (${guild.name}): LIMPO`);
          }
        } catch (err) {
          console.error(`   ⚠️  Erro ao limpar guild ${guild.id}:`, err.message);
        }
      }
      console.log('');
    }

    // 5. Deploy GLOBAL
    console.log('5️⃣ Fazendo DEPLOY GLOBAL dos comandos...');
    const result = await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log(`   ✅ ${result.length} comandos deployados globalmente\n`);

    // 6. Verificação final
    console.log('6️⃣ Verificação FINAL...');
    const finalGlobal = await rest.get(Routes.applicationCommands(CLIENT_ID));
    console.log(`   ✅ ${finalGlobal.length} comandos globais confirmados\n`);

    console.log('✨ DEPLOY COMPLETO!\n');
    console.log('📋 PRÓXIMOS PASSOS:');
    console.log('1. Aguarde 1-2 minutos');
    console.log('2. Reload no Discord (Ctrl+R ou Cmd+R)');
    console.log('3. Escreva / e veja os comandos');
    console.log('');
    console.log('Se AINDA não aparecer:');
    console.log('➜ Reconvide o bot com este link:');
    console.log(`➜ https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`);
    console.log('');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

deploy();
