import { Value } from '@sinclair/typebox/value';
import { EDITABLE_SETTINGS, SETTING_KEYS, getFileValue } from './config';
import type { ResolvedConfig, SettingKey } from './config';
import type { OperationLock } from './dataWrite';
import type { Db } from './db';
import type { LogStore } from './logs';
import { getSettingRows } from './repository';

/** Mutable application state shared by all routes. `db` is swapped on restore. */
export interface AppContext {
  config: ResolvedConfig;
  db: Db;
  /** Server log and audit log, in their own file. Never swapped by a restore. */
  logs: LogStore;
  /** `AGT_SETUP_PASSWORD` from the environment; used only while no admin exists. */
  setupPassword: string | null;
  version: string;
  /** The backup/restore operation lock and data-write barrier (BAK-8). */
  operation: OperationLock;
}

export type SettingSource = 'config' | 'dashboard' | 'default';

export interface SettingState {
  key: SettingKey;
  value: unknown;
  source: SettingSource;
  locked: boolean;
  default: unknown;
  description: string;
}

export function isDefinedInConfig(context: AppContext, key: string): boolean {
  return getFileValue(context.config.file, key) !== undefined;
}

/** Effective settings: the config file always wins, then the dashboard value, then the default. */
export function settingStates(context: AppContext): SettingState[] {
  const stored = getSettingRows(context.db);
  return SETTING_KEYS.map((key) => {
    const definition = EDITABLE_SETTINGS[key];
    const fromFile = getFileValue(context.config.file, key);
    if (fromFile !== undefined) {
      return { key, value: fromFile, source: 'config', locked: true, default: definition.default, description: definition.description };
    }
    const fromDb = stored.get(key);
    if (fromDb !== undefined && Value.Check(definition.schema, fromDb)) {
      return { key, value: fromDb, source: 'dashboard', locked: false, default: definition.default, description: definition.description };
    }
    return { key, value: definition.default, source: 'default', locked: false, default: definition.default, description: definition.description };
  });
}

export function setting<K extends SettingKey>(context: AppContext, key: K): (typeof EDITABLE_SETTINGS)[K]['default'] {
  return settingStates(context).find((state) => state.key === key)!.value as (typeof EDITABLE_SETTINGS)[K]['default'];
}
