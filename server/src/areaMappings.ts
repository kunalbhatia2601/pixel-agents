import { readConfig, writeConfig } from './configPersistence.js';

/** Office Areas the agents of each role sit in (see the bundled layout). */
export const DEV_TEAM_AREA = 'Dev Team';
export const QA_AREA = 'QA / Review';

/** Maps an office label to an Area once, so that role's agents sit in their room. */
export function ensureAreaMapping(
  label: string,
  area: string,
  broadcast: (msg: Record<string, unknown>) => void,
): void {
  const cfg = readConfig();
  const mappings = (cfg.standalone.areaMappings ??= {});
  if (mappings[label]) return;
  mappings[label] = [area];
  writeConfig(cfg);
  broadcast({ type: 'areaMappingsLoaded', mappings });
}
