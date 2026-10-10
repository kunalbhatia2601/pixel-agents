import type {
  AgentSettings,
  EffortLevel,
  PermissionMode,
  ThinkingMode,
} from '../../../core/src/messages.js';
import { PERMISSION_MODES } from '../permissionModes.js';
import { inputClass } from './ProjectRoomModal.js';

const MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'];
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface AgentSettingsFieldsProps {
  value: AgentSettings | undefined;
  onChange: (value: AgentSettings) => void;
  /** Label for the empty option, e.g. "inherit from defaults" or "Claude Code default". */
  inheritLabel: string;
}

/** Model / effort / thinking inputs. Empty means "inherit from the layer above". */
export function AgentSettingsFields({ value, onChange, inheritLabel }: AgentSettingsFieldsProps) {
  const v = value ?? {};
  return (
    <div className="grid grid-cols-2 gap-6">
      <label className="flex flex-col gap-2">
        Model
        <input
          className={inputClass}
          list="agent-model-aliases"
          value={v.model ?? ''}
          placeholder={inheritLabel}
          onChange={(e) => onChange({ ...v, model: e.target.value || undefined })}
        />
        <datalist id="agent-model-aliases">
          {MODEL_ALIASES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-2">
        Effort
        <select
          className={inputClass}
          value={v.effort ?? ''}
          onChange={(e) =>
            onChange({ ...v, effort: (e.target.value || undefined) as EffortLevel | undefined })
          }
        >
          <option value="">{inheritLabel}</option>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2">
        Thinking
        <select
          className={inputClass}
          value={v.thinking ?? ''}
          onChange={(e) =>
            onChange({ ...v, thinking: (e.target.value || undefined) as ThinkingMode | undefined })
          }
        >
          <option value="">{inheritLabel}</option>
          <option value="adaptive">adaptive</option>
          <option value="disabled">off</option>
        </select>
      </label>
      <label className="flex flex-col gap-2">
        Mode
        <select
          className={inputClass}
          value={v.permissionMode ?? ''}
          onChange={(e) =>
            onChange({
              ...v,
              permissionMode: (e.target.value || undefined) as PermissionMode | undefined,
            })
          }
        >
          <option value="">{inheritLabel}</option>
          {PERMISSION_MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.hint}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
