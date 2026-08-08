// Script utilitaire : crée sur la guilde les rôles de grade manquants,
// avec la couleur de parse définie dans config.json.
// Usage : npm run setup:roles
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { getConfig } from './grades.js';
const { DISCORD_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_GUILD_ID) {
    console.error('❌ DISCORD_TOKEN et DISCORD_GUILD_ID requis dans .env');
    process.exit(1);
}
function allGrades(grades) {
    return Array.isArray(grades) ? grades : Object.values(grades).flat();
}
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, async (c) => {
    try {
        const cfg = await getConfig();
        const guild = await c.guilds.fetch(DISCORD_GUILD_ID);
        await guild.roles.fetch();
        // Dédoublonne par nom (une seule création par rôle).
        const wanted = new Map();
        for (const g of allGrades(cfg.grades)) {
            if (!wanted.has(g.role.toLowerCase()))
                wanted.set(g.role.toLowerCase(), g);
        }
        let created = 0;
        let updated = 0;
        for (const g of wanted.values()) {
            const existing = guild.roles.cache.find((r) => r.name.toLowerCase() === g.role.toLowerCase());
            if (existing) {
                // Met à jour couleur + hoist si besoin.
                const needColor = Boolean(g.color) && existing.hexColor.toUpperCase() !== g.color.toUpperCase();
                const needHoist = !existing.hoist;
                if (needColor || needHoist) {
                    await existing.edit({
                        color: g.color ?? undefined,
                        hoist: true,
                        reason: 'Grade WoW (setup)',
                    });
                    updated++;
                    console.log(`🔧 Mis à jour : ${g.role}${needHoist ? ' (affichage séparé)' : ''}`);
                }
                else {
                    console.log(`⏭️  Déjà OK : ${g.role}`);
                }
                continue;
            }
            const role = await guild.roles.create({
                name: g.role,
                color: g.color ?? undefined,
                hoist: true, // affiche les membres de ce rôle dans une section séparée
                reason: 'Rôle de grade WoW (setup)',
            });
            created++;
            console.log(`✅ Créé : ${role.name} ${g.color ?? ''}`);
        }
        // Rôle d'accès au raid (sans couleur : n'écrase pas la couleur de parse ;
        // hoisté pour voir le roster validé regroupé dans la liste des membres).
        if (cfg.raidAccess) {
            const name = cfg.raidAccess.role;
            const exists = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase());
            if (!exists) {
                await guild.roles.create({ name, hoist: true, reason: 'Rôle d’accès raid GDKP (setup)' });
                console.log(`✅ Créé : ${name} (accès raid, hoisté)`);
            }
            else {
                if (!exists.hoist)
                    await exists.edit({ hoist: true, reason: 'Accès raid GDKP' });
                console.log(`⏭️  Déjà OK : ${name} (accès raid)`);
            }
        }
        // Ordonne les rôles, du haut vers le bas : Valid, puis les grades
        // (meilleur → moins bon), juste sous le rôle du bot. Ainsi le roster validé
        // se regroupe en haut, et les couleurs de parse restent sur les pseudos.
        await guild.roles.fetch();
        const gradeRoles = allGrades(cfg.grades)
            .filter((g, i, arr) => arr.findIndex((x) => x.role.toLowerCase() === g.role.toLowerCase()) === i)
            .sort((a, b) => b.min - a.min)
            .map((g) => guild.roles.cache.find((r) => r.name.toLowerCase() === g.role.toLowerCase()))
            .filter((r) => Boolean(r));
        const validRole = cfg.raidAccess
            ? guild.roles.cache.find((r) => r.name.toLowerCase() === cfg.raidAccess.role.toLowerCase())
            : undefined;
        const ordered = validRole ? [validRole, ...gradeRoles] : gradeRoles;
        const ceiling = guild.members.me?.roles.highest.position ?? 0;
        if (ceiling <= ordered.length) {
            console.log(`\n⚠️  Le rôle du bot est trop bas (position ${ceiling}) pour ranger ${ordered.length} rôles.\n` +
                '    Monte le rôle du bot plus haut dans Paramètres serveur → Rôles, puis relance.');
        }
        else {
            try {
                await guild.roles.setPositions(ordered.map((r, i) => ({ role: r.id, position: ceiling - 1 - i })));
                console.log('📊 Rôles ordonnés (Valid en haut → Parfait → … → Commun).');
            }
            catch (err) {
                console.log('⚠️  Impossible de réordonner automatiquement :', err.message);
            }
        }
        console.log(`\nTerminé — ${created} créé(s), ${updated} mis à jour.`);
        console.log('⚠️  Le rôle du bot doit rester AU-DESSUS de ces rôles (Paramètres serveur → Rôles).');
    }
    catch (err) {
        console.error('❌ Erreur :', err.message);
    }
    finally {
        await client.destroy();
        process.exit(0);
    }
});
void client.login(DISCORD_TOKEN);
//# sourceMappingURL=setup-roles.js.map