import * as link from './link.js';
import * as unlink from './unlink.js';
import * as whoami from './whoami.js';
import * as grade from './grade.js';
import * as refresh from './refresh.js';
import * as panel from './panel.js';
export const commandList = [link, unlink, whoami, grade, refresh, panel];
/** Map nom -> commande, pour le routage des interactions. */
export const commands = new Map(commandList.map((c) => [c.data.name, c]));
//# sourceMappingURL=index.js.map