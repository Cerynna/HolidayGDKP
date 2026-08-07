// Registre statique des commandes slash (typé, sans scan de dossier).
import type { Command } from '../types.js';
import * as link from './link.js';
import * as unlink from './unlink.js';
import * as whoami from './whoami.js';
import * as grade from './grade.js';
import * as refresh from './refresh.js';
import * as panel from './panel.js';

export const commandList: Command[] = [link, unlink, whoami, grade, refresh, panel];

/** Map nom -> commande, pour le routage des interactions. */
export const commands = new Map<string, Command>(commandList.map((c) => [c.data.name, c]));
