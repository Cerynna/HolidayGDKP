// Enregistre les commandes slash auprès de Discord.
// - Si DISCORD_GUILD_ID est défini : déploiement instantané sur ta guilde (recommandé en dev).
// - Sinon : déploiement global (peut prendre jusqu'à 1h à se propager).
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandList } from './commands/index.js';
const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
    console.error('❌ DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis dans .env');
    process.exit(1);
}
const body = commandList.map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);
try {
    if (DISCORD_GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body });
        console.log(`✅ ${body.length} commande(s) déployée(s) sur la guilde ${DISCORD_GUILD_ID}.`);
    }
    else {
        await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body });
        console.log(`✅ ${body.length} commande(s) déployée(s) globalement (propagation ~1h).`);
    }
}
catch (err) {
    console.error('❌ Échec du déploiement :', err);
    process.exit(1);
}
//# sourceMappingURL=deploy-commands.js.map