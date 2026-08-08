import 'dotenv/config';
import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { LINK_BUTTON_ID, ROLE_SELECT_ID, LINK_MODAL_PREFIX, showRoleSelect, showLinkModal, handleLinkModal, } from './panel.js';
const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN manquant dans .env');
    process.exit(1);
}
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
console.log(`✅ ${commands.size} commande(s) : ${[...commands.keys()].join(', ')}`);
client.once(Events.ClientReady, (c) => {
    console.log(`🤖 Connecté en tant que ${c.user.tag}`);
});
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // Bouton du panneau -> menu déroulant du rôle
        if (interaction.isButton() && interaction.customId === LINK_BUTTON_ID) {
            await showRoleSelect(interaction);
            return;
        }
        // Choix du rôle -> ouvre le formulaire
        if (interaction.isStringSelectMenu() && interaction.customId === ROLE_SELECT_ID) {
            await showLinkModal(interaction);
            return;
        }
        // Soumission du formulaire -> liaison + grade
        if (interaction.isModalSubmit() && interaction.customId.startsWith(LINK_MODAL_PREFIX)) {
            await handleLinkModal(interaction);
            return;
        }
        // Commandes slash
        if (interaction.isChatInputCommand()) {
            const command = commands.get(interaction.commandName);
            if (!command)
                return;
            await command.execute(interaction);
        }
    }
    catch (err) {
        console.error('Erreur interaction :', err);
        const content = `⚠️ Une erreur est survenue : ${err.message}`;
        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => { });
            }
            else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => { });
            }
        }
    }
});
void client.login(token);
//# sourceMappingURL=index.js.map